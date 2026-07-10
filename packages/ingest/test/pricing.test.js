import { describe, it } from 'node:test';
import assert from 'node:assert';
import { priceForModel, estimateCost } from '../src/pricing.js';

describe('priceForModel', () => {
  it('resolves a known model', () => {
    assert.deepStrictEqual(priceForModel('claude-opus-4-8'), { input: 5, output: 25 });
  });

  it('matches dated snapshots by prefix', () => {
    assert.deepStrictEqual(priceForModel('claude-haiku-4-5-20251001'), { input: 1, output: 5 });
  });

  it('prefers the longest matching prefix', () => {
    // "claude-opus-4-8" must not be shadowed by a shorter "claude-opus-4" key.
    assert.deepStrictEqual(priceForModel('claude-opus-4-8'), { input: 5, output: 25 });
  });

  it('returns null for unknown / non-Claude models', () => {
    assert.strictEqual(priceForModel('unknown'), null);
    assert.strictEqual(priceForModel('deepseek-v4-pro'), null);
    assert.strictEqual(priceForModel(''), null);
    assert.strictEqual(priceForModel(null), null);
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
    assert.strictEqual(estimateCost({ model: 'deepseek-v4-pro', inputTokens: 1000 }), null);
  });

  it('handles missing token fields as zero', () => {
    assert.strictEqual(estimateCost({ model: 'claude-haiku-4-5' }), 0);
  });
});
