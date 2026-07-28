import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOpencodeSessions } from '../src/parsers/opencode.js';

function createFixtureDb(tmpDir) {
  const dbPath = path.join(tmpDir, 'opencode.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      name TEXT,
      worktree TEXT
    );

    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      slug TEXT,
      directory TEXT,
      title TEXT,
      version TEXT,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT,
      path TEXT,
      agent TEXT,
      model TEXT,
      cost REAL DEFAULT 0,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_reasoning INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_write INTEGER DEFAULT 0,
      metadata TEXT
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
  `);

  db.prepare(`INSERT INTO project (id, name, worktree) VALUES (?, ?, ?)`)
    .run('global', 'global', '/');
  db.prepare(`INSERT INTO project (id, name, worktree) VALUES (?, ?, ?)`)
    .run('proj-1', 'test-project', '/tmp/test');

  const modelJson = JSON.stringify({ id: 'test-model-v1', providerID: 'test-provider' });
  db.prepare(`INSERT INTO session (id, project_id, directory, title, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ses_001', 'proj-1', '/tmp/test', 'Test session', modelJson, 0.05, 500, 200, 100, 300, 50, 1700000000000);

  // Second session with null model (should get 'unknown') and no part paths
  db.prepare(`INSERT INTO session (id, project_id, directory, title, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ses_002', 'global', '/home/user', 'Another session', null, 0.02, 1000, 500, 0, 200, 0, 1700000001000);

  // opencode records $HOME as every session's directory, so the project is
  // recovered from the file paths the session touched (stored in part.data).
  // ses_001 touches files under a real project; ses_002 touches nothing.
  const toolCall = JSON.stringify({
    type: 'tool',
    tool: 'edit',
    state: { input: { filePath: '/home/user/projects/test-project/src/index.js' } },
  });
  db.prepare(`INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)`)
    .run('prt_1', 'msg_1', 'ses_001', toolCall);
  db.prepare(`INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)`)
    .run('prt_2', 'msg_1', 'ses_001', toolCall);

  // Third session: the session row carries NO model (early opencode rows never
  // had the column backfilled), but its assistant messages record modelID.
  db.prepare(`INSERT INTO session (id, project_id, directory, title, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ses_003', 'global', '/home/user', 'Early session', null, 0.9, 600, 300, 0, 30000, 0, 1700000002000);

  const asstMsg = JSON.stringify({
    role: 'assistant', modelID: 'deepseek-v4-pro', providerID: 'opencode-go',
  });
  const userMsg = JSON.stringify({ role: 'user' });
  db.prepare(`INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`)
    .run('msg_a', 'ses_003', userMsg);
  db.prepare(`INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`)
    .run('msg_b', 'ses_003', asstMsg);
  db.prepare(`INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`)
    .run('msg_c', 'ses_003', asstMsg);

  db.close();
  return dbPath;
}

describe('opencode parser integration', () => {
  it('parses a real sqlite fixture with token data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
    try {
      const dbPath = createFixtureDb(tmpDir);
      const sessions = parseOpencodeSessions(dbPath);

      assert.strictEqual(sessions.length, 3, 'should find three sessions');

      // Session 1: with JSON model and non-global project
      const s1 = sessions.find(x => x.id === 'ses_001');
      assert.ok(s1, 'should find ses_001');
      assert.strictEqual(s1.tool, 'opencode');
      assert.strictEqual(s1.model, 'test-model-v1', 'model should be parsed from JSON');
      assert.strictEqual(s1.project, 'test-project', 'project should be inferred from the file paths in part.data');
      assert.strictEqual(s1.inputTokens, 500);
      assert.strictEqual(s1.outputTokens, 300, 'output should include reasoning tokens');
      assert.strictEqual(s1.cacheReadTokens, 300);
      assert.strictEqual(s1.cacheWriteTokens, 50);
      assert.strictEqual(s1.cost, 0.05);
      assert.ok(s1.startedAt, 'should have startedAt');

      const total1 = s1.inputTokens + s1.outputTokens + s1.cacheReadTokens + s1.cacheWriteTokens;
      assert.ok(total1 > 0, 'total tokens should be > 0');

      // Session 2: null model
      const s2 = sessions.find(x => x.id === 'ses_002');
      assert.ok(s2, 'should find ses_002');
      assert.strictEqual(s2.model, 'unknown', 'null model should become unknown');
      assert.strictEqual(s2.project, 'other', 'a session with no recoverable file paths falls back to "other"');

    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Regression: session.model was NULL on two real April sessions, so 31.8M
  // tokens read as model "unknown" and priced $2.02 against ccusage's $8.24 —
  // the tokens were deepseek-v4-pro's all along, recorded on the messages.
  it('recovers the model from messages when session.model is null', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-model-'));
    try {
      const dbPath = createFixtureDb(tmpDir);
      const sessions = parseOpencodeSessions(dbPath);

      const s = sessions.find(x => x.id === 'ses_003');
      assert.ok(s, 'session with null model should still be parsed');
      assert.strictEqual(s.model, 'deepseek-v4-pro', 'model recovered from messages');

      // A session with neither a model column nor messages stays 'unknown'
      // rather than inheriting someone else's model.
      const noMsgs = sessions.find(x => x.id === 'ses_002');
      assert.strictEqual(noMsgs.model, 'unknown');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for missing db', () => {
    const sessions = parseOpencodeSessions('/nonexistent/opencode.db');
    assert.deepStrictEqual(sessions, []);
  });

  it('returns empty array when reading wrong db (no session table)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bad-'));
    try {
      const badPath = path.join(tmpDir, 'not-a-db.sqlite');
      fs.writeFileSync(badPath, 'not a valid sqlite file');
      const sessions = parseOpencodeSessions(badPath);
      assert.deepStrictEqual(sessions, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
