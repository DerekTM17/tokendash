import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function decodeCwdFromDir(dirName) {
  if (dirName.charAt(0) === '-') dirName = dirName.slice(1);
  return '/' + dirName.replace(/-/g, '/');
}

function readClaudeConfig(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const projects = raw.projects || {};
  const bySessionId = new Map();

  for (const [cwd, value] of Object.entries(projects)) {
    if (typeof value !== 'object' || value === null) continue;
    if (!value.lastSessionId) continue;

    bySessionId.set(value.lastSessionId, {
      cwd,
      cost: value.lastCost || 0,
      duration: value.lastDuration || null,
    });
  }
  return bySessionId;
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
  const byModel = new Map();
  for (const t of usageById.values()) {
    if (t.model === '<synthetic>') continue;
    const acc = byModel.get(t.model) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    acc.input += t.input;
    acc.output += t.output;
    acc.cacheRead += t.cacheRead;
    acc.cacheWrite += t.cacheWrite;
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

  return { cwd, firstTimestamp, byModel };
}

export function parseClaudeJSON(projectsDir) {
  const base = projectsDir || path.join(os.homedir(), '.claude', 'projects');
  const configPath = path.join(os.homedir(), '.claude.json');
  const configBySession = fs.existsSync(configPath)
    ? readClaudeConfig(configPath)
    : new Map();

  const sessions = [];

  if (!fs.existsSync(base)) return sessions;

  const projDirs = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const projDir of projDirs) {
    const dirPath = path.join(base, projDir.name);

    // Turn one transcript file into session rows — one per model used, so a
    // mid-session /model switch attributes each model's tokens correctly.
    // `config` supplies a recorded cost when we have one (top-level sessions
    // matched by id); subagents have none, so cost stays 0 and the normalizer
    // estimates it from tokens x model pricing.
    const emit = (filePath, baseId, config = {}) => {
      let transcript;
      try {
        transcript = parseTranscriptFile(filePath);
      } catch {
        return;
      }
      const models = [...transcript.byModel.entries()];
      // The transcript's own cwd is authoritative. Only fall back to the config
      // path or the folder-name decode (lossy — it turns any '-' in a real dir
      // name into '/') when the transcript carried no cwd.
      const cwd = transcript.cwd || config.cwd || decodeCwdFromDir(projDir.name);
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
          duration: config.duration || null,
          inputTokens: tok.input,
          outputTokens: tok.output,
          cacheReadTokens: tok.cacheRead,
          cacheWriteTokens: tok.cacheWrite,
          // A recorded cost covers the whole transcript; only trust it for a
          // single-model session. Split sessions fall back to per-model
          // estimation (in practice no config-priced session is multi-model).
          cost: (models.length === 1 && config.cost) || 0,
          currency: 'USD',
        });
      }
    };

    // Main session transcripts are flat .jsonl files directly in the project
    // dir; the matching cost lives in .claude.json keyed by session id.
    for (const file of fs.readdirSync(dirPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.slice(0, -6);
      emit(path.join(dirPath, file), `claude_${sessionId}`, configBySession.get(sessionId) || {});
    }

    // Delegated agents (Task tool) write their own transcripts under a
    // subagents/ directory nested beneath the session (and, for agents that
    // themselves delegate, deeper still). Same format, different model — this
    // is where Sonnet work lives when Opus/Fable delegates. Each becomes its
    // own session so per-model tokens and cost attribute correctly; there is
    // no recorded cost for them, so the normalizer estimates from tokens.
    for (const subFile of findSubagentTranscripts(dirPath)) {
      emit(subFile, `claude_sub_${path.basename(subFile, '.jsonl')}`);
    }
  }

  sessions.sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  return sessions;
}

export function defaultPath() {
  return path.join(os.homedir(), '.claude.json');
}
