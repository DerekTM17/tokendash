// packages/hooks/lib/env.mjs
// Shared guarded parser for env-overridable numeric constants.
//
// Why the guard exists: an unparseable override must fall back to the
// default rather than poison the arithmetic downstream. Measured failure
// mode without this guard: CTX_ARM_TOKENS=abc makes ARM_TOKENS NaN, so
// `tokens < NaN` is always false and bandOf() returns NaN instead of null —
// the hook nudged from a 5,000-token context every 10 prompts, indefinitely.
// NaN even survived into firedBands (serializing to JSON null), which broke
// the dedup across process boundaries. Do not remove this guard to
// "simplify" the parse.
export function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
