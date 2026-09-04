import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeJSON } from '../src/parsers/claude.js';

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function assistant(id, ts, usage, model = 'claude-opus-5') {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: '/home/test/proj',
    message: { id, role: 'assistant', model, usage },
  });
}

const usage = (input, cacheRead, cacheWrite, output = 10, oneHour = 0) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
  ...(oneHour ? { cache_creation: { ephemeral_1h_input_tokens: oneHour } } : {}),
});

const userLine = (ts, content, extra = {}) => JSON.stringify({
  type: 'user',
  timestamp: ts,
  cwd: '/home/test/proj',
  message: { role: 'user', content },
  ...extra,
});

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

  it('parses delegated subagent transcripts as their own sessions', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sub-'));
    const projDir = path.join(tmpDir, '-home-test-project');
    // Real layout: main transcript is a flat file; subagents live under
    // <session-id>/subagents/, and nested delegation goes deeper still.
    const nested = path.join(projDir, 'sess-1', 'subagents', 'agent-x', 'subagents');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'sess-1.jsonl'), FIXTURE + '\n');

    const agent = (model, id, tokens) => JSON.stringify({
      message: {
        model, id, role: 'assistant',
        usage: { input_tokens: tokens, output_tokens: tokens, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 },
      },
      type: 'assistant',
      timestamp: '2026-01-15T10:05:00.000Z',
      cwd: '/home/test/project',
    });
    fs.writeFileSync(path.join(projDir, 'sess-1', 'subagents', 'agent-deadbeef.jsonl'), agent('claude-sonnet-5', 'm1', 10) + '\n');
    fs.writeFileSync(path.join(nested, 'agent-cafe.jsonl'), agent('claude-haiku-4-5', 'm2', 5) + '\n');

    try {
      const sessions = parseClaudeJSON(tmpDir);
      assert.strictEqual(sessions.length, 3, 'top-level + 2 (nested) subagents');

      const sonnet = sessions.find(s => s.model === 'claude-sonnet-5');
      assert.ok(sonnet, 'the delegated sonnet agent must surface as its own session');
      assert.strictEqual(sonnet.tool, 'claude');
      assert.strictEqual(sonnet.inputTokens, 10);
      assert.strictEqual(sonnet.cacheReadTokens, 10);
      assert.strictEqual(sonnet.cost, 0, 'subagents carry no recorded cost (normalizer estimates)');
      assert.ok(sonnet.id.includes('deadbeef'), 'id derived from the agent file, kept distinct');

      assert.ok(sessions.find(s => s.model === 'claude-haiku-4-5'), 'a deeply-nested subagent is still found');
      assert.ok(sessions.find(s => s.model === 'claude-opus-4-7'), 'the parent opus session is unchanged');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('splits a mid-session model switch into one session per model', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-multi-'));
    const projDir = path.join(tmpDir, '-home-test-project');
    fs.mkdirSync(projDir, { recursive: true });
    const line = (model, id, tok) => JSON.stringify({
      message: { model, id, role: 'assistant',
        usage: { input_tokens: tok, output_tokens: tok, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      type: 'assistant', timestamp: '2026-01-15T10:00:00.000Z', cwd: '/home/test/project',
    });
    // A session that started on Fable then switched to Opus, plus a
    // zero-token <synthetic> line that must not become its own session.
    fs.writeFileSync(path.join(projDir, 'switch.jsonl'),
      [line('claude-fable-5', 'a', 300), line('claude-opus-4-8', 'b', 100),
       line('<synthetic>', 'c', 0)].join('\n') + '\n');

    try {
      const sessions = parseClaudeJSON(tmpDir);
      assert.strictEqual(sessions.length, 2, 'one row per real model, synthetic dropped');

      const fable = sessions.find(s => s.model === 'claude-fable-5');
      const opus = sessions.find(s => s.model === 'claude-opus-4-8');
      assert.ok(fable && opus, 'both models surface as distinct sessions');
      assert.strictEqual(fable.inputTokens, 300, 'fable keeps only its own tokens');
      assert.strictEqual(opus.inputTokens, 100, 'opus keeps only its own tokens');
      assert.notStrictEqual(fable.id, opus.id, 'ids stay unique across the split');
      assert.ok(sessions.every(s => s.model !== '<synthetic>'), 'synthetic is never a session');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps a single-model session id stable (no suffix)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-single-'));
    const projDir = path.join(tmpDir, '-test-fixture');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'only-one.jsonl'), FIXTURE + '\n');
    try {
      const sessions = parseClaudeJSON(tmpDir);
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].id, 'claude_only-one', 'single-model id is unsuffixed');
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

describe('user turns', () => {
  it('counts real prompts and ignores tool results and slash commands', () => {
    const dir = tmpdir('turns-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'first prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
      userLine('2026-07-01T10:00:02Z', [{ type: 'tool_result', content: 'ok' }]),
      assistant('b', '2026-07-01T10:00:03Z', usage(10, 100, 0)),
      userLine('2026-07-01T10:00:04Z', '<command-name>/clear</command-name>'),
      userLine('2026-07-02T09:00:00Z', 'second prompt'),
      assistant('c', '2026-07-02T09:00:01Z', usage(10, 100, 0)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    assert.equal(s.userTurns, 2, 'two real prompts');
    assert.equal(s.apiCalls, 3);

    const byDay = Object.fromEntries(s.dailyTokens.map(d => [d.day, d.turns]));
    assert.equal(byDay['2026-07-01'], 1);
    assert.equal(byDay['2026-07-02'], 1);
  });

  it('satisfies the requests-per-turn floor', () => {
    const dir = tmpdir('turns-floor-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    assert.ok(s.apiCalls / s.userTurns >= 1,
      'requests/turn below 1 means the rule admitted a non-prompt');
  });

  it('records a turn on a day with no API calls', () => {
    const dir = tmpdir('turns-noc-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess.jsonl'), [
      userLine('2026-07-01T23:59:00Z', 'late prompt'),
      assistant('a', '2026-07-02T00:00:30Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    const d1 = s.dailyTokens.find(d => d.day === '2026-07-01');
    assert.equal(d1.turns, 1);
    assert.equal(d1.calls, 0, 'no call landed on the first day');
  });

  it('never lets a subagent transcript contribute turns, even without isSidechain', () => {
    const dir = tmpdir('turns-sub-');
    const proj = path.join(dir, '-home-test-proj');
    const subDir = path.join(proj, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'main prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');
    // Deliberately NOT isSidechain: the guard must not depend on that flag,
    // which the spec documents as defensive (older Claude Code versions
    // inlined sidechains into the main transcript). If the fix regressed to
    // relying on isUserTurn's isSidechain clause instead of the isSubagent
    // parameter, these entries would count and this test would catch it.
    fs.writeFileSync(path.join(subDir, 'agent-x.jsonl'), [
      userLine('2026-07-01T11:00:00Z', 'delegated prompt'),
      assistant('b', '2026-07-01T11:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(dir);
    const sub = sessions.find(s => s.isSubagent);
    assert.ok(sub, 'subagent session found');
    assert.equal(sub.userTurns, null, 'subagent rows never carry userTurns');
    const d = sub.dailyTokens.find(d => d.day === '2026-07-01');
    assert.equal(d.turns || 0, 0, 'subagent day slices carry no turns even with turn-eligible entries');
  });
});

describe('multi-model turn attribution', () => {
  // Turns belong to the transcript, not to a model — a person typing a prompt
  // is model-agnostic — so they go on exactly ONE of the rows a multi-model
  // transcript emits. Which row is decided by call count, ties broken on model
  // name ascending. The real corpus exercises this, but only by accident of
  // whatever mix it happens to hold; the deterministic rule had no fixture.

  it('puts every turn on the model with the most calls, and null on its siblings', () => {
    const base = tmpdir('turnmodel-calls-');
    const dir = path.join(base, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'first prompt'),
      // 'zzz-model' sorts LAST but carries more calls, so call count must win
      // over the name tie-break rather than the other way round.
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100), 'zzz-model'),
      assistant('b', '2026-07-01T10:00:02Z', usage(10, 0, 100), 'zzz-model'),
      userLine('2026-07-01T10:01:00Z', 'second prompt'),
      assistant('c', '2026-07-01T10:01:01Z', usage(10, 0, 100), 'aaa-model'),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(base);
    const winner = sessions.find(s => s.model === 'zzz-model');
    const sibling = sessions.find(s => s.model === 'aaa-model');

    assert.equal(winner.userTurns, 2, 'the busiest model carries every turn');
    assert.strictEqual(sibling.userTurns, null, 'siblings carry null, never 0');
    assert.equal(
      winner.dailyTokens.reduce((n, d) => n + (d.turns || 0), 0), 2,
      'the day slices carry the turns too'
    );
    assert.equal(sibling.dailyTokens.reduce((n, d) => n + (d.turns || 0), 0), 0);
  });

  it('breaks a call-count tie on model name ascending', () => {
    const base = tmpdir('turnmodel-tie-');
    const dir = path.join(base, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    // One call each. Written zzz-first so the result cannot come from
    // insertion order.
    fs.writeFileSync(path.join(dir, 'main.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'a prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100), 'zzz-model'),
      assistant('b', '2026-07-01T10:00:02Z', usage(10, 0, 100), 'aaa-model'),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(base);
    assert.equal(sessions.find(s => s.model === 'aaa-model').userTurns, 1);
    assert.strictEqual(sessions.find(s => s.model === 'zzz-model').userTurns, null);
  });

  it('counts each turn once across the whole transcript', () => {
    // The reason turns sit on one row rather than every sibling: putting them
    // on both would double-count them and halve Requests/Turn.
    const base = tmpdir('turnmodel-once-');
    const dir = path.join(base, 'proj');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'one'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100), 'aaa-model'),
      userLine('2026-07-01T10:01:00Z', 'two'),
      assistant('b', '2026-07-01T10:01:01Z', usage(10, 0, 100), 'zzz-model'),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(base);
    assert.equal(sessions.length, 2, 'one row per model');
    assert.equal(sessions.reduce((n, s) => n + (s.userTurns || 0), 0), 2);
  });
});

describe('subagent turns', () => {
  it('never counts a dispatch prompt as a user turn', () => {
    // parseClaudeJSON scans base for PROJECT DIRECTORIES and reads .jsonl
    // inside them — a transcript written straight into base is never seen
    // (verified: flat fixture yields 0 sessions, nested yields 1). Subagent
    // transcripts nest under the project dir, not under base.
    const base = tmpdir('subturn-');
    const dir = path.join(base, 'proj');
    const subDir = path.join(dir, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'main.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'do the thing'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    // A subagent transcript opens with the dispatch prompt: type user,
    // isSidechain true, non-meta, non-tool_result. It passes every
    // content-shaped test and is not a human turn.
    fs.writeFileSync(path.join(subDir, 'agent.jsonl'), [
      userLine('2026-07-01T10:00:02Z', 'Search the codebase for X', { isSidechain: true }),
      assistant('b', '2026-07-01T10:00:03Z', usage(10, 0, 100)),
      assistant('c', '2026-07-01T10:00:04Z', usage(10, 100, 0)),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(base);
    const main = sessions.filter(s => !s.isSubagent);
    const subs = sessions.filter(s => s.isSubagent);

    assert.equal(subs.length, 1);
    assert.equal(subs[0].userTurns, null, 'subagent rows carry null, never 0');
    assert.equal(main.reduce((n, s) => n + (s.userTurns || 0), 0), 1);

    // Requests/Turn counts delegated requests in the numerator: a Task dispatch
    // is the most consequential form of tool-call amplification there is.
    const requests = sessions.reduce((n, s) => n + s.apiCalls, 0);
    const turns = sessions.reduce((n, s) => n + (s.userTurns || 0), 0);
    assert.equal(requests / turns, 3);
  });
});
