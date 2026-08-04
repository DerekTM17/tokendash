# Per-call context and cost over time (Phase B)

Status: approved 2026-08-03. Supersedes the Phase B outline in
`2026-07-31-cost-mix-over-time-design.md`.

## Why

Phase A shipped a panel showing where cost goes over time. It measures a proxy.
Cache share moves for reasons unrelated to context discipline — delegating more
is a *good* habit that *raises* cache-write share, because every subagent starts
a fresh context and pays writes instead of riding long reads.

Phase B measures the driver: how large the context is on each API call, and what
each call costs. The claim to test is "my sessions are getting leaner," and no
existing field can answer it — the normalized session has token totals but no
call count.

## What the review changed

A design review found the original plan measured the right quantity at the wrong
time, and the correction is now the largest part of the work. Three findings
that shaped this spec:

1. **Bucketing by `startedAt` is fatal for a per-call trend.** Every call in a
   session is attributed to the transcript's first timestamp. For subagents that
   is harmless (2.6% of their calls cross a calendar day). For Claude main
   sessions it is **95.2%**, with a maximum span of **19.2 days** — one 3,538-call
   session runs 2026-06-11 to 06-30 and lands entirely in the week of 06-07.
   A "trend" built this way is a step function of which long session *started*
   that week, over only 74 point-masses. This spec therefore adds per-day
   attribution to ingest, and retrofits Phase A's panel onto it.

2. **Codex rollouts contain two disagreeing `session_meta` entries** in 24 of 68
   files — the replay burst carries the parent's meta into the child's file.
   Last-wins (the obvious implementation, and how `turn_context.model` is already
   written at `codex.js:105`) mislabels every one of those 24. Since Codex is 61%
   subagent by cost, that inverts the chart.

3. **The originally proposed "tokens but zero apiCalls" diagnostic is
   structurally dead** — tokens and calls are derived from the same loop, so
   `apiCalls >= 1` whenever tokens > 0 by construction, and the converse is
   filtered by `isZeroToken` before it reaches `tokens.json`. Replaced below.

Numbers corrected during review, recorded so they are not re-derived wrongly:
Codex peaked at **16.3%** of weekly spend (week of 07-26), not 24.9% — it has
**not** crossed Phase A's 20% revisit trigger; the prior week was 1.9%, not 0.6%.
Both earlier figures came from Monday-start weeks, while `costMix.js` weeks on
Sunday. That the boundary shift moved a week's total from $2,203 to $651 is
itself finding #1 in miniature.

## Ingest

### New session fields

| field | type | meaning |
|---|---|---|
| `apiCalls` | integer | usage-bearing model responses in this (transcript, model) row |
| `isSubagent` | boolean | the session is a delegated agent, not a main thread |
| `daily` | array | per-day decomposition, see below |

`daily` is a compact fixed-order array, one entry per calendar day the row was
active, sorted ascending:

```js
// DAILY_COLUMNS, exported so producers and consumers cannot drift
['day', 'calls', 'input', 'output', 'cacheRead', 'cacheWrite',
 'costInput', 'costOutput', 'costCacheRead', 'costCacheWrite']
```

Array rather than objects because it is emitted ~2,629 times: measured at **+9%**
on a 1.54MB `tokens.json` (141KB) in array form. Emitted for **every** session,
including single-day ones where it is redundant with `startedAt`. A field present
for some rows and absent for others reads as zero downstream, which is exactly
how the opencode attribution bug survived months — the uniform field costs 9% and
removes the dual code path.

Cost is emitted per day rather than derived in the dashboard because pricing
lives in `packages/ingest/src/pricing.js` and must not be duplicated across the
package boundary. `cacheWrite1h` is not carried per day: it exists only to price
the 1-hour cache tier, and that pricing has already been applied by the time
`daily` is written.

**Invariants** (each becomes a test):

- `sum(daily[].calls) === apiCalls`
- `sum(daily[].input) === inputTokens`, and likewise output / cacheRead /
  cacheWrite
- `sum(daily[].costInput) ≈ costParts.input` within float epsilon, and likewise
  for the other three components
- `daily` is non-empty for every session that survives `isZeroToken`
- days are unique and ascending

### Per parser

**`claude.js`** — the call count is already present: `usageById` dedupes streamed
partial chunks by `message.id`, so its per-model entry count *is* the call count.
Verified across the full corpus: 102,235 assistant entries carry usage, 44,539
distinct ids, **0** entries lacking an id (the `line-${size}` fallback at
`claude.js:77` never fires), **0** ids appearing in two transcript files, **0**
ids carrying two models. The 250 `<synthetic>` entries are exactly the 250
`isApiErrorMessage` placeholders and are correctly excluded.

Each `usageById` entry keeps its day (from `entry.timestamp`) alongside its
tokens, and the `byModel` aggregation accumulates into per-day buckets as well as
totals. `isSubagent` comes from the emit site, which already distinguishes them —
the `subagents/` walk passes `true`, the flat project-dir loop `false`. No
id-prefix sniffing.

**`codex.js`** — count `token_count` events that are both outside the existing
2-second `REPLAY_WINDOW_MS` and *actually advance* the cumulative counter. The
second condition is load-bearing: repeated emissions re-report a call without
advancing, and counting all non-inherited events reintroduces the ~3% overcount
that the delta arithmetic was written to avoid. The increment goes after the
negative-delta guard, conditioned on `dInput + dCached + dOutput > 0`. Validated
against Codex's own `last_token_usage`, which the parser otherwise ignores:
agreement on **4,484 of 4,484** counted calls, 0 negative-delta events, 120
zero-delta events correctly skipped.

`isSubagent` reads the **first** `session_meta` only, and asserts
`payload.id === <uuid from filename>` before trusting it — verified to hold in
68 of 68 files. Prefer `payload.thread_source === 'subagent'`, a flat string,
over type-checking `payload.source`. Reading the last meta instead flips 24
files.

Day comes from each `token_count` event's own timestamp, so a Codex rollout
spanning days (91.4% of main calls) splits correctly.

**`opencode.js`** — count `message` rows with `data.role === 'assistant'`, folded
into the existing `modelsByMessage` pass so it stays one query. `isSubagent` is
always `false`; opencode exposes no such concept.

`daily` for opencode is a **single entry at `startedAt` carrying the session
totals**. The session row's aggregates are authoritative for tokens and cost, and
reconstructing a per-day split from message rows risks violating the sum
invariants above. This is a known limitation, acceptable because opencode is 27
sessions and $8.24 lifetime (0.1% of spend), is not plotted, and its sessions are
short. Revisit if opencode becomes material.

### Diagnostics

Replace the proposed dead counter with two that can actually fire, alongside the
existing `unpricedModels` and `unknownModelSessions` in `normalizer.js`:

- `overWindowSessions` — sessions whose max per-day context per call exceeds the
  model's context window. Catches a delta-accounting regression on Codex
  immediately. Windows are declared per model family; unknown models are skipped
  rather than guessed.
- `callsByTool` — total `apiCalls` per tool, so a parser that stops counting
  shows up as a step change rather than a silent flatline.

## Dashboard

### New module `src/lib/perCall.js`

`bucketPerCall(sessions, granularity, today)` mirrors `bucketCostMix` — same
Sunday week start, same UTC day convention, same linear walk over the full span,
same `null`-for-empty contract, same `isolated` and `partial` flags. It differs
in that it reads `session.daily` rather than `session.startedAt`, and produces
four series keyed by `${tool}:${kind}`:

```
claude:main   claude:sub   codex:main   codex:sub
```

Per bucket, per series: `calls`, `context` (input + cacheRead + cacheWrite),
`cost`. The plotted value is a **call-weighted mean** — `sum(context) /
sum(calls)` across the bucket — never a mean of per-session averages. Beyond the
Phase A cost-weighting rationale, this is structurally required: it is the only
form invariant to the `__model` row splitting, since both numerator and
denominator partition exactly across split rows.

A series with zero calls in a bucket yields `null`, not `0` — and specifically
must not divide. `costMix.js:55` already solved the analogous `total === 0` case
and documents why: zero renders as a hard dive to the floor, the most flattering
possible value for what is actually a data gap. Route zero-denominator buckets
through the same null contract while preserving the real session count.

### New component `src/components/PerCallTrend.jsx`

Four lines, paired colors — one hue per tool, lighter for subagent, darker for
main — so the eye reads tool first, kind second. Two toggles reusing Phase A's
`ToggleButton`: **Context / Cost** and **Week / Day**.

Y-axis is tokens in Context mode (reusing the compact formatter) and dollars in
Cost mode via `formatAxisDollars`, already extracted to `lib/format.js` for
exactly this reason.

Mounts in `App.jsx` immediately after `CostMixTrend`, consuming `filtered` so the
global `DateFilter` applies.

Two honesty affordances the review demanded:

- **Cost mode is labelled as reflecting model choice, not only discipline.**
  `cost/call = (context/call) × (blended $ per Mctx)`, and that second term
  spans 4x across models in use ($0.42 Haiku to $1.74 Fable). A falling cost line
  is equally consistent with "leaner contexts" and "delegated to a cheaper
  model." The panel says so rather than implying otherwise.
- **Codex series are sparse and must not pretend otherwise.** Codex main sessions
  exist on 6 distinct days in all of history; Codex subagents on 3. Under the
  `isolated` rule most Codex buckets render as lone dots, which is the honest
  presentation. The legend marks them as sparse rather than inviting the eye to
  connect them.

### Phase A retrofit

`bucketCostMix` moves from `startedAt` to `daily`, summing the four per-day cost
components instead of the session's `costParts`. The public shape of its output
is unchanged, so `CostMixTrend.jsx` itself needs no edit. Its **fixtures do**:
they build sessions from `startedAt` + `costParts` with no `daily`, which is no
longer a session the dashboard ever sees, so they are rebuilt around a one-day
`daily` row. A compatibility fallback to `startedAt` was considered and rejected
— it would be dead code in production and would mask exactly the regression
(missing `daily`) that the uniform-field decision exists to make loud.

The defect is milder in Phase A than here — shares degrade more gracefully than a
trend line — but it is the same defect and it is now cheap to fix.

## Testing

Ingest, per parser: call counts against hand-built fixtures; the streaming
duplicate case for `claude.js`; the replay-window and zero-delta cases for
`codex.js`; and a Codex fixture with **two disagreeing `session_meta` entries**,
since 24 real files exercise that path. The five `daily` invariants above become
property-style tests asserting over the whole normalized corpus, not just
fixtures.

Dashboard: `bucketPerCall` against fixtures covering an empty bucket, a
zero-call bucket, an isolated bucket, a partial current bucket, and — the case
that motivated the whole retrofit — a single session spanning three days, which
must contribute to three buckets rather than one.

`PerCallTrend.test.jsx` **must mock `ResponsiveContainer` to a fixed size**.
jsdom reports zero size, so recharts renders no children and any assertion about
chart internals passes vacuously. `CostMixTrend.test.jsx` establishes the
pattern; `UsageChart.test.jsx` lacks it and is logged in BACKLOG as a trap.

## Operational

Phase B touches `packages/ingest/src`. **Run `./scripts/autostart.sh` after every
edit there** — node caches modules, so the long-lived `--watch` ingest keeps
running old code and silently overwrites `tokens.json`. The cron watchdog only
fires every 10 minutes.

## Deliberately not doing

- **Not splitting sessions into per-day rows.** That would inflate
  `totals.sessions`, fragment `SessionsTable`, and break `ExpensiveSessions`.
  `daily` is additive; session identity is unchanged.
- **Not plotting opencode.** 0.1% of spend, four scattered points. `apiCalls` is
  still computed so the field is uniform.
- **Not adding per-tool context-window reference lines.** Claude main runs
  against a 1M window (max observed 999,722) while Codex reports 258,400 (max
  236,013), so equal heights mean different headroom. Real, but it is a second
  question; logged in BACKLOG rather than crowding a four-line chart.
