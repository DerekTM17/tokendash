import { describe, it } from 'node:test';
import assert from 'node:assert';
import { priceForModel, estimateCost, costBreakdown } from '../src/pricing.js';

// Every rate carries all four buckets: input/output plus explicit cache rates
// (from the vendored LiteLLM snapshot, or derived from multipliers for
// FALLBACK-only models).
function io(model) {
  const r = priceForModel(model);
  return r && { input: r.input, output: r.output };
}

describe('priceForModel', () => {
  it('resolves a known model', () => {
    assert.deepStrictEqual(io('claude-opus-4-8'), { input: 5, output: 25 });
  });

  it('matches dated snapshots by prefix', () => {
    assert.deepStrictEqual(io('claude-haiku-4-5-20251001'), { input: 1, output: 5 });
  });

  it('prefers the longest matching prefix', () => {
    // "claude-opus-4-8" must not be shadowed by a shorter "claude-opus-4" key.
    assert.deepStrictEqual(io('claude-opus-4-8'), { input: 5, output: 25 });
  });

  it('resolves claude-opus-5', () => {
    // Opus 5 shares the Opus 4.8 tier at $5/$25 per MTok. It does NOT match the
    // "claude-opus-4" prefix, so a missing entry silently prices it at $0.
    assert.deepStrictEqual(io('claude-opus-5'), { input: 5, output: 25 });
  });

  it('always returns every rate bucket, including both cache-write tiers', () => {
    assert.deepStrictEqual(priceForModel('claude-opus-5'),
      { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 });
  });

  it('prefers the vendored snapshot over the fallback table', () => {
    // Sonnet 5's intro rate is $2/$10; the hand-written FALLBACK still says
    // $3/$15. The snapshot must win, or we overstate Sonnet 5 by 50%.
    assert.deepStrictEqual(io('claude-sonnet-5'), { input: 2, output: 10 });
  });

  it('returns null for unknown models', () => {
    assert.strictEqual(priceForModel('unknown'), null);
    assert.strictEqual(priceForModel('totally-made-up-model-xyz'), null);
    assert.strictEqual(priceForModel(''), null);
    assert.strictEqual(priceForModel(null), null);
  });

  it('resolves OpenAI GPT models (Codex sessions)', () => {
    assert.deepStrictEqual(io('gpt-5.6-sol'), { input: 5, output: 30 });
    assert.deepStrictEqual(io('gpt-5.6-terra'), { input: 2.5, output: 15 });
    assert.deepStrictEqual(io('gpt-5.6-luna'), { input: 1, output: 6 });
    assert.deepStrictEqual(io('gpt-5.5'), { input: 5, output: 30 });
  });
});

describe('estimateCost', () => {
  it('prices input, output, and cache tokens with the right multipliers', () => {
    // opus: $5/M input, $25/M output, cache read 0.1x input, cache write 1.25x input
    const cost = estimateCost({
      model: 'claude-opus-4-8',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    // 5 + 25 + 0.5 + 6.25 = 36.75
    assert.strictEqual(Number(cost.toFixed(4)), 36.75);
  });

  it('returns null when the model has no pricing (caller keeps source cost)', () => {
    assert.strictEqual(estimateCost({ model: 'totally-made-up-model-xyz', inputTokens: 1000 }), null);
  });

  it('handles missing token fields as zero', () => {
    assert.strictEqual(estimateCost({ model: 'claude-haiku-4-5' }), 0);
  });
});

describe('costBreakdown', () => {
  it('splits cost into four parts that sum to estimateCost', () => {
    const s = { model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    const parts = costBreakdown(s);
    assert.strictEqual(Number(parts.input.toFixed(4)), 5);
    assert.strictEqual(Number(parts.output.toFixed(4)), 25);
    assert.strictEqual(Number(parts.cacheRead.toFixed(4)), 0.5);
    assert.strictEqual(Number(parts.cacheWrite.toFixed(4)), 6.25);
    const sum = parts.input + parts.output + parts.cacheRead + parts.cacheWrite;
    assert.strictEqual(Number(sum.toFixed(4)), Number(estimateCost(s).toFixed(4)));
  });

  it('returns null for an unpriceable model', () => {
    assert.strictEqual(costBreakdown({ model: 'totally-made-up-model-xyz', inputTokens: 100 }), null);
  });

  it('prices a Codex GPT session (cached input at 0.1x, no cache writes)', () => {
    const cost = estimateCost({
      model: 'gpt-5.6-sol',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    // 5 + 30 + 0.5 = 35.5 — OpenAI's cached-input rate is exactly 0.1x input,
    // same discount the table already applies for Anthropic cache reads.
    assert.strictEqual(Number(cost.toFixed(4)), 35.5);
  });
});

describe('cache-write TTL tiers', () => {
  it('prices the 1-hour subset at 2x input, the rest at 1.25x', () => {
    // 1M writes, of which 400k are 1-hour TTL. opus-5 input is $5/M:
    //   600k @ $6.25/M = 3.75   +   400k @ $10/M = 4.00   => 7.75
    const parts = costBreakdown({
      model: 'claude-opus-5',
      cacheWriteTokens: 1_000_000,
      cacheWrite1hTokens: 400_000,
    });
    assert.strictEqual(Number(parts.cacheWrite.toFixed(4)), 7.75);
  });

  it('falls back to the 5-minute rate when no TTL split is reported', () => {
    // Codex/opencode don't distinguish tiers — must behave as before.
    const parts = costBreakdown({ model: 'claude-opus-5', cacheWriteTokens: 1_000_000 });
    assert.strictEqual(Number(parts.cacheWrite.toFixed(4)), 6.25);
  });

  it('never lets the 1h subset exceed the reported total', () => {
    const parts = costBreakdown({
      model: 'claude-opus-5',
      cacheWriteTokens: 100_000,
      cacheWrite1hTokens: 999_999_999,
    });
    assert.strictEqual(Number(parts.cacheWrite.toFixed(4)), 1);
  });
});
