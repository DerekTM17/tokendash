import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDay, addTurn, toDailyTokens } from '../daily.js';
import { isUserTurn } from '../turns.js';

function decodeCwdFromDir(dirName) {
  if (dirName.charAt(0) === '-') dirName = dirName.slice(1);
  return '/' + dirName.replace(/-/g, '/');
}

// Collect every .jsonl transcript that lives inside a `subagents` directory
// anywhere beneath `root`. Delegated agents nest one level down per session,
// and agents that delegate again nest deeper, so this walks recursively.
function findSubagentTranscripts(root, inSubagents = false, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      findSubagentTranscripts(full, inSubagents || entry.name === 'subagents', out);
    } else if (inSubagents && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function parseTranscriptFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');

  let firstTimestamp = null;
  // A single transcript folder can hold sessions from several cwds, and a user
  // may `cd` mid-session, so pick the dominant (most frequent) cwd rather than
  // the first one seen.
  const cwdCounts = new Map();
  // Claude Code streams each assistant message, logging it under the same
  // message.id more than once (partial chunks + final). Summing every line
  // double-counts tokens (~2x), so keep only the highest-usage entry per id.
  const usageById = new Map();
  // Turns are found during the line loop, but the dominant model is not known
  // until after it — so buffer turn days here and apply them to the winning
  // model's byDay once the winner is chosen.
  const turnDays = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.timestamp && (!firstTimestamp || entry.timestamp < firstTimestamp)) {
      firstTimestamp = entry.timestamp;
    }
    if (entry.cwd) {
      cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);
    }

    if (isUserTurn(entry)) {
      turnDays.push(entry.timestamp ? entry.timestamp.slice(0, 10) : null);
    }

    if (entry.type !== 'assistant') continue;
    if (!entry.message || entry.message.role !== 'assistant') continue;
    const usage = entry.message.usage;
    if (!usage) continue;

    const tok = {
      model: entry.message.model || 'unknown',
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      // Anthropic splits cache writes by TTL and bills the 1-hour tier at 2x
      // input vs 1.25x for 5-minute. Claude Code uses 1h heavily, so tracking
      // the subset separately is worth real money.
      //
      // Clamped to the total HERE, per call, not later per session. 10 of
      // 103,174 local usage entries report a 1h subset larger than the
      // cache_creation total it is a subset of (worst excess 1,611 tokens).
      // pricing.js clamps too, but only once the day/session totals are summed,
      // so an over-report on one call could hide under other calls' headroom —
      // which billed the 2x tier for tokens that were never written at it, and
      // made a session's per-day costs sum to less than its own total.
      cacheWrite1h: Math.min(
        usage.cache_creation?.ephemeral_1h_input_tokens || 0,
        usage.cache_creation_input_tokens || 0
      ),
      // The day this call actually happened, which is not the session's start
      // day for anything long-running. Streamed chunks of one response share a
      // timestamp to the second, so taking the winner's day below is stable.
      day: entry.timestamp ? entry.timestamp.slice(0, 10) : null,
    };
    // Entries without an id can't be deduped — key them uniquely by line.
    const id = entry.message.id || `line-${usageById.size}`;
    const total = tok.input + tok.output + tok.cacheRead + tok.cacheWrite;
    const existing = usageById.get(id);
    if (!existing || total > existing.total) usageById.set(id, { ...tok, total });
  }

  // Aggregate tokens PER MODEL rather than collapsing to a dominant one, so a
  // session that switches models mid-way (a /model change) attributes each
  // model's tokens correctly instead of hiding the minority under the majority.
  // <synthetic> is Claude Code's own placeholder message, not real model usage.
  // One entry per message.id IS one API call: the map already collapses the
  // streamed partial chunks that Claude Code logs under a shared id. Verified
  // over the full local corpus — 44,539 distinct ids, none appearing in two
  // transcripts, none lacking an id, none carrying two models.
  const fallbackDay = firstTimestamp ? firstTimestamp.slice(0, 10) : null;
  const byModel = new Map();
  for (const t of usageById.values()) {
    if (t.model === '<synthetic>') continue;
    const acc = byModel.get(t.model)
      || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, calls: 0, byDay: new Map() };
    acc.input += t.input;
    acc.output += t.output;
    acc.cacheRead += t.cacheRead;
    acc.cacheWrite += t.cacheWrite;
    acc.cacheWrite1h += t.cacheWrite1h;
    acc.calls += 1;
    const day = t.day || fallbackDay;
    if (day) addDay(acc.byDay, day, t);
    byModel.set(t.model, acc);
  }

  let cwd = null;
  let bestCwd = -1;
  for (const [c, n] of cwdCounts) {
    if (n > bestCwd) {
      bestCwd = n;
      cwd = c;
    }
  }

  // Turns belong to the transcript, not to a model — a person typing a prompt
  // is model-agnostic. Putting them on every sibling row would double-count
  // them and halve Requests/Turn, so they go on exactly one row.
  let turnModel = null;
  let bestCalls = -1;
  for (const [model, acc] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (acc.calls > bestCalls) {
      bestCalls = acc.calls;
      turnModel = model;
    }
  }
  let userTurns = 0;
  if (turnModel !== null) {
    const acc = byModel.get(turnModel);
    for (const rawDay of turnDays) {
      userTurns += 1;
      const day = rawDay || fallbackDay;
      if (day) addTurn(acc.byDay, day);
    }
  }

  return { cwd, firstTimestamp, byModel, turnModel, userTurns };
}

export function parseClaudeJSON(projectsDir) {
  const base = projectsDir || path.join(os.homedir(), '.claude', 'projects');
  const sessions = [];

  if (!fs.existsSync(base)) return sessions;

  const projDirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const projDir of projDirs) {
    const dirPath = path.join(base, projDir.name);

    // Turn one transcript file into session rows — one per model used, so a
    // mid-session /model switch attributes each model's tokens correctly.
    // Cost is always left at 0 here: the normalizer derives it from
    // tokens x model pricing. (We used to read a recorded cost from
    // ~/.claude.json's `lastCost`, but that file keeps only the most recent
    // session per project and it matched 0 of 2,385 sessions in practice.)
    const emit = (filePath, baseId, isSubagent) => {
      let transcript;
      try {
        transcript = parseTranscriptFile(filePath);
      } catch {
        return;
      }
      const models = [...transcript.byModel.entries()];
      // The transcript's own cwd is authoritative. Only fall back to the
      // folder-name decode (lossy — it turns any '-' in a real dir name into
      // '/') when the transcript carried no cwd.
      const cwd = transcript.cwd || decodeCwdFromDir(projDir.name);
      const startedAt = transcript.firstTimestamp ? new Date(transcript.firstTimestamp).toISOString() : null;
      for (const [model, tok] of models) {
        sessions.push({
          // Bare id when the session is single-model (the common case, keeps
          // ids stable); suffixed per model only when a split actually occurs.
          id: models.length > 1 ? `${baseId}__${model}` : baseId,
          tool: 'claude',
          cwd,
          project: '',
          model,
          startedAt,
          inputTokens: tok.input,
          outputTokens: tok.output,
          cacheReadTokens: tok.cacheRead,
          cacheWriteTokens: tok.cacheWrite,
          cacheWrite1hTokens: tok.cacheWrite1h,
          apiCalls: tok.calls,
          userTurns: (!isSubagent && model === transcript.turnModel)
            ? transcript.userTurns
            : null,
          isSubagent,
          dailyTokens: toDailyTokens(tok.byDay),
          cost: 0,
          currency: 'USD',
        });
      }
    };

    // Main session transcripts are flat .jsonl files directly in the project dir.
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.slice(0, -6);
      emit(path.join(dirPath, file), `claude_${sessionId}`, false);
    }

    // Delegated agents (Task tool) write their own transcripts under a
    // subagents/ directory nested beneath the session (and, for agents that
    // themselves delegate, deeper still). Same format, different model — this
    // is where Sonnet work lives when Opus/Fable delegates. Each becomes its
    // own session so per-model tokens and cost attribute correctly; there is
    // no recorded cost for them, so the normalizer estimates from tokens.
    for (const subFile of findSubagentTranscripts(dirPath)) {
      emit(subFile, `claude_sub_${path.basename(subFile, '.jsonl')}`, true);
    }
  }

  sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  return sessions;
}
