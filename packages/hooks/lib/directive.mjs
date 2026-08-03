// packages/hooks/lib/directive.mjs
// Builds the text injected as additionalContext.
//
// Kept deliberately short: this text becomes permanently resident and is
// re-read at cache-read price on every subsequent call for the rest of the
// session. It is additive to the problem it describes, so it must earn its size.

const FLOOR_TOKENS = Number(process.env.CTX_FLOOR_TOKENS || 35_620);
const HANDOFF_OUTPUT_TOKENS = 1_200;
const W_WRITE = 1.25;
const W_READ = 0.1;
const W_OUT = 5.0;

const k = (n) => `${Math.round(n / 1000)}k`;
const usd = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

/** Per-turn cache-read cost now, the same in a fresh session, and turns to break even. */
export function costFigures({ tokens, cacheRate, floor = FLOOR_TOKENS }) {
  const boundaryCost = floor * W_WRITE + HANDOFF_OUTPUT_TOKENS * W_OUT;
  const savedPerTurn = Math.max(1, (tokens - floor) * W_READ);
  return {
    perTurn: cacheRate ? (tokens * cacheRate) / 1e6 : null,
    freshPerTurn: cacheRate ? (floor * cacheRate) / 1e6 : null,
    breakEven: boundaryCost / savedPerTurn,
  };
}

export function buildDirective({ tokens, cacheRate, staleReads, mode }) {
  const { perTurn, freshPerTurn, breakEven } = costFigures({ tokens, cacheRate });

  const money = perTurn
    ? ` Every further turn costs ~${usd(perTurn)} in cache reads alone; the same work in a fresh session costs ~${usd(freshPerTurn)}.`
    : '';
  const stale = staleReads > 0
    ? ` ${staleReads} files in context are stale copies (read, then edited much later).`
    : '';

  const judgement = mode === 'ceiling'
    ? 'Raise the boundary now, regardless of topic continuity.'
    : [
        "Before answering, judge silently: does the user's message continue the current thread, or start something new?",
        '',
        '**If it continues** — say nothing about this. Answer normally.',
        '',
        '**If it starts something new, or the current task just finished** —',
      ].join('\n');

  const additionalContext = [
    'SESSION BOUNDARY CHECK — mechanical trigger, not a user request.',
    '',
    `Context is now ${k(tokens)} tokens.${money}${stale} A boundary pays for itself in ${breakEven.toFixed(1)} turns.`,
    '',
    judgement,
    '1. Write the handoff FIRST (invoke session-checkpoint) and confirm it is on disk.',
    '2. Tell the user in one line why now, with the number, and print the restart prompt.',
    '',
    'Never do both: do not write a handoff and then also answer the new question in this session.',
  ].join('\n');

  const flag = mode === 'ceiling' ? '⛔' : '⚑';
  const cost = perTurn ? ` (+${usd(perTurn)}/turn)` : '';
  return {
    systemMessage: `${flag} context ${k(tokens)}${cost} — boundary check`,
    additionalContext,
  };
}
