// packages/hooks/test/directive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costFigures, buildDirective } from '../lib/directive.mjs';

test('costFigures computes per-turn cost and break-even', () => {
  const f = costFigures({ tokens: 300_000, cacheRate: 0.5, floor: 35_620 });
  assert.ok(Math.abs(f.perTurn - 0.15) < 0.001, 'perTurn = 300k * 0.5 / 1e6');
  assert.ok(Math.abs(f.freshPerTurn - 0.0178) < 0.001);
  assert.ok(f.breakEven > 1.5 && f.breakEven < 2.5, `break-even ~1.9 turns, got ${f.breakEven}`);
});

test('break-even falls as context grows', () => {
  const a = costFigures({ tokens: 200_000, cacheRate: 0.5 });
  const b = costFigures({ tokens: 500_000, cacheRate: 0.5 });
  assert.ok(b.breakEven < a.breakEven);
});

test('arm mode asks for a silent judgement and keeps the continue branch', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 4, mode: 'arm' });
  assert.match(d.additionalContext, /SESSION BOUNDARY CHECK/);
  assert.match(d.additionalContext, /continue the current thread/i);
  assert.match(d.additionalContext, /If it continues/i);
  assert.match(d.additionalContext, /Never do both/i);
  assert.match(d.additionalContext, /4 files/);
  assert.match(d.systemMessage, /250k/);
});

test('ceiling mode removes the judgement call', () => {
  const d = buildDirective({ tokens: 350_000, cacheRate: 0.5, staleReads: 0, mode: 'ceiling' });
  assert.match(d.additionalContext, /regardless of topic/i);
  assert.doesNotMatch(d.additionalContext, /If it continues/i);
});

test('stale-read sentence is omitted when the count is zero', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 0, mode: 'arm' });
  assert.doesNotMatch(d.additionalContext, /stale copies/);
});

test('directive stays small — it is resident for the rest of the session', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 4, mode: 'arm' });
  assert.ok(d.additionalContext.length < 1400, `got ${d.additionalContext.length} chars`);
});

test('a null cacheRate degrades to token-only text without NaN', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: null, staleReads: 0, mode: 'arm' });
  assert.doesNotMatch(d.additionalContext, /NaN/);
  assert.doesNotMatch(d.systemMessage, /NaN/);
});
