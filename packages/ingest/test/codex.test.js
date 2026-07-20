import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCodexData } from '../src/parsers/codex.js';

const FIXTURE_LINES = [
  JSON.stringify({
    timestamp: '2026-04-29T13:22:33.345Z',
    type: 'session_meta',
    payload: { id: 'test-codex-session', cwd: '/home/test/codex-project' }
  }),
  JSON.stringify({
    timestamp: '2026-04-29T13:22:33.354Z',
    type: 'turn_context',
    payload: { turn_id: 'turn-1', cwd: '/home/test/codex-project', model: 'gpt-5.5' }
  }),
  // Real Codex semantics (verified against live rollouts, 158 events, 0 violations):
  // cached_input_tokens ⊆ input_tokens, reasoning_output_tokens ⊆ output_tokens,
  // total_tokens === input_tokens + output_tokens.
  JSON.stringify({
    timestamp: '2026-04-29T13:22:36.305Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 13398,
          cached_input_tokens: 11648,
          output_tokens: 622,
          reasoning_output_tokens: 590,
          total_tokens: 14020
        }
      }
    }
  }),
].join('\n') + '\n';

describe('codex parser integration', () => {
  it('parses a rollout JSONL fixture with real token data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
    const sessionsDir = path.join(tmpDir, 'sessions', '2026', '04', '29');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionId = 'test-codex-session';
    fs.writeFileSync(
      path.join(sessionsDir, `rollout-2026-04-29T13-22-33-${sessionId}.jsonl`),
      FIXTURE_LINES
    );

    try {
      const sessions = parseCodexData(tmpDir);
      assert.strictEqual(sessions.length, 1, 'should find one session');

      const s = sessions[0];
      assert.strictEqual(s.tool, 'codex');
      assert.strictEqual(s.model, 'gpt-5.5', 'model should come from turn_context');
      assert.ok(s.startedAt, 'should have startedAt');
      assert.ok(s.inputTokens > 0, 'inputTokens should be non-zero');
      assert.ok(s.outputTokens > 0, 'outputTokens should be non-zero');
      assert.ok(s.cacheReadTokens > 0, 'cacheReadTokens should be non-zero');

      // Buckets must be disjoint (Claude-transcript semantics): Codex's
      // input_tokens INCLUDES cached and output_tokens INCLUDES reasoning,
      // so the parser must subtract cached out of input and must NOT add
      // reasoning on top of output.
      assert.strictEqual(s.inputTokens, 1750, 'input minus cached (disjoint buckets)');
      assert.strictEqual(s.outputTokens, 622, 'output already includes reasoning');
      assert.strictEqual(s.cacheReadTokens, 11648);
      assert.strictEqual(s.cacheWriteTokens, 0, 'codex has no cache write');

      const totalTokens = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
      assert.strictEqual(totalTokens, 14020, 'bucket sum equals Codex total_tokens');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for non-existent directory', () => {
    const sessions = parseCodexData('/nonexistent/path/xyz');
    assert.deepStrictEqual(sessions, []);
  });

  it('returns empty array when reading history.jsonl instead of rollout', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bad-'));
    try {
      // Create a history.jsonl (the wrong source) but no rollout
      fs.writeFileSync(path.join(tmpDir, 'history.jsonl'),
        JSON.stringify({ session_id: 'bad', ts: 123, text: 'hi' }) + '\n');
      const sessions = parseCodexData(tmpDir);
      assert.strictEqual(sessions.length, 0,
        'should return zero sessions from history.jsonl (not reading it)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
