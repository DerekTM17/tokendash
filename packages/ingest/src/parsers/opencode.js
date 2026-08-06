import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

function extractProject(dir) {
  if (!dir) return 'other';
  const parts = dir.split(path.sep).filter(Boolean);
  return parts[parts.length - 1] || 'other';
}

function parseModel(raw, fallback) {
  if (!raw) return fallback || 'unknown';
  try {
    const parsed = JSON.parse(raw);
    return parsed.id || fallback || 'unknown';
  } catch {
    return fallback || 'unknown';
  }
}

// Early opencode session rows never had the `model` column populated, so two
// real April sessions read as 'unknown' and their 31.8M tokens priced $2.02
// against ccusage's $8.24 — the model was deepseek-v4-pro all along, recorded
// on each assistant message. Recover it from there when the session row is
// silent. Every one of the 27 local sessions carrying message-level models
// used exactly one, so the dominant model is unambiguous; if that ever stops
// holding, this is the place a per-model split would go (as in claude.js and
// codex.js), which needs per-message tokens rather than the session totals.
// Also counts assistant message rows per session, which is opencode's stand-in
// for an API-call count — the session row carries only aggregates. Folded into
// this pass rather than a second query since it walks the same rows.
function modelsByMessage(db) {
  const modelBySession = new Map();
  const callsBySession = new Map();
  let rows;
  try {
    rows = db.prepare('SELECT session_id, data FROM message WHERE data IS NOT NULL').all();
  } catch {
    return { modelBySession, callsBySession }; // older DBs may not have the table
  }
  const counts = new Map();
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (data.role === 'assistant') {
      callsBySession.set(row.session_id, (callsBySession.get(row.session_id) || 0) + 1);
    }
    const model = data.modelID;
    if (!model) continue;
    let byModel = counts.get(row.session_id);
    if (!byModel) {
      byModel = new Map();
      counts.set(row.session_id, byModel);
    }
    byModel.set(model, (byModel.get(model) || 0) + 1);
  }
  for (const [sid, byModel] of counts) {
    let best = null;
    let bestHits = -1;
    for (const [m, hits] of byModel) {
      if (hits > bestHits) {
        bestHits = hits;
        best = m;
      }
    }
    if (best) modelBySession.set(sid, best);
  }
  return { modelBySession, callsBySession };
}

// opencode records the same launch directory ($HOME) for every session, so the
// session row carries no project signal. The real project is recoverable from
// the file paths the session actually touched, stored in each message part's
// JSON `data`. We scan those paths and pick the dominant project root per
// session; the normalizer then maps that path to a discovered project.
const PROJECT_PATH_RE = /\/(?:home|Users)\/[^/"\s]+\/(?:opencode\/projects|projects)\/[A-Za-z0-9_.-]+/g;

function inferSessionDirs(db) {
  const dirBySession = new Map();
  let rows;
  try {
    rows = db.prepare('SELECT session_id, data FROM part WHERE data IS NOT NULL').all();
  } catch {
    return dirBySession;
  }
  const counts = new Map(); // session_id -> Map(projectRootPath -> hits)
  for (const row of rows) {
    if (!row.data) continue;
    const matches = row.data.match(PROJECT_PATH_RE);
    if (!matches) continue;
    let byPath = counts.get(row.session_id);
    if (!byPath) {
      byPath = new Map();
      counts.set(row.session_id, byPath);
    }
    for (const m of matches) byPath.set(m, (byPath.get(m) || 0) + 1);
  }
  for (const [sid, byPath] of counts) {
    let best = null;
    let bestHits = -1;
    for (const [p, hits] of byPath) {
      if (hits > bestHits) {
        bestHits = hits;
        best = p;
      }
    }
    if (best) dirBySession.set(sid, best);
  }
  return dirBySession;
}

export function parseOpencodeSessions(dbPath) {
  const sessions = [];

  const resolvedPath = dbPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

  let db;
  try {
    db = new DatabaseSync(resolvedPath, { readonly: true });
  } catch {
    return sessions;
  }

  try {
    const rows = db.prepare(`
      SELECT
        id, directory, title, model, project_id,
        cost, tokens_input, tokens_output, tokens_reasoning,
        tokens_cache_read, tokens_cache_write,
        time_created
      FROM session
      ORDER BY time_created DESC
    `).all();

    const dirBySession = inferSessionDirs(db);
    const { modelBySession, callsBySession } = modelsByMessage(db);

    for (const row of rows) {
      // Prefer the project path inferred from the files the session touched;
      // fall back to the (usually uninformative) launch directory.
      const inferredDir = dirBySession.get(row.id);
      const dir = inferredDir || row.directory || '';
      const project = inferredDir ? extractProject(inferredDir) : 'other';

      const startedAt = row.time_created ? new Date(row.time_created).toISOString() : null;
      const tokens = {
        input: row.tokens_input || 0,
        output: (row.tokens_output || 0) + (row.tokens_reasoning || 0),
        cacheRead: row.tokens_cache_read || 0,
        cacheWrite: row.tokens_cache_write || 0,
        cacheWrite1h: 0,
      };
      const apiCalls = callsBySession.get(row.id) || 0;

      sessions.push({
        id: row.id,
        tool: 'opencode',
        cwd: dir,
        project,
        // The session row wins when it has a model; messages are the fallback.
        model: parseModel(row.model, modelBySession.get(row.id)),
        startedAt,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        apiCalls,
        // opencode has no subagent concept to expose.
        isSubagent: false,
        // Single slice at the session start carrying the whole session. The
        // session row's aggregates are authoritative for tokens and cost, and
        // rebuilding a per-day split from message rows risks breaking the
        // "daily sums to session totals" invariant — opencode has revert/undo,
        // which deletes messages while the aggregates persist. Acceptable
        // because opencode is 27 sessions and $8.24 lifetime (0.1% of spend),
        // its sessions are short, and it is not plotted. Revisit if that
        // changes.
        dailyTokens: startedAt
          ? [{ day: startedAt.slice(0, 10), calls: apiCalls, ...tokens }]
          : [],
        cost: row.cost || 0,
        currency: 'USD',
      });
    }
  } catch {
  } finally {
    db.close();
  }

  return sessions;
}

export function defaultPath() {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'session_diff');
}
