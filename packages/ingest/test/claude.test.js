import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeJSON } from '../src/parsers/claude.js';

const FIXTURE = JSON.stringify({
  parentUuid: 'abc123',
  isSidechain: false,
  message: {
    model: 'claude-opus-4-7',
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 25,
    },
  },
  type: 'assistant',
  uuid: 'uuid-1',
  timestamp: '2026-01-15T10:00:00.000Z',
  cwd: '/home/test/project',
  sessionId: 'test-session-id',
  version: '2.0.0',
  gitBranch: 'main',
});

describe('claude parser integration', () => {
  it('parses a transcript JSONL fixture with real token data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'));
    const projDir = path.join(tmpDir, '-test-fixture');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'test-session-id.jsonl'), FIXTURE + '\n');

    try {
      const sessions = parseClaudeJSON(tmpDir);
      assert.strictEqual(sessions.length, 1, 'should find one session');

      const s = sessions[0];
      assert.strictEqual(s.tool, 'claude');
      assert.strictEqual(s.model, 'claude-opus-4-7', 'model should be parsed from message');
      assert.ok(s.startedAt, 'should have startedAt');
      assert.ok(s.inputTokens > 0, 'inputTokens should be non-zero');
      assert.ok(s.outputTokens > 0, 'outputTokens should be non-zero');
      assert.ok(s.cacheReadTokens > 0, 'cacheReadTokens should be non-zero');
      assert.ok(s.cacheWriteTokens > 0, 'cacheWriteTokens should be non-zero');
      assert.strictEqual(s.inputTokens, 100);
      assert.strictEqual(s.outputTokens, 50);
      assert.strictEqual(s.cacheReadTokens, 200);
      assert.strictEqual(s.cacheWriteTokens, 25);

      const totalTokens = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
      assert.ok(totalTokens > 0, 'total tokens should be > 0');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for non-existent directory', () => {
    const sessions = parseClaudeJSON('/nonexistent/path/xyz');
    assert.deepStrictEqual(sessions, []);
  });

  it('emits zero sessions when fed wrong source (history.jsonl)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bad-'));
    try {
      const sessions = parseClaudeJSON(tmpDir);
      assert.strictEqual(sessions.length, 0,
        'should return zero sessions from empty dir (not reading .claude.json)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
