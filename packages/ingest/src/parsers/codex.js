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

function parseRolloutFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');

  let cwd = null;
  let model = 'unknown';
  let firstTimestamp = null;
  let lastTokenUsage = null;
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
    }

    if (!cwd && entry.type === 'session_meta' && entry.payload?.cwd) {
      cwd = entry.payload.cwd;
    }

    if (!cwd && entry.type === 'turn_context' && entry.payload?.cwd) {
      cwd = entry.payload.cwd;
    }

    if (model === 'unknown' && entry.type === 'turn_context' && entry.payload?.model) {
      model = entry.payload.model;
    }

    if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
      if (entry.payload.info?.total_token_usage) {
        lastTokenUsage = entry.payload.info.total_token_usage;
      }
    }
  }

  // Codex reports overlapping counters: cached_input_tokens is a SUBSET of
  // input_tokens, and reasoning_output_tokens a SUBSET of output_tokens
  // (total_tokens === input + output in every observed rollout event). Our
  // buckets are disjoint (Claude-transcript semantics), so subtract cached
  // out of input and take output as-is — adding reasoning would double-count.
  const input = lastTokenUsage?.input_tokens || 0;
  const cached = lastTokenUsage?.cached_input_tokens || 0;
  return {
    cwd,
    model,
    firstTimestamp,
    inputTokens: Math.max(0, input - cached),
    outputTokens: lastTokenUsage?.output_tokens || 0,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    contentPathRefs,
  };
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

    sessions.push({
      id: `codex_${sessionId}`,
      tool: 'codex',
      cwd: transcript.cwd || '',
      project: '',
      model: transcript.model,
      startedAt: transcript.firstTimestamp
        ? new Date(transcript.firstTimestamp).toISOString()
        : null,
      duration: null,
      inputTokens: transcript.inputTokens,
      outputTokens: transcript.outputTokens,
      cacheReadTokens: transcript.cacheReadTokens,
      cacheWriteTokens: transcript.cacheWriteTokens,
      contentPathRefs: transcript.contentPathRefs,
      cost: 0,
      currency: 'USD',
    });
  }

  sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  return sessions;
}

export function defaultPath() {
  return path.join(os.homedir(), '.codex');
}
