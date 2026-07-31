# Cost mix over time

**Status:** approved, unimplemented
**Date:** 2026-07-31

## Problem

The dashboard answers "what did I spend" well. It does not answer "am I getting
better."

`Usage over time` shows spend by tool per day — which tool, how much, when.
`Where the cost goes` shows the four-way cost split (input / output / cache read
/ cache write) but only as a single aggregate over the filtered range. Neither
shows the split *moving*. The one number that hints at habit change,
`cache % of cost` in `MetricsStrip`, is a scalar with no history.

Cache read and cache write dominate the bill because sessions run long: cost is
roughly context size × number of API calls, and 88.9% of spend is cache traffic
(output 9.8%, input 1.3%).
If context discipline improves, cache share should fall. It can never reach
zero, and the floor is unknown — so the useful signal is the *direction*, which
requires a time series.

## Phase A — Cost mix over time (build first)

A panel showing the `Where the cost goes` breakdown as a share-of-cost time
series, so the trend in cache share is visible.

### Data

Source is `session.costParts` (dollars, split input/output/cacheRead/cacheWrite)
and `session.startedAt`, both already produced by `normalizer.js`. **No ingest
change is required for Phase A** — all 2,453 sessions currently carry
`costParts`.

Sessions missing `startedAt` or `costParts` are skipped, not zero-filled.

### Bucketing

Default bucket is **weekly**, toggleable to daily.

Weekly is the default because daily share is dominated by single sessions. 57%
of spend ($4,413 of $7,793) is ten sessions, so a day holding one of them reads
as ~95% cache while a quiet day reads very differently — neither is a habit
signal.
Weekly gives ~14 points across the current history, enough to see a trend and
coarse enough that one session cannot own a point.

Day key is `startedAt.slice(0, 10)`, matching the existing convention in
`UsageChart.jsx`. Week key is the Sunday of that day. Consistency with the panel
directly above matters more here than timezone precision.

**A 7-day rolling window was considered and rejected**: ~95 points is smoother,
but "the week ending here" is harder to reason about, and the first six days are
undefined.

### Share is cost-weighted

Within a bucket, share is summed dollars per component divided by the bucket
total — *not* the mean of per-session percentages. Averaging session shares
would let a $0.08 Haiku subagent count as much as the $699 session, which would
make the chart meaningless given how concentrated spend is.

### Magnitude must stay visible

A pure 100%-share chart lies about low-volume buckets. From live data (snapshot
2026-07-31; totals drift upward as ingest runs):

```
week         total   cache%
2026-04-26      $3   63%
2026-05-17      $1   76%
2026-06-07    $761   93%
2026-06-14      $1   73%
2026-06-21    $422   90%
2026-06-28   $1776   93%
2026-07-05    $546   85%
2026-07-12    $651   85%
2026-07-19   $2474   90%
2026-07-26   $1151   82%
```

The three weeks at $1–$3 would render as the three best weeks on record. They
are weeks with almost no work. Share-only makes idleness look like discipline —
the failure mode most likely to make the panel untrustworthy.

Fix: **a thin total-cost bar row beneath the stacked share band, sharing the
x-axis.** Near-zero weeks become hairline bars and the eye discounts them
without needing an explanation.

Rejected alternatives: tooltip-only (the misleading dip is still visually loud,
and glanceability is the point of a dashboard panel); suppressing buckets below
a cost floor (silently dropping data, and the floor is arbitrary).

Interior empty buckets are filled with nulls so the x-axis stays linear in time.
The band breaks across the mid-May gap rather than drawing a smooth line across
five weeks where nothing happened — the same honesty problem as the $1 weeks.
Leading and trailing gaps are not filled.

### Scope decisions taken deliberately

**No tool filter.** Tool mix is a real confound in principle — Codex bills
cached input at 0.1× and charges nothing separately for cache writes, while
Claude bills writes at 1.25×/2× — so a Codex-heavy week would show lower cache
share with no habit change. In practice it does not matter: Claude is $7,436 of
$7,786 (95.5%), Codex $342 (4.4%), opencode $8 (0.1%). No realistic shift in mix
can move the line. Revisit only if Codex share grows past ~20%.

**No dollars/share toggle.** Absolute cost by component over the filtered range
is already available from `Where the cost goes` plus the global `DateFilter`.
The bar row and the tooltip cover magnitude.

**`UsageChart` is not refactored** to share the new bucketing module. It works;
that is unrelated cleanup.

### Components

- **`src/lib/costMix.js`** — `bucketCostMix(sessions, granularity)` returning an
  array of buckets: component dollars, component percentages, total, session
  count, and a `partial` flag — true for the single bucket containing the
  current date, which is still accumulating. Pure, no React, no recharts.
- **`src/components/CostMixTrend.jsx`** — thin renderer. A recharts
  `ComposedChart`: four 100%-stacked `Area`s for share, plus one `Bar` on a
  secondary axis for bucket total dollars. Week/Day toggle reusing the
  `ToggleButton` pattern from `UsageChart.jsx`.
- **`App.jsx`** — left column, directly below `CostComposition`, `delay={265}`.

The split exists because the arithmetic is the part that can be wrong
invisibly — cost-weighting, week boundaries, gap handling — and recharts is
close to unassertable in jsdom. Existing chart tests can only check that a
container rendered. Putting the logic in a pure module makes it genuinely
testable.

### Visual

Same four colors and stack order as `CostComposition`: cache read `#5cc8ff`,
cache write `#b48cff`, output `#ff8a3d`, input `#34e6a4`. The same component
must not change color between two panels on the same screen.

Y-axis pinned 0–100%. Cost bars sit in a muted band at the bottom on their own
axis. Tooltip shows each component's percentage *and* dollars, the bucket total,
and the session count; the current in-progress bucket is marked partial.

### Testing

TDD — each test written failing first.

`test/costMix.test.js` carries the weight:

- one $699 session outweighs a hundred $0.08 sessions in a bucket's share
- week bucketing, including the Saturday→Sunday boundary
- interior gaps filled with nulls; leading and trailing gaps not filled
- percentages sum to 100 within a bucket
- empty input
- sessions missing `startedAt` or `costParts` are skipped
- the partial flag marks only the in-progress bucket

`test/CostMixTrend.test.jsx` stays a smoke test in the existing house style:
renders, empty state, toggle switches granularity.

### Success criteria

The panel renders weekly cost-mix share with a total-cost bar row, the numbers
match the table above, `npm test` passes with the new tests, and the dashboard
still serves 200 on :5199.

## Phase B — Habit trend panel (plan separately)

Phase A measures a proxy. Cache share can move for reasons unrelated to
discipline — most notably, delegating more is a *good* habit that can *raise*
cache-write share, because every subagent starts a fresh context and pays writes
instead of riding long reads. Delegation hygiene is already good (1,064 Haiku
sessions at $0.08 average), so the proxy may understate real improvement.

Phase B measures the driver directly rather than its shadow.

### Metrics

- **Average context per API call** — `(input + cacheRead + cacheWrite) tokens /
  API calls`. This is the actual cost driver. The $699 session ran 3,539 API
  calls at 226k average context, which is $0.113/call in cache reads alone;
  held at 60k it would have cost ~$106.
- **Cost per API call.**
- **Cost per session.**

### Why this is not a dashboard-only change

The session record emitted by `normalizer.js` has token totals but **no API-call
count**, and no `endedAt`. Neither context-per-call nor cost-per-call is
computable from today's `tokens.json`.

Each parser needs to count usage-bearing assistant events per session:

- **`claude.js`** — assistant messages carrying `usage`.
- **`codex.js`** — `token_count` events that advance the cumulative counter.
  Must reuse the existing 2-second replay window, or inherited parent-transcript
  events will inflate the count exactly as they once inflated tokens.
- **`opencode.js`** — assistant message rows. The session row carries only
  aggregate totals, so the count must come from messages.

Then `apiCalls` is added to the normalized session, and the panel is built on
it.

### Open questions for Phase B's own brainstorm

- Does context-per-call belong in the same panel as cache share, or its own?
- Is per-session or per-call the more actionable unit?
- Should main sessions and subagent sessions be trended separately? They have
  very different shapes (62 main sessions / $5,595 vs 2,267 subagent sessions /
  $1,212), and mixing them may wash out the signal.

## Operational note

Phase B touches `packages/ingest/src`. **Run `./scripts/autostart.sh` after any
edit there** — node caches modules, so the long-lived `--watch` ingest keeps
running old code and silently overwrites `tokens.json`. The cron watchdog only
fires every 10 minutes. Phase A does not touch ingest and is unaffected.
