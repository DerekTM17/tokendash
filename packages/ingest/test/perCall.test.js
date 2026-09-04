import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseClaudeJSON } from '../src/parsers/claude.js';
import { parseCodexData } from '../src/parsers/codex.js';
import { normalize } from '../src/normalizer.js';
import { DAILY_COLUMNS } from '../src/daily.js';

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

const userLine = (ts, content) => JSON.stringify({
  type: 'user',
  timestamp: ts,
  cwd: '/home/test/proj',
  message: { role: 'user', content },
});

describe('claude apiCalls', () => {
  it('counts one call per message.id, not per logged line', () => {
    const dir = tmpdir('calls-dedupe-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    // Claude Code logs a streamed response under one id several times, with the
    // final line carrying the full usage. That is ONE API call.
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [
      assistant('msg_a', '2026-07-01T10:00:00Z', usage(2, 0, 1000)),
      assistant('msg_a', '2026-07-01T10:00:01Z', usage(2, 0, 4000)),
      assistant('msg_b', '2026-07-01T10:05:00Z', usage(2, 4002, 500)),
    ].join('\n') + '\n');

    const [session] = parseClaudeJSON(dir);
    assert.equal(session.apiCalls, 2);
    assert.equal(session.cacheWriteTokens, 4500);
  });

  it('excludes <synthetic> error placeholders from the call count', () => {
    const dir = tmpdir('calls-synthetic-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [
      assistant('msg_a', '2026-07-01T10:00:00Z', usage(2, 0, 1000)),
      assistant('msg_err', '2026-07-01T10:00:30Z', usage(1, 0, 0), '<synthetic>'),
    ].join('\n') + '\n');

    const [session] = parseClaudeJSON(dir);
    assert.equal(session.apiCalls, 1);
  });

  it('clamps a 1h cache subset that exceeds its own cache-creation total', () => {
    const dir = tmpdir('calls-clamp-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    // Observed in 10 of 103,174 real usage entries. Clamping per call rather
    // than per session stops one over-report hiding under other calls' headroom.
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [
      assistant('msg_a', '2026-07-01T10:00:00Z', usage(2, 0, 100, 10, 900)),
      assistant('msg_b', '2026-07-01T10:01:00Z', usage(2, 100, 5000, 10, 0)),
    ].join('\n') + '\n');

    const [session] = parseClaudeJSON(dir);
    assert.equal(session.cacheWriteTokens, 5100);
    // Without the per-call clamp this would be 900, which is > the 100 written
    // on that call, and the session total (5100) would leave room to hide it.
    assert.equal(session.cacheWrite1hTokens, 100);
  });
});

describe('claude isSubagent', () => {
  it('flags subagent transcripts and not main ones', () => {
    const dir = tmpdir('calls-sub-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(path.join(proj, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'main.jsonl'),
      assistant('m1', '2026-07-01T10:00:00Z', usage(2, 0, 1000)) + '\n');
    fs.writeFileSync(path.join(proj, 'subagents', 'sub.jsonl'),
      assistant('s1', '2026-07-01T10:02:00Z', usage(2, 0, 500)) + '\n');

    const sessions = parseClaudeJSON(dir);
    const main = sessions.find(s => s.id === 'claude_main');
    const sub = sessions.find(s => s.id.startsWith('claude_sub_'));
    assert.equal(main.isSubagent, false);
    assert.equal(sub.isSubagent, true);
  });
});

describe('per-day attribution', () => {
  it('splits a multi-day session across days instead of stamping it at the start', () => {
    const dir = tmpdir('calls-daily-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    // The defect this whole change exists to fix: 95.2% of real main-thread
    // calls live in transcripts spanning more than one calendar day.
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [
      assistant('d1a', '2026-07-01T10:00:00Z', usage(2, 0, 1000)),
      assistant('d1b', '2026-07-01T11:00:00Z', usage(2, 1000, 500)),
      assistant('d3', '2026-07-03T09:00:00Z', usage(2, 1500, 200)),
    ].join('\n') + '\n');

    const [session] = parseClaudeJSON(dir);
    assert.deepEqual(session.dailyTokens.map(d => d.day), ['2026-07-01', '2026-07-03']);
    assert.deepEqual(session.dailyTokens.map(d => d.calls), [2, 1]);
    assert.equal(session.startedAt.slice(0, 10), '2026-07-01');
  });

  it('emits daily rows that sum back to the session totals', () => {
    const dir = tmpdir('calls-invariant-');
    const proj = path.join(dir, '-home-test-proj');
    fs.mkdirSync(proj, { recursive: true });
    // Real prompts on both days. Without them `userTurns` is 0 and the turns
    // assertion below is `0 === 0` — it holds no matter what the daily `turns`
    // column contains, which is the one column of the eleven this invariant
    // test would otherwise never check.
    fs.writeFileSync(path.join(proj, 's1.jsonl'), [
      userLine('2026-07-01T09:59:00Z', 'first prompt'),
      assistant('a', '2026-07-01T10:00:00Z', usage(3, 0, 1000, 40, 600)),
      userLine('2026-07-02T09:59:00Z', 'second prompt'),
      assistant('b', '2026-07-02T10:00:00Z', usage(5, 1000, 700, 60, 200)),
      userLine('2026-07-02T17:59:00Z', 'third prompt'),
      assistant('c', '2026-07-02T18:00:00Z', usage(7, 1700, 300, 80, 0)),
    ].join('\n') + '\n');

    const { normalized } = normalize(parseClaudeJSON(dir), []);
    const [s] = normalized;
    const sum = (i) => s.daily.reduce((acc, row) => acc + row[i], 0);

    assert.equal(sum(1), s.apiCalls, 'calls');
    assert.equal(sum(2), s.inputTokens, 'input');
    assert.equal(sum(3), s.outputTokens, 'output');
    assert.equal(sum(4), s.cacheReadTokens, 'cacheRead');
    assert.equal(sum(5), s.cacheWriteTokens, 'cacheWrite');
    for (const [i, part] of [[6, 'input'], [7, 'output'], [8, 'cacheRead'], [9, 'cacheWrite']]) {
      assert.ok(Math.abs(sum(i) - s.costParts[part]) < 1e-6, `cost ${part}`);
    }
    assert.ok(s.daily.length > 0);
    assert.equal(s.userTurns, 3, 'the fixture records real prompts, so turns is not vacuously 0');
    assert.equal(sum(10), s.userTurns ?? 0, 'turns');
    assert.equal(s.daily[0].length, DAILY_COLUMNS.length, 'row length matches the contract');
  });
});

// A rollout that inherits a conversation replays the parent's transcript at
// file-open time — including the PARENT's session_meta. 24 of 68 real rollouts
// hold two metas whose source disagrees, so "last one wins" mislabels every
// subagent thread as a main one.
function codexFixture(dir, sessionId, lines) {
  const day = path.join(dir, 'sessions', '2026', '07', '22');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(
    path.join(day, `rollout-2026-07-22T11-22-04-${sessionId}.jsonl`),
    lines.join('\n') + '\n'
  );
}

const codexMeta = (id, subagent) => JSON.stringify({
  timestamp: '2026-07-22T11:22:04.000Z',
  type: 'session_meta',
  payload: {
    id,
    cwd: '/home/test/proj',
    thread_source: subagent ? 'subagent' : 'user',
    source: subagent ? { subagent: { thread_spawn: { parent_thread_id: 'parent-1', depth: 1 } } } : 'cli',
  },
});

const codexCount = (ts, input, cached, output) => JSON.stringify({
  timestamp: ts,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
  },
});

describe('codex isSubagent', () => {
  it('trusts the first session_meta, not the replayed parent one', () => {
    const dir = tmpdir('codex-meta-');
    codexFixture(dir, 'own-thread', [
      codexMeta('own-thread', true),
      // The parent's meta, replayed into this file at open time.
      codexMeta('parent-thread', false),
      JSON.stringify({ timestamp: '2026-07-22T11:22:20.000Z', type: 'turn_context', payload: { model: 'gpt-5.6' } }),
      codexCount('2026-07-22T11:22:20.000Z', 5000, 4000, 100),
    ]);

    const [session] = parseCodexData(dir);
    assert.equal(session.isSubagent, true, 'last-wins would read the parent meta and say false');
  });

  it('ignores a meta whose id does not match the filename', () => {
    const dir = tmpdir('codex-meta-id-');
    codexFixture(dir, 'own-thread', [
      // Only the parent's meta appears before the thread's own work.
      codexMeta('some-other-thread', true),
      JSON.stringify({ timestamp: '2026-07-22T11:22:20.000Z', type: 'turn_context', payload: { model: 'gpt-5.6' } }),
      codexCount('2026-07-22T11:22:20.000Z', 5000, 4000, 100),
    ]);

    const [session] = parseCodexData(dir);
    assert.equal(session.isSubagent, false);
  });
});

describe('codex apiCalls', () => {
  it('counts only events that advance the cumulative counter', () => {
    const dir = tmpdir('codex-calls-');
    codexFixture(dir, 'own-thread', [
      codexMeta('own-thread', false),
      JSON.stringify({ timestamp: '2026-07-22T11:22:04.000Z', type: 'turn_context', payload: { model: 'gpt-5.6' } }),
      // Inside the 2s replay window: inherited history, tracked but not billed.
      codexCount('2026-07-22T11:22:04.500Z', 1000, 500, 50),
      // Real calls.
      codexCount('2026-07-22T11:22:30.000Z', 5000, 4000, 100),
      // A re-report of the same call: counter does not advance. Not a new call.
      codexCount('2026-07-22T11:22:31.000Z', 5000, 4000, 100),
      codexCount('2026-07-22T11:23:00.000Z', 9000, 7000, 180),
    ]);

    const [session] = parseCodexData(dir);
    assert.equal(session.apiCalls, 2);
  });

  it('attributes calls to their own day, not the rollout start', () => {
    const dir = tmpdir('codex-daily-');
    codexFixture(dir, 'own-thread', [
      codexMeta('own-thread', false),
      JSON.stringify({ timestamp: '2026-07-22T11:22:04.000Z', type: 'turn_context', payload: { model: 'gpt-5.6' } }),
      codexCount('2026-07-22T23:59:00.000Z', 5000, 4000, 100),
      codexCount('2026-07-23T00:05:00.000Z', 9000, 7000, 180),
    ]);

    const [session] = parseCodexData(dir);
    assert.deepEqual(session.dailyTokens.map(d => d.day), ['2026-07-22', '2026-07-23']);
    assert.deepEqual(session.dailyTokens.map(d => d.calls), [1, 1]);
  });
});
