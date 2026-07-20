import { describe, it } from 'node:test';
import assert from 'node:assert';
import { priceForModel, estimateCost, costBreakdown } from '../src/pricing.js';

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

  it('returns null for unknown models', () => {
    assert.strictEqual(priceForModel('unknown'), null);
    assert.strictEqual(priceForModel('deepseek-v4-pro'), null);
    assert.strictEqual(priceForModel(''), null);
    assert.strictEqual(priceForModel(null), null);
  });

  it('resolves OpenAI GPT models (Codex sessions)', () => {
    // developers.openai.com/api/docs/pricing, checked 2026-07-20
    assert.deepStrictEqual(priceForModel('gpt-5.6-sol'), { input: 5, output: 30 });
    assert.deepStrictEqual(priceForModel('gpt-5.6-terra'), { input: 2.5, output: 15 });
    assert.deepStrictEqual(priceForModel('gpt-5.6-luna'), { input: 1, output: 6 });
    assert.deepStrictEqual(priceForModel('gpt-5.5'), { input: 5, output: 30 });
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
    assert.strictEqual(costBreakdown({ model: 'deepseek-v4-pro', inputTokens: 100 }), null);
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
