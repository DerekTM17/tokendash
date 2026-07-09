import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

function extractProject(dir) {
  if (!dir) return 'other';
  const parts = dir.split(path.sep).filter(Boolean);
  return parts[parts.length - 1] || 'other';
}

function parseModel(raw) {
  if (!raw) return 'unknown';
  try {
    const parsed = JSON.parse(raw);
    return parsed.id || 'unknown';
  } catch {
    return 'unknown';
  }
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

    for (const row of rows) {
      // Prefer the project path inferred from the files the session touched;
      // fall back to the (usually uninformative) launch directory.
      const inferredDir = dirBySession.get(row.id);
      const dir = inferredDir || row.directory || '';
      const project = inferredDir ? extractProject(inferredDir) : 'other';

      sessions.push({
        id: row.id,
        tool: 'opencode',
        cwd: dir,
        project,
        model: parseModel(row.model),
        startedAt: row.time_created
          ? new Date(row.time_created).toISOString()
          : null,
        duration: null,
        inputTokens: row.tokens_input || 0,
        outputTokens: (row.tokens_output || 0) + (row.tokens_reasoning || 0),
        cacheReadTokens: row.tokens_cache_read || 0,
        cacheWriteTokens: row.tokens_cache_write || 0,
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
