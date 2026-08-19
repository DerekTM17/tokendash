/**
 * Plain-English definitions for every piece of jargon on the dashboard.
 *
 * Kept in one file rather than beside each component for two reasons: the same
 * term appears in several panels and must not drift between them, and a single
 * list is reviewable as prose — the test suite checks that every `term=` prop in
 * components/ resolves here, so a typo fails the build rather than silently
 * rendering no tooltip.
 *
 * House style: say what the number IS in the first sentence, then why it is
 * worth looking at. Assume the reader has never seen a token bill before.
 */

/** Price ratios are constant across every Claude model (see
 *  packages/ingest/src/pricing-data.json): if input is 1x, cache read is 0.1x,
 *  cache write is 1.25x and output is 5x. Quoting the ratio rather than a dollar
 *  figure keeps these definitions correct when prices change. */
export const GLOSSARY = {
  // ─── headline figures ───────────────────────────────────────────────
  'total cost': {
    title: 'Total cost',
    body: 'What every session in the current date filter cost, added up. This is the sum of what survives on disk, not a lifetime bill — Claude Code deleted transcripts older than 30 days until that setting was raised, so spend before the coverage date is gone rather than zero.',
  },
  'tokens': {
    title: 'Tokens',
    body: 'The unit everything is billed in. Roughly 3-4 characters of text, so about 750 words per 1,000 tokens. Every message, file read and tool result is converted to tokens before it is priced.',
  },
  'sessions': {
    title: 'Sessions',
    body: 'One session is one continuous conversation — from opening a new window to closing it. Subagents you dispatch are counted separately, because they get their own context and their own bill.',
  },

  // ─── rates ──────────────────────────────────────────────────────────
  'burn rate': {
    title: 'Burn rate',
    body: 'Average spend per calendar day across the period the data actually covers, including days you did not work. It answers "what is this habit costing me?" rather than "what did that session cost?".',
  },
  'projected': {
    title: 'Projected',
    body: 'The burn rate multiplied by 30 — what a month at the current pace would cost. A straight-line estimate, so it moves quickly after an unusually heavy or light week.',
  },
  'cache % of cost': {
    title: 'Cache % of cost',
    body: 'The share of the bill that is cache traffic (reading and writing the conversation history) rather than new work. It is usually the majority, and it is the number that grows as a session gets longer.',
  },
  'tokens / $': {
    title: 'Tokens per dollar',
    body: 'How many tokens a dollar bought. Higher is cheaper. It moves with the mix: cheap cache reads and smaller models push it up, long outputs from a large model push it down.',
  },
  'coverage': {
    title: 'Coverage',
    body: 'The share of sessions that could be traced back to a specific project folder. Sessions started outside a project directory cannot be attributed, so anything below 100% means the per-project breakdown is missing some spend.',
  },

  // ─── the four things you pay for ────────────────────────────────────
  'input': {
    title: 'Input',
    body: 'Fresh text sent to the model that it has not seen before — your prompt, plus anything newly read. This is the baseline price: cache reads cost a tenth as much, and output costs five times as much.',
  },
  'output': {
    title: 'Output',
    body: 'Text the model writes back: its replies, its code, its tool calls. The most expensive thing per token by a wide margin — 5x the price of input — but usually a small share of the bill, because models read far more than they write.',
  },
  'cache read': {
    title: 'Cache read',
    body: 'Re-sending conversation history the model has already seen. Every turn re-sends the whole conversation, so a long session pays this on every single message. It is cheap per token (a tenth of input) but it is charged over and over, which is why it usually dominates the bill.',
  },
  'cache write': {
    title: 'Cache write',
    body: 'The one-off cost of storing something so later turns can re-read it cheaply. Priced at 1.25x input — a 25% premium paid once, which pays for itself as soon as the content is re-read three times.',
  },

  // ─── panels ─────────────────────────────────────────────────────────
  'usage over time': {
    title: 'Usage over time',
    body: 'Cost and tokens per day or week. Use it to spot which stretches of work were expensive, and whether the trend is climbing.',
  },
  'where the cost goes': {
    title: 'Where the cost goes',
    body: 'The bill split four ways: cache read, cache write, output and input. If cache read is the tall bar, the lever is shorter sessions rather than fewer messages.',
  },
  'cost mix over time': {
    title: 'Cost mix over time',
    body: 'The same four-way split, tracked week by week. Shown as a share it answers "is the cache share growing?"; shown in dollars it answers "is any one part running away?".',
  },
  'per api call': {
    title: 'Per API call',
    body: 'How big the context window had grown, averaged per request, on each day. A rising line means sessions are being kept open longer — the thing that makes cache reads expensive.',
  },
  'activity by hour': {
    title: 'Activity by hour',
    body: 'When you actually work, by day of week and hour. Darker cells are busier. Useful mostly for noticing that a habit has drifted.',
  },
  'recent sessions': {
    title: 'Recent sessions',
    body: 'Every session in the current filter, newest first. Click a row for its full breakdown — models used, tools called and where the money went.',
  },
  'top sessions by cost': {
    title: 'Top sessions by cost',
    body: 'The most expensive individual sessions. Spend is usually concentrated in a handful of long ones, so this is the fastest place to find out what a bad week was made of.',
  },
  'by tool': {
    title: 'By tool',
    body: 'Cost grouped by which coding agent produced it — Claude Code, Codex, opencode. Each is parsed from its own local transcripts, so the comparison is like for like.',
  },
  'by model': {
    title: 'By model',
    body: 'Cost grouped by the model that did the work. Prices differ by an order of magnitude between the small and large models, so the token split and the dollar split rarely look alike.',
  },
  'model efficiency': {
    title: 'Model efficiency',
    body: 'What each model actually cost per token in practice. It differs from the list price because the mix of input, output and cache traffic differs per model.',
  },
  'by project': {
    title: 'By project',
    body: 'Cost grouped by the folder the session was started in. Sessions launched outside a project directory fall into "other" — see coverage for how much that is.',
  },
};

/** Definition body for a term, or null when the term is unknown. Case-insensitive
 *  so a component can pass its visible label verbatim rather than keeping a
 *  second copy of the string in sync. */
export function define(term) {
  return GLOSSARY[String(term ?? '').toLowerCase()]?.body ?? null;
}

/** Title for a term, or null. Same lookup rules as define(). */
export function titleOf(term) {
  return GLOSSARY[String(term ?? '').toLowerCase()]?.title ?? null;
}
