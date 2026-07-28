import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function walkRolloutFiles(sessionsDir) {
  const results = [];
  if (!fs.existsSync(sessionsDir)) return results;

  const years = fs.readdirSync(sessionsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const year of years) {
    const yearPath = path.join(sessionsDir, year.name);
    const months = fs.readdirSync(yearPath, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const month of months) {
      const monthPath = path.join(yearPath, month.name);
      const days = fs.readdirSync(monthPath, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const day of days) {
        const dayPath = path.join(monthPath, day.name);
        const files = fs.readdirSync(dayPath).filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'));
        for (const file of files) {
          const match = file.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
          if (!match) continue;
          results.push({ sessionId: match[1], filePath: path.join(dayPath, file) });
        }
      }
    }
  }
  return results;
}

// Absolute paths that show up in transcript content (shell commands, file
// reads). Codex is often launched from $HOME, where cwd says nothing about the
// project — but the paths the session actually touched do. Character class
// stops at JSON escapes/quotes; trailing punctuation is trimmed below.
const PATH_REF_RE = /\/(?:home|Users)\/[A-Za-z0-9._~-][A-Za-z0-9._~/-]*/g;
const MAX_PATH_REFS = 10000;

// Codex threads that INHERIT a conversation — subagent spawns
// (`source.subagent.thread_spawn`) and resumes — replay the parent's entire
// transcript into the new rollout at file-open time, re-stamped with the open
// timestamp. In one real rollout, 787 of 800 token_count events were the
// parent's; only the last 13 were the thread's own work. Those replayed events
// were already billed in the parent's file, so counting them charged the
// parent's history once per child (Codex read ~3x high overall).
//
// The replay is written in a burst: measured across every local rollout it
// spans well under a second, while a thread's own first call lands seconds
// later (6.3s in the file above). Anything inside the opening window is
// inherited history — we track its counter but don't bill it. The result is
// insensitive to the exact window: 500ms through 5000ms all reconcile to
// ccusage identically. A genuine first API call cannot land here, since the
// session has to wait on a user prompt and a model response first.
const REPLAY_WINDOW_MS = 2000;

function parseRolloutFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');

  let cwd = null;
  let model = 'unknown';
  let firstTimestamp = null;
  let fileOpenedAt = null;
  // Per-model buckets rather than one latched model: a rollout can switch
  // models mid-session (10 of 40 local rollouts do), and billing the whole
  // counter to whichever came first put 642M tokens on gpt-5.6-terra when the
  // work was gpt-5.6-sol's. Mirrors the per-model split in claude.js.
  const byModel = new Map();
  // total_token_usage is CUMULATIVE over the rollout, so one call's usage is
  // its delta from the previous event. Deltas also absorb the repeated
  // token_count emissions that re-report a call without advancing the counter
  // (summing last_token_usage instead double-counts those by ~3%).
  let prevTotal = null;
  const contentPathRefs = {};
  let pathRefCount = 0;

  for (const line of lines) {
    if (pathRefCount < MAX_PATH_REFS) {
      for (const match of line.matchAll(PATH_REF_RE)) {
        const ref = match[0].replace(/[/.]+$/, '');
        contentPathRefs[ref] = (contentPathRefs[ref] || 0) + 1;
        if (++pathRefCount >= MAX_PATH_REFS) break;
      }
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp && !firstTimestamp) {
      firstTimestamp = entry.timestamp;
      fileOpenedAt = Date.parse(entry.timestamp);
    }

    if (!cwd && entry.type === 'session_meta' && entry.payload?.cwd) {
      cwd = entry.payload.cwd;
    }

    if (!cwd && entry.type === 'turn_context' && entry.payload?.cwd) {
      cwd = entry.payload.cwd;
    }

    // Tracks the ACTIVE model, so usage lands on whichever model was in force
    // when the call was made.
    if (entry.type === 'turn_context' && entry.payload?.model) {
      model = entry.payload.model;
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
      const total = entry.payload.info?.total_token_usage;
      if (!total) continue;

      const inherited = fileOpenedAt !== null
        && Date.parse(entry.timestamp) - fileOpenedAt <= REPLAY_WINDOW_MS;
      if (inherited) {
        // Already billed in the parent's rollout. Advance the counter so the
        // thread's own first call is measured from the fork point, not zero.
        prevTotal = total;
        continue;
      }

      const dInput = (total.input_tokens || 0) - (prevTotal?.input_tokens || 0);
      const dCached = (total.cached_input_tokens || 0) - (prevTotal?.cached_input_tokens || 0);
      const dOutput = (total.output_tokens || 0) - (prevTotal?.output_tokens || 0);
      prevTotal = total;
      // A negative delta means the counter restarted rather than continued;
      // there is no sane usage to charge, so skip instead of billing garbage.
      if (dInput < 0 || dCached < 0 || dOutput < 0) continue;

      // Codex reports overlapping counters: cached_input_tokens is a SUBSET of
      // input_tokens, and reasoning_output_tokens a SUBSET of output_tokens
      // (total_tokens === input + output in every observed rollout event). Our
      // buckets are disjoint (Claude-transcript semantics), so subtract cached
      // out of input and take output as-is — adding reasoning double-counts.
      const acc = byModel.get(model) || { input: 0, output: 0, cacheRead: 0 };
      acc.input += Math.max(0, dInput - dCached);
      acc.output += dOutput;
      acc.cacheRead += dCached;
      byModel.set(model, acc);
    }
  }

  return { cwd, model, firstTimestamp, byModel, contentPathRefs };
}

export function parseCodexData(codexDir) {
  const sessionsDir = path.join(codexDir, 'sessions');
  const rolloutFiles = walkRolloutFiles(sessionsDir);
  const sessions = [];

  for (const { sessionId, filePath } of rolloutFiles) {
    let transcript;
    try {
      transcript = parseRolloutFile(filePath);
    } catch {
      continue;
    }

    const baseId = `codex_${sessionId}`;
    const startedAt = transcript.firstTimestamp
      ? new Date(transcript.firstTimestamp).toISOString()
      : null;
    // A thread whose every call was inherited history has no billable usage of
    // its own, but it is still a real session — emit a zero row so session
    // counts and project attribution stay intact.
    const models = transcript.byModel.size
      ? [...transcript.byModel.entries()]
      : [[transcript.model, { input: 0, output: 0, cacheRead: 0 }]];

    for (const [model, tok] of models) {
      sessions.push({
        // Bare id when single-model (the common case, keeps ids stable);
        // suffixed per model only when a split actually occurs — same rule
        // as claude.js.
        id: models.length > 1 ? `${baseId}__${model}` : baseId,
        tool: 'codex',
        cwd: transcript.cwd || '',
        project: '',
        model,
        startedAt,
        inputTokens: tok.input,
        outputTokens: tok.output,
        cacheReadTokens: tok.cacheRead,
        cacheWriteTokens: 0,
        contentPathRefs: transcript.contentPathRefs,
        cost: 0,
        currency: 'USD',
      });
    }
  }

  sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  return sessions;
}

export function defaultPath() {
  return path.join(os.homedir(), '.codex');
}
