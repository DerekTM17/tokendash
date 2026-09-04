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
  'active days': {
    title: 'Active days',
    body: 'Days on which any API call was recorded. Used instead of "sessions" because most spend lives in sessions that span several days — 85 multi-day sessions carry 77% of all cost here — so counting whole sessions on their start date would pile three quarters of the bill onto whichever day each long one began.',
  },
  'turns per active day': {
    title: 'Turns per active day',
    body: 'How many prompts you sent on a typical working day. This is an engagement measure: it goes up when you use the tool more, not when it becomes less efficient.',
  },
  'requests per turn': {
    title: 'Requests per turn',
    body: 'How many API calls one prompt of yours sets off. One turn typically triggers many, because every tool call is another round trip, and a dispatched subagent brings a whole second conversation with it. This is the number that falls when tool calls are batched or MCP servers are swapped for CLI tools.',
  },
  'tokens per request': {
    title: 'Tokens per request',
    body: 'The average size of a single API call, counting everything billed: fresh input, output, and cache traffic both read and written. Note this is larger than the figure on the Per API call panel, which shows only the context handed to the model and leaves out what came back.',
  },
  'price per token': {
    title: 'Price per token',
    body: 'What a token costs on average across everything you ran. It moves when you switch models, but also when the mix of token types shifts — a cache read costs a tenth of fresh input, so reading more from cache pulls this number down without any model change.',
  },
  'driver decomposition': {
    title: 'Driver decomposition',
    body: 'Splits a change in spend between the five things that can cause it, so a bigger bill can be traced to using the tool more, sending bigger prompts, or paying a higher rate. Each factor is measured holding the others still, and the five contributions add up to the total change exactly. Measuring one factor at a time means the order they are measured in can change how the credit is shared out, so a second, order-independent method is run behind the scenes as a check and the panel says so when the two disagree. That check is one yes-or-no answer for the whole comparison, weighed against the largest contribution on the panel — a factor that is small in dollars can be badly misattributed in relative terms and still not trip it. And when any factor is zero the second method cannot run at all, which the panel reports separately: not checked is not the same as checked and sound.',
  },
  'intervention': {
    title: 'Intervention',
    body: 'A change to how you work, written down with a date and a prediction before you look at the result. The prediction is a factor and a direction — which number you expect to move, and which way. Declaring both in advance is the point: with five factors and two directions there are ten ways to find a flattering story after the fact, so a metric chosen afterwards proves nothing. A declaration that names no direction is read as predicting a fall.',
  },
  'verdict': {
    title: 'Verdict',
    body: 'Supported means the factor you named moved in the direction you declared — both are recorded up front, and a declaration that names no direction is read as predicting a fall. Not supported means it did not. Confounded means something else moved too, so the result cannot be pinned on the change. Underpowered means too few active days to tell. Provisional means the after-window has not finished running yet. Refused means the comparison could not be made honestly at all — usually because the baseline reaches into transcripts that were deleted.',
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
