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
  JSON.stringify({
    timestamp: '2026-04-29T13:22:34.000Z',
    type: 'response_item',
    payload: { type: 'function_call', arguments: '{"command":["bash","-lc","ls /home/test/projects/attractor/src && cat /home/test/projects/attractor/package.json"]}' }
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

      // Absolute paths mentioned in the transcript are tallied so the
      // normalizer can attribute home-dir-launched sessions to a project.
      assert.strictEqual(s.contentPathRefs['/home/test/projects/attractor/src'], 1);
      assert.strictEqual(s.contentPathRefs['/home/test/projects/attractor/package.json'], 1);

      // Codex rollouts carry no user-turn concept, and the binding rule is that
      // such rows carry `null`, never `0` — zero would make requests/turn
      // infinite and corrupt every mixed-tool aggregate. Asserted on PARSER
      // output: the normalizer's `?? null` fallback would mask the literal
      // going missing from codex.js, so testing only there proves nothing.
      assert.strictEqual(s.userTurns, null, 'codex rows carry null turns, never 0');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for non-existent directory', () => {
    const sessions = parseCodexData('/nonexistent/path/xyz');
    assert.deepStrictEqual(sessions, []);
  });

  // Regression: a rollout can switch models mid-session. The parser used to
  // latch the FIRST turn_context model and bill the whole cumulative counter
  // to it, which put 642M tokens on gpt-5.6-terra when the work was gpt-5.6-sol's.
  it('attributes tokens per model when a rollout switches models mid-session', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-split-'));
    const sessionsDir = path.join(tmpDir, 'sessions', '2026', '07', '21');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const tc = (t, model) => JSON.stringify({
      timestamp: t, type: 'turn_context', payload: { cwd: '/home/test/p', model }
    });
    // total_token_usage is CUMULATIVE across the whole rollout, so each event's
    // own usage is its delta from the previous event.
    const usage = (t, input, cached, output) => JSON.stringify({
      timestamp: t, type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: {
        input_tokens: input, cached_input_tokens: cached,
        output_tokens: output, reasoning_output_tokens: 0,
        total_tokens: input + output } } }
    });

    const lines = [
      JSON.stringify({ timestamp: '2026-07-21T16:05:41.495Z', type: 'session_meta',
        payload: { id: 'split-session', cwd: '/home/test/p' } }),
      tc('2026-07-21T16:05:42.000Z', 'gpt-5.6-terra'),
      usage('2026-07-21T16:05:50.000Z', 1000, 400, 50),
      // /model switch — everything after this belongs to sol
      tc('2026-07-21T16:06:00.000Z', 'gpt-5.6-sol'),
      usage('2026-07-21T16:06:10.000Z', 9000, 7400, 250),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(sessionsDir, 'rollout-2026-07-21T12-05-35-split-session.jsonl'), lines);

    try {
      const sessions = parseCodexData(tmpDir);
      assert.strictEqual(sessions.length, 2, 'one session row per model');

      const terra = sessions.find(s => s.model === 'gpt-5.6-terra');
      const sol = sessions.find(s => s.model === 'gpt-5.6-sol');
      assert.ok(terra && sol, 'both models present');

      // terra: first event only — 1000 input of which 400 cached, 50 output.
      assert.strictEqual(terra.inputTokens, 600);
      assert.strictEqual(terra.cacheReadTokens, 400);
      assert.strictEqual(terra.outputTokens, 50);

      // sol: the DELTA of the cumulative counter, not its absolute value.
      assert.strictEqual(sol.inputTokens, 1000, '(9000-1000) minus (7400-400) cached');
      assert.strictEqual(sol.cacheReadTokens, 7000);
      assert.strictEqual(sol.outputTokens, 200);

      // Ids are suffixed only when a split actually occurs (matches claude.js).
      assert.ok(terra.id.endsWith('__gpt-5.6-terra'), `got ${terra.id}`);
      assert.ok(sol.id.endsWith('__gpt-5.6-sol'), `got ${sol.id}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Regression: Codex subagent/resumed threads replay the PARENT's entire
  // transcript into the new rollout at file-open time (787 of 800 token_count
  // events in one real case), re-stamped with the open timestamp. Billing those
  // counted the parent's history once per child.
  it('skips inherited history replayed at file open', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-replay-'));
    const sessionsDir = path.join(tmpDir, 'sessions', '2026', '07', '22');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const usage = (t, input, cached, output) => JSON.stringify({
      timestamp: t, type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: {
        input_tokens: input, cached_input_tokens: cached,
        output_tokens: output, reasoning_output_tokens: 0,
        total_tokens: input + output } } }
    });

    const lines = [
      JSON.stringify({ timestamp: '2026-07-22T15:12:11.672Z', type: 'session_meta',
        payload: { id: 'child-session', cwd: '/home/test/p',
          parent_thread_id: 'parent-session',
          source: { subagent: { thread_spawn: { parent_thread_id: 'parent-session', depth: 1 } } } } }),
      JSON.stringify({ timestamp: '2026-07-22T15:12:11.672Z', type: 'turn_context',
        payload: { cwd: '/home/test/p', model: 'gpt-5.6-sol' } }),
      // --- replayed parent history: dumped in a burst at file open ---
      usage('2026-07-22T15:12:11.673Z', 500000, 480000, 3000),
      usage('2026-07-22T15:12:11.700Z', 900000, 870000, 5000),
      usage('2026-07-22T15:12:11.730Z', 1000000, 960000, 6000),
      // --- this thread's own work, seconds later ---
      usage('2026-07-22T15:12:18.010Z', 1040000, 995000, 6100),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(sessionsDir, 'rollout-2026-07-22T11-12-11-child-session.jsonl'), lines);

    try {
      const sessions = parseCodexData(tmpDir);
      assert.strictEqual(sessions.length, 1);
      const s = sessions[0];

      // Only the final event is this thread's own: deltas off the last
      // replayed counter (1040000-1000000 input, 995000-960000 cached).
      assert.strictEqual(s.cacheReadTokens, 35000, 'inherited cache reads not re-billed');
      assert.strictEqual(s.inputTokens, 5000, '(1040000-1000000) minus 35000 cached');
      assert.strictEqual(s.outputTokens, 100);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
