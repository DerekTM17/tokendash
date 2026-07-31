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
Weekly gives 14 slots across the current history of which 10 carry data — enough
to see a trend, coarse enough that one session cannot own a point.

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
The band breaks across the May gaps (2 weeks at 05-03/05-10, 2 weeks at
05-24/05-31) rather than drawing a smooth line across weeks where nothing
happened — the same honesty problem as the $1 weeks. Leading and trailing gaps
are not filled.

Nulls do break a stacked `Area` rather than being read as zero — confirmed in
`recharts/lib/cartesian/Area.js:482`, where `isBreakPoint` covers
`hasStack && getValueByDataKey(entry, dataKey) == null`, with `connectNulls`
defaulting to false.

**Isolated buckets must be dotted or they vanish.** A bucket with nulls on both
sides has no neighbor to form a line segment, so its area path encloses nothing
and renders invisible; recharts' `hasSinglePoint` fallback (`Area.js:342`)
applies only when the *whole series* is one point. Weeks `2026-04-26` and
`2026-05-17` are both isolated — so without a fix, the two weeks that motivate
the magnitude design would silently disappear.

Fix: `bucketCostMix` sets an **`isolated`** flag on any non-null bucket whose
immediate neighbours are both null or absent. The `Area`s use a custom `dot`
renderer that draws only for isolated buckets. This keeps the detection in the
pure, tested module rather than in render code, and avoids dotting all ~95
points in daily mode.

### Share / Dollars toggle

A second toggle switches what the stacked band measures. Default is **Share**.

- **Share** — the four components normalized to 100% per bucket. Y-axis 0–100%.
  This is the habit view: it answers whether cache share is trending down.
  The total-cost bar row is shown.
- **Dollars** — the same four components stacked as absolute dollars. Y-axis in
  dollars. This answers where the money actually went, and makes a heavy week
  look heavy.

**The bar row is hidden in Dollars mode.** It exists only to restore the
magnitude that normalizing throws away; in Dollars mode the stacked height *is*
the bucket total, so the bar row would restate it. The `<YAxis yAxisId="right">`
must be unmounted along with the `<Bar>`, not just the bar itself, or an orphan
axis reserves width for nothing.

To keep the bars a *row* rather than a full-height chart, the right axis domain
is `[0, max(total) * 4]`, confining bars to the bottom ~25%. The axis itself is
hidden. Without an inflated domain recharts scales bars to full height and they
compete with the share band.

The two toggle groups (Week/Day, Share/Dollars) sit together in the panel
header, which must wrap on narrow viewports rather than crowd the title.

### Scope decisions taken deliberately

**No tool filter.** Tool mix is a real confound in principle — Codex bills
cached input at 0.1× and charges nothing separately for cache writes, while
Claude bills writes at 1.25×/2× — so a Codex-heavy week would show lower cache
share with no habit change. In practice it does not matter: Claude is 95.5% of
spend, Codex 4.4%, opencode 0.1%. No realistic shift in mix can move the line.
Revisit only if Codex share grows past ~20%.

**`UsageChart` keeps its own inline bucketing.** The only change to it is
importing the extracted `ToggleButton`. It is not refactored to share the new
bucketing module — it works, and that is unrelated cleanup.

### Components

- **`src/lib/costMix.js`** — `bucketCostMix(sessions, granularity)` returning an
  array of buckets: component dollars, component percentages, total, session
  count, and a `partial` flag — true for the single bucket containing the
  current date, which is still accumulating. Pure, no React, no recharts.
- **`src/components/CostMixTrend.jsx`** — thin renderer. A recharts
  `ComposedChart`: four stacked `Area`s, plus one `Bar` on a secondary axis for
  bucket total dollars (Share mode only). Two toggle groups, Week/Day and
  Share/Dollars. Both toggles are local component state; neither affects other
  panels.
- **`src/components/ToggleButton.jsx`** — extracted from `UsageChart.jsx:69`,
  which currently declares it as a module-private function with only a default
  export of the chart. Two panels needing the identical control is the point at
  which it stops being local. `UsageChart` is updated to import it; the button's
  markup and styling do not change.
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

Y-axis is pinned 0–100% in Share mode and auto-scaled dollars in Dollars mode.
Cost bars sit in a muted band at the bottom on their own axis, Share mode only.

The tooltip is identical in both modes — each component's percentage *and*
dollars, the bucket total, and the session count — so switching modes never
loses information, only changes emphasis. The current in-progress bucket is
marked partial.

Because `bucketCostMix` already returns both dollars and percentages per bucket,
the toggle is pure rendering: no recomputation, no second code path through the
arithmetic.

### Testing

TDD — each test written failing first.

`test/costMix.test.js` carries the weight:

- one $699 session outweighs a hundred $0.08 sessions in a bucket's share
- week bucketing, including the Saturday→Sunday boundary
- interior gaps filled with nulls; leading and trailing gaps not filled
- `isolated` is true for a bucket flanked by nulls on both sides, false for one
  with any non-null neighbour, and true for a lone bucket at either end
- percentages sum to 100 within a bucket
- empty input
- sessions missing `startedAt` or `costParts` are skipped
- the partial flag marks only the in-progress bucket

`test/CostMixTrend.test.jsx` stays a smoke test in the existing house style:
renders, empty state, Week/Day switches granularity, Share/Dollars switches
mode, and the cost bar row is absent in Dollars mode.

### Success criteria

The panel defaults to weekly cost-mix share with a total-cost bar row and the
numbers match the table above; both toggles work and Dollars mode drops the bar
row; `npm test` passes with the new tests; the dashboard still serves 200 on
:5199.

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
  very different shapes, and mixing them may wash out the signal. Note this
  needs a **second** ingest field, not just `apiCalls`: the normalized session
  carries no main-vs-subagent flag, and the counts quoted in earlier analysis
  (62 main / 2,267 subagent) no longer sum to the current session total, so
  that split cannot be reconstructed after the fact.

## Operational note

Phase B touches `packages/ingest/src`. **Run `./scripts/autostart.sh` after any
edit there** — node caches modules, so the long-lived `--watch` ingest keeps
running old code and silently overwrites `tokens.json`. The cron watchdog only
fires every 10 minutes. Phase A does not touch ingest and is unaffected.
