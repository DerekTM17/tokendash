// Per-model token pricing so we can derive cost for tools that record tokens but
// not dollars (Claude transcripts carry usage, not cost). Rates are USD per
// million tokens, from the Anthropic pricing table. Cache tokens follow the
// standard multipliers: cache reads bill at ~0.1x input, 5-minute cache writes
// at 1.25x input.
//
// Keys are matched as prefixes (longest match wins) so dated snapshots like
// `claude-haiku-4-5-20251001` resolve to the `claude-haiku-4-5` entry.
const PRICING = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceForModel(model) {
  if (!model || model === 'unknown') return null;
  let best = null;
  let bestLen = -1;
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = PRICING[key];
      bestLen = key.length;
    }
  }
  return best;
}

// Breaks a session's estimated cost into its four token components (USD), or
// null when the model isn't priceable. The four parts sum to estimateCost().
export function costBreakdown(session) {
  const rate = priceForModel(session.model);
  if (!rate) return null;
  return {
    input: ((session.inputTokens || 0) * rate.input) / 1_000_000,
    output: ((session.outputTokens || 0) * rate.output) / 1_000_000,
    cacheRead: ((session.cacheReadTokens || 0) * rate.input * CACHE_READ_MULTIPLIER) / 1_000_000,
    cacheWrite: ((session.cacheWriteTokens || 0) * rate.input * CACHE_WRITE_MULTIPLIER) / 1_000_000,
  };
}

// Returns the estimated cost in USD for a session's token usage, or null when
// the model isn't in the pricing table (caller keeps whatever cost it had).
export function estimateCost(session) {
  const parts = costBreakdown(session);
  if (!parts) return null;
  return parts.input + parts.output + parts.cacheRead + parts.cacheWrite;
}
