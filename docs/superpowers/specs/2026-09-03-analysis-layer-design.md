# Analysis layer: driver decomposition and intervention measurement

**Date:** 2026-09-03
**Status:** design approved; revised 2026-09-03 after adversarial review (see Revision history)
**Scope:** the Analysis layer, one of three (see "Where this sits")

## Why

TokenDash answers *what* was spent. It cannot answer *why the number moved*, and
it cannot answer *did that change help*. Both questions are load-bearing for
using this dashboard at work, where the audience is stakeholders rather than the
person who wrote the parser.

Uber's [efficient software factory][uber] post decomposes AI coding spend as:

```
Users x Sessions/user x Turns/session x Requests/turn x Tokens/request x Price/token
```

The first two terms are adoption, the middle three are efficiency, the last is
procurement. TokenDash already measures several of the same levers, arrived at
independently: the status line cost counter, the context-boundary hook (Uber caps
context at 400K; ours arms at 325K), cache-share tracking in `CostComposition` / `CostMixTrend`, cost per
1M tokens by model in `ModelEfficiency`, and tokens per request in `PerCallTrend`.

What is missing is the decomposition itself — attributing a change in spend to
the factor that caused it — and any way to measure whether a deliberate change to
working practice actually paid off.

[uber]: https://www.uber.com/us/en/blog/efficient-software-factory/

## Where this sits

Three layers were identified. This spec covers the **Analysis layer** only.
(Named rather than lettered: "Phase B" already refers to the shipped per-call
panel in `docs/BACKLOG.md`.)

- **Outcome layer.** Local git history becomes dated outcome events per
  project; joins against cost to yield cost per commit, per changed line, and
  (if GitHub Enterprise API access exists) per merged PR.
- **Analysis layer.** This document. Driver decomposition and intervention
  measurement. Runs on token data alone; independent of the Outcome layer.
- **Presentation layer.** Audience-scoped views and work-profile config.
  Depends on the other two.

The Analysis layer is sequenced first because it is the only one whose value
depends on elapsed time: a before/after needs a baseline that predates the
intervention. Building it first lets the baseline accumulate while the other two
are built.

## Design principles

Everything here is built to be shown to someone who has a reason to doubt it.
That drives three choices that would otherwise look like over-engineering:
predictions are declared before the data is examined, guards refuse a comparison
rather than qualify it, and no statistic is reported that the underlying data
cannot support.

## Section 1: Turn counting in ingest

### The problem

The Claude parser counts API requests (`apiCalls`, one per deduplicated
`message.id`) but has no concept of a user turn — `parseTranscriptFile` discards
every entry where `type !== 'assistant'`. Without turns, `Requests/turn` cannot
be computed, and that factor is precisely the tool-call amplification that MCP
removal and tool-call batching are meant to reduce.

### The trap

Counting `type === 'user'` naively is wrong by an order of magnitude. Claude Code
logs tool results as user-role entries, and injects system reminders the same
way. Over the full local corpus (116 main transcripts, 2,696 subagent
transcripts), the naive count admits 2,112 entries where 1,607 are real turns.

A first-pass rule that excluded only `tool_result` and `isMeta` was still wrong
in two further ways, both found by review and confirmed against the corpus.

**It admitted 93 non-prompts (5.5%) into the main-thread count**, none of which
carry `isMeta`:

| Admitted by the naive rule | count |
|---|---:|
| slash-command echoes (`<command-name>...`) | 41 |
| `<local-command-stdout>` echoes | 14 |
| `isCompactSummary` compaction summaries | 14 |
| `[Request interrupted by user...]` | 14 |
| bare `<system-reminder>` entries | 10 |

`promptId` does not discriminate — compaction and interrupt entries carry one.
Compaction does *not* replay history into the transcript (0 duplicate uuids, 0
sessionId mismatches across all main files), so the only compaction artefact is
the summary entry itself.

**It counted subagent dispatch prompts as user turns.** 2,688 of 2,696 subagent
transcripts contain a Task dispatch prompt logged as `type: 'user'`,
`isSidechain: true`, non-meta and non-`tool_result` — 2,727 spurious turns
against 1,607 real ones. See "Subagent transcripts" below.

### The rule

A user turn is an entry where all of the following hold:

- `type === 'user'`
- `isMeta` is falsy
- `isSidechain` is falsy
- `isCompactSummary` is falsy
- `message.content` is not an array whose first element has `type === 'tool_result'`
- the entry's text does not match any of `^<command-name>`,
  `<local-command-stdout>`, `^\[Request interrupted`, `^<system-reminder>`

Text is the string content, or the first `text` part of an array content.

There are currently 0 `isSidechain` entries inside main transcripts, so that
clause is defensive — older Claude Code versions inlined sidechains, and the
clause costs nothing.

**Invariant.** `requests / turns >= 1` per session. Note this is asserted on the
*corrected* rule: under the naive rule the corpus yields 0.72, below the
structural floor, which is what exposed the problem. Do not weaken this test to
make a session pass; a breach means the rule admitted a non-prompt.

### Multi-model transcripts

The parser emits one session row *per model* when a transcript switches models,
so that per-model token attribution is correct. Turns are not attributable to a
model — a user typing a prompt is model-agnostic — and duplicating the turn count
onto each sibling row would double-count turns and halve `Requests/Turn`.

Rule: `userTurns` is carried on exactly **one** row per transcript, the row for
the model with the most calls; ties break on the model name, ascending, so the
choice is deterministic. Sibling rows carry `null`. 25 split rows exist in the
current corpus, so this path is exercised by real data.

### Subagent transcripts

**Subagent rows always carry `userTurns: null`.** A subagent's transcript opens
with the dispatch prompt, which passes every content-shaped test but is not a
human turn — it is the parent's tool call. Counting it inflated turns from 1,607
to 4,334 and understated amplification roughly 2.75x.

This makes the factor definition explicit:

```
Requests/Turn = (main-thread requests + subagent requests) / main-thread turns
```

Delegated requests belong in the numerator. A Task dispatch is the most
consequential form of tool-call amplification there is — one human turn buying
an entire second context — and the factor exists to measure exactly that.
Measured over the corpus: 20,052 main + 32,712 subagent requests over 1,607
turns = **32.83 requests per turn**. Main-thread-only would read 12.48; the spec
previously quoted 8.41, which was wrong on all three counts (junk turns,
subagent turns, and a numerator excluding delegation).

### Tools that cannot report turns

`parsers/codex.js` and `parsers/opencode.js` emit `userTurns: null`, never `0`.
A zero would make `Requests/turn` infinite and silently corrupt any mixed-tool
aggregate.

`packages/ingest/src/normalizer.js` owns the cross-parser view, so it exports
`TURN_CAPABLE_TOOLS = new Set(['claude'])`. Adding turn support to another parser
is then a one-line change to the set.

**Turn capability is a filter, not a caption.** All five factors are computed
over turn-capable rows only. A global "covers 95% of spend" note would hide that
the error concentrates in specific windows: 11 of 81 active days mix tools, and
on 2026-07-22, -07-28 and -08-04 Codex accounts for 74%, 68% and 71% of the day's
calls. Summing those requests against Claude-only turns would inflate
`Requests/Turn` by up to 3x precisely on the days a comparison might land.

Each window therefore reports the cost excluded by the filter, so a reader sees
what the decomposition did not cover — the same treatment `coverageWindow` gives
`excludedCost` rather than letting it vanish.

This does not affect the work deployment, which is Claude Code only, but the
public tool must not report a fabricated number to anyone else.

### Per-day slices

Turns must slice by day, for the reason established in Section 2. `addDay` is
called once per API call and increments `calls`, so turns need a separate
accumulation path: a new `addTurn(byDay, day)` that creates a zeroed slice if the
day is not yet present and increments `turns`. A day may legitimately have turns
without calls, or calls without turns.

**Two-pass ordering.** Turns are identified during the line loop, but the
dominant model is not known until after it (`claude.js:108-122`). Turn days are
therefore buffered into a local map during the loop and applied to the winning
model's `byDay` once the winner is chosen.

**A turn-only day must not extend coverage.** `dataCoverage` treats any `daily`
row as data (`coverage.js:56`), so a prompt at 23:59 whose response lands after
midnight would create a zero-token row and drag the coverage start onto a day
with no cost. Rows with `calls === 0` are excluded from coverage computation.

`DAILY_COLUMNS` in `packages/ingest/src/daily.js` documents the positional
`daily` tuple; `turns` is appended as a new final column.

Two corrections to an earlier draft of this section, both from review:

- **Appending breaks nothing.** All seven positional consumers
  (`normalizer.js:224`, `coverage.js:56/67/110`, `costMix.js:85`,
  `perCall.js:79-80`, `ingest/test/perCall.test.js:130-138`) destructure a prefix,
  so a trailing column is safe. That is the *reason* to append. The earlier claim
  that "every destructuring site must be updated" was false and is withdrawn.
- **`DAILY_COLUMNS` enforces nothing today.** Nothing outside `daily.js` imports
  it; `buildDaily` hand-builds the row (`normalizer.js:90-101`) and `addDay`
  hand-writes the zeroed slice (`daily.js:39`). The proof is `cacheWrite1h`,
  which is accumulated and priced but absent from the emitted row — an asymmetry
  only possible because the constant is decorative. This work adds an assertion
  that the emitted row length equals `DAILY_COLUMNS.length`, so the contract is
  real before a third column-ordering bug can hide in it.

## Section 2: Driver decomposition

### Period assignment

**Everything attributes day-sliced**, through the existing `daily` machinery.

This corrects an earlier draft of this design, which proposed assigning each
session whole to its start date on the assumption that boundary-spanning sessions
were a rounding error. Measured against the local corpus, they are not: only 85
of 2,729 sessions span multiple days, but those 85 carry **76.9% of all cost**
($7,067 of $9,184), with spans up to 14 active days. Start-date assignment would
place three quarters of spend on whichever day a long session happened to begin,
and a single straddling session could dominate one side of a 14-day intervention
window.

This is the same conclusion `daily.js` already reached for the trend charts
(95.2% of Claude main-thread API calls live in multi-day transcripts). The
analysis layer must not adopt a different and worse rule than the charts it sits
beside.

### The equation

Day-slicing makes "sessions per period" ill-defined, so the adoption factor
becomes **active days**:

```
Cost = ActiveDays x (Turns/ActiveDay) x (Requests/Turn) x (Tokens/Request) x (Price/Token)
```

It generalizes to the team phase as `Users x ActiveDays/User x ...`, which maps
onto Uber's structure more directly than sessions did.

**`Tokens/Request` counts all four buckets** — input + output + cacheRead +
cacheWrite. The identity requires it: `Tokens x Price/Token` must equal cost, and
cost is priced from all four (`normalizer.js` `costBreakdown`). This
**deliberately differs from `PerCallTrend`**, which measures *context* as input +
cacheRead + cacheWrite and excludes output (`perCall.js:90-93`). Two panels will
therefore show different tokens-per-request numbers. The difference is small
(output is ~0.3% of tokens) but it is a definitional split, which `AGENTS.md:71`
forbids leaving implicit: both panels must name which measure they show, in the
glossary and on the panel.

The identity holding exactly is a property of arithmetic, not of this design —
it telescopes by construction over a single day-sliced aggregate. It is worth
asserting in tests to catch a wiring error, but it is not evidence the
decomposition is meaningful.

Each factor corresponds to an action someone can take:

| Factor | Meaning | Lever |
|---|---|---|
| ActiveDays | days with any recorded activity | adoption |
| Turns/ActiveDay | prompts per working day | engagement |
| Requests/Turn | tool-call amplification | MCP removal, tool-call batching |
| Tokens/Request | context size per call | context hygiene, compaction, cache TTL |
| Price/Token | blended rate | model selection, subagent routing, token-type mix |

**`Price/Token` is not a clean model-choice lever.** With ~88% of spend in cache
traffic (`BACKLOG:18`) and per-model price ratios fixed at 1x input / 0.1x cache
read / 1.25x cache write / 5x output, the blended rate moves whenever the
cacheRead:input ratio moves. A cache-TTL or context-hygiene change — which the
table assigns to `Tokens/Request` — will also register under `Price/Token`. The
confound set therefore includes **token-type cost share**, so a reader is told
when the blended rate moved because the mix changed rather than because the model
did.

### Attribution method

**Sequential (chained) attribution**, matching Uber. For factor *i* comparing
period 0 to period 1, hold factors left of *i* at period-1 values and factors
right of *i* at period-0 values:

```
delta_i = (prod_{j<i} f_j^1) x (f_i^1 - f_i^0) x (prod_{j>i} f_j^0)
```

Contributions sum exactly to `Cost_1 - Cost_0`.

Sequential attribution is order-dependent, which is a genuine weakness.
**LMDI** (log-mean Divisia index) is exact *and* order-independent:

```
delta_i = L(Cost_1, Cost_0) x ln(f_i^1 / f_i^0)
where L(a,b) = (a-b)/(ln a - ln b), and L(a,a) = a
```

LMDI is implemented alongside sequential but **used as a test oracle, not
displayed**. The two methods are said to disagree when, for any single factor,
the two attributions differ by more than **10 percentage points of the total
change**, or when they **differ in sign**. Sign disagreement is the serious case:
one method claiming a factor added money while the other claims it saved money
means the ordering, not the data, is driving the story. On either condition the
panel states that the change is too large for order-dependence to be ignored,
rather than quietly presenting whichever result it computed first.

Sequential is what gets displayed, for two reasons: "holding everything else
constant, adoption added $340" survives contact with a non-technical stakeholder
and "log-mean Divisia index" does not; and citing the same decomposition Uber
published is itself part of the argument being made.

LMDI requires all factors strictly positive. Periods with a zero factor fall back
to sequential-only with the oracle check skipped, and this is recorded rather
than hidden.

### Files

- **New** `packages/dashboard/src/lib/decompose.js` — both methods, pure functions
- **New** `packages/dashboard/src/components/DriverDecomposition.jsx`
- **Edit** `packages/dashboard/src/lib/glossary.js` — one entry per factor

## Section 3: Intervention measurement

The purpose is not to detect improvement. It is to make a claim that survives a
skeptic. The design is mostly guards.

### Declaring an intervention

A gitignored `interventions.json` at the repo root, with
`interventions.example.json` committed. Ingest reads it and embeds it into
`tokens.json`, so the dashboard remains a pure static consumer — consistent with
the existing architecture.

```json
[{
  "date": "2026-09-15",
  "label": "Replaced MCP servers with CLI tools",
  "expect": "tokensPerRequest",
  "direction": "down",
  "note": "Removed 4 MCP servers; schema overhead was ~55K tokens/session"
}]
```

`expect` must be exactly one of the five factor keys — `activeDays`,
`turnsPerActiveDay`, `requestsPerTurn`, `tokensPerRequest`, `pricePerToken`. An
unrecognised value **warns on stderr with the list of valid keys and skips that
entry**, leaving the rest of the file usable.

It does not abort. An earlier draft said it should "fail ingest loudly, in
keeping with how `index.js` already surfaces unpriced and unidentified models" —
but `index.js:47-69` warns and *continues*; nothing there aborts. Aborting would
also kill `tokens.json` regeneration in `--watch` mode over a typo in an optional
file, taking the whole dashboard down for a config error.

`expect` names which of the five factors is predicted to move, and must be
declared **before the data is examined**. This is the most important field in the
design. Five factors and two directions is ten chances to find a flattering
story; choosing the metric after seeing the result guarantees a win every time
and makes the finding worthless. Pre-registration is what separates a measurement
from a rationalization.

All five factors are still displayed, so an unexpected mover is visible. Only the
declared one is the claim.

### The prediction is a factor AND a direction

`expect` alone is not a falsifiable claim, and an earlier version of this spec
was wrong to imply it was. It fixed no direction anywhere while listing only
reduction-flavoured verdicts, which read as "lower is better" — and the
implementation duly hardcoded `after[expect] < before[expect]`. Two of the five
factors in the table above are levers you want to move the *other* way:
`ActiveDays` is adoption and `Turns/ActiveDay` is engagement. An intervention
that doubles adoption from 7 active days to 14 is exactly what such a change
aims at, and under a fixed "lower is better" rule it is reported
`not-supported` — a wrong verdict on an input the schema explicitly accepts.

`interventions.json` therefore carries an optional
`"direction": "down" | "up"`, validated on read alongside `expect` and subject
to the same warn-and-skip discipline as every other field. It **defaults to
`down`**, so a declaration written before the field existed keeps precisely the
meaning it had.

The direction is part of the pre-registration, not a presentation detail. Five
factors and two directions is ten chances to find a flattering story; declaring
the factor while leaving the direction to be settled after the fact throws away
half of what pre-registration buys. The panel therefore prints both — "predicted
to move active days up" — so a reader can see what would have counted as a
failure, and the glossary says a declaration naming no direction is read as
predicting a fall.

### Windows

Equal-length windows either side of the intervention, default 14 days,
**constrained to multiples of 7**. The weekday effect is large — mean cost per
active day runs $130-141 Monday to Thursday against $77 Sunday and $85 Saturday,
a 1.8x spread — so a window that is not a whole number of weeks compares
different day-of-week mixes and manufactures a difference. 14 is two clean weeks.

The intervention day itself is excluded from both windows, being partial on each
side.

### Guards

1. **Coverage.** The before-window must lie entirely at or after the first day
   the record actually covers. If it does not, the comparison is **refused**, not
   truncated silently. A baseline reaching into deleted transcripts reads as a
   suspiciously cheap "before" and manufactures an improvement from nothing. This
   is the failure already paid for once, at 41% understatement, by
   `coverageWindow()`.

   **The floor must come from `coverageWindow(sessions, coverage).start`, never
   from `dataCoverage().start`.** `dataCoverage` returns `null` when no session
   predates the dominant tool's first day (`coverage.js:75`), which is exactly the
   case on a single-tool machine — and the work deployment is Claude Code only.
   Verified against the local corpus: filtered to Claude sessions,
   `dataCoverage()` returns `NULL` while `coverageWindow(...).start` correctly
   returns `2026-06-11`. Keying the guard off `dataCoverage` would leave it with
   no floor and silently pass every before-window, re-arming the precise failure
   it exists to prevent. This is a blocker-grade trap and the test suite must
   cover the single-tool case explicitly.

2. **Maturity.** If the after-window has not fully elapsed, the result is labelled
   provisional, with days remaining shown.

3. **Power.** Measured in **active days and turns, not calendar length.** 49 of
   the 130 calendar days in the corpus span have no data at all, so a 14-day
   window can contain as few as 3 active days and still pass a calendar-length
   check. Below the configured minimum active days, the result is shown but
   labelled underpowered — shown rather than hidden, so it can be watched as it
   accumulates.

   **Zero active days on either side is refused, not labelled.** With one side
   empty, cost is 0, LMDI is skipped, and sequential attribution reports
   "ActiveDays saved everything" — a result that reads as `supported` while
   meaning nothing. An intervention date in the future is reported as `pending`.

4. **Confounds.** Across the boundary, compare model mix (cost share by model),
   project mix (cost share by project), subagent share, and **token-type cost
   share** (per S4 above). A shift is reported when any single category's cost
   share moves by more than **10 percentage points** between the two windows —
   configurable, defaulting to 10. Every shift at or above the threshold is
   listed with its magnitude; the verdict becomes `confounded` when at least one
   unexpected shift is present.

   **An intervention may pre-register the shift it intends to cause.** Cost
   shares are endogenous: an intervention that scopes subagent dispatches better
   (`BACKLOG:29`) will drop subagent cost share by more than 10 points *by
   design*, and flagging that as a confound would mark every successful
   intervention `confounded`. `interventions.json` therefore accepts an optional
   `expectedShift` naming categories exempt from the confound verdict. A category
   is named either qualified (`"model/claude-sonnet-5"`) or bare
   (`"claude-sonnet-5"`); a bare `"subagent"` works because in that one
   dimension the dimension name and the category name coincide. **It is a
   category, never a dimension** — `["model"]` must not exempt every model
   shift, or an unannounced switch to a third model rides in on a declaration
   that never mentioned it. Exempt shifts are still listed, so nothing is
   hidden — they simply do not invalidate the result. Declaring one is subject to the same pre-registration discipline
   as `expect`: it is a prediction, not a post-hoc excuse.

   **Other interventions inside either window are themselves a confound.** Two
   declarations within one window length of each other put the first inside the
   second's before-window; any such overlap is listed.
   This is the guard that earns its keep in a meeting: the first
   question a skeptical stakeholder asks is whether something else caused the
   change, and a model switch inside the window invalidates a Price/Token claim
   outright and probably a Tokens/Request claim too.

5. **Variance.** Report the daily series for both sides with n, mean and median —
   not two bare averages. A 20% drop inside 50% daily spread is not a finding.
   The median is load-bearing rather than decorative: daily cost has a
   coefficient of variation of 1.10, with a median of $71 against a mean of $113,
   so the mean alone is dragged by a handful of expensive days.

### No significance test

No p-value is computed. Daily cost series are autocorrelated and far from
normal; a t-test over 14 such days produces a number that looks authoritative and
means nothing. A competent challenge to that statistic would discredit the entire
presentation over a figure that was never needed. Showing both distributions and
letting any overlap be visible is both more honest and, in front of an audience,
more persuasive.

### Reproducibility

A verdict computed today is not stable. Transcripts grow in place and the
retention sweep advances the coverage floor, so a result that reads `supported`
now becomes `refused` once its before-window is swept — the same
non-reproducibility that makes the boundary detector's backtest gate unreliable
(`BACKLOG:34`, which this spec should have cited and now does).

Two mitigations:

- **The after-window ends strictly before today**, so the final day is not still
  accumulating while being measured.
- **A matured result is persisted** to a sidecar file beside `interventions.json`
  (gitignored on the same terms). Once an intervention's after-window has fully
  elapsed and passed its guards, the computed verdict and the figures behind it
  are written once and thereafter displayed from the sidecar. The comparison is
  then a record of what was true when it could still be measured, rather than a
  number that quietly changes as history is deleted underneath it.

### Output

- A plain-language verdict: **supported**, **underpowered**, or **confounded**
- The declared metric's before/after, absolute and percentage
- The other four factors alongside
- The confound report

Plus vertical rules at each intervention date on `PerCallTrend` and
`CostMixTrend`. Cheap to build and disproportionately persuasive: a visible
discontinuity in a chart the audience is already reading does more work than a
table.

### Files

- **New** `interventions.example.json`; `interventions.json` added to `.gitignore`
- **Edit** `packages/ingest/src/index.js` — read config, embed into `tokens.json`
- **New** `packages/dashboard/src/lib/intervention.js`
- **New** `packages/dashboard/src/components/InterventionPanel.jsx`
- **Edit** `PerCallTrend.jsx`, `CostMixTrend.jsx` — marker support
- **Edit** `glossary.js`

## Testing

Per `AGENTS.md`, a passing suite is not proof the parsers are right. Ingest
changes are additionally verified against real transcript output before being
trusted.

**Turn counting**
- fixtures covering `tool_result` content, `isMeta` injection, string content,
  and array `text` content
- multi-model transcript: turns appear on exactly one row, `null` on siblings
- `codex` and `opencode` sessions carry `userTurns: null`, never `0`
- invariant: `requests / turns >= 1` for any session with `turns > 0`
- a day with turns but no calls produces a valid slice, and does not move the
  coverage start
- slash-command, `local-command-stdout`, `isCompactSummary`, interrupt and bare
  `system-reminder` entries are each excluded (one fixture per row of the table
  in Section 1)
- subagent transcripts carry `userTurns: null` even though their dispatch prompt
  passes every content-shaped test
- multi-part content is counted correctly: 43 real turns carry `text+image` and 4
  carry `text+image+image` in the current corpus
- the 8 subagent transcripts with zero rule-passing entries do not divide by zero
- the emitted `daily` row length equals `DAILY_COLUMNS.length`
- `perCall.test.js:130`'s sum test is extended to cover the new turns column

**Decomposition**
- property test on randomised inputs: contributions sum to the total delta
  within a relative tolerance of `1e-9`
- sequential and LMDI agree on realistic inputs, by the same rule the panel uses
  (no factor differing by more than 10 percentage points of the total change, no
  sign disagreement)
- a synthetic input engineered to breach that rule is detected and reported,
  rather than silently displayed
- a zero factor skips the oracle and records that it did

**Intervention**
- **a single-tool (Claude-only) corpus still has a coverage floor** — the
  `dataCoverage() === null` case from guard 1, asserted directly
- a before-window preceding coverage start is refused
- an incomplete after-window is marked provisional
- a synthetic model-mix shift trips the confound detector
- the intervention day is excluded from both windows
- a window below minimum ACTIVE DAYS is labelled underpowered
- zero active days on either side is refused, not labelled
- a future intervention date reports `pending`
- an overlapping intervention inside either window is listed as a confound
- a pre-registered `expectedShift` category does not trigger `confounded`, but is
  still listed
- a matured result persisted to the sidecar is displayed from it, unchanged, once
  its before-window has fallen outside coverage

## Non-goals

- Team or multi-user aggregation. Single user throughout; the equation is shaped
  so `Users` prefixes cleanly later.
- Outcome denominators (cost per commit, per PR). The Outcome layer.
- Audience-scoped views. The Presentation layer.
- Any network call, upload, or telemetry. The tool stays fully local.
- Automatic intervention detection. Interventions are declared, never inferred —
  inferring them from the data is the same error pre-registration exists to
  prevent.

## Related backlog items

- **`BACKLOG:34`** — the boundary-detector backtest gate is non-reproducible for
  the same reason described under Reproducibility. Same root cause, same repo,
  worth fixing with the same instinct: pin what you measure.
- **`BACKLOG:31`** — an unverified report of a ~20x cache regression on *resumed*
  sessions. If real, a cache bug and a genuine context change are
  indistinguishable in `Tokens/Request`, which would confound exactly this
  layer's headline efficiency factor. Worth resolving before an intervention
  result is presented to anyone.
- **`BACKLOG:17`** — the deferred rollups/bounded-sessions redesign of
  `tokens.json`. Turns and the intervention block must be carried into that
  design when it lands, or the decomposition silently loses its denominator.

## Deployment note

On the work machine, raise `cleanupPeriodDays` in `~/.claude/settings.json`
before anything else. It defaults to 30 days, and every transcript older than
that is being deleted continuously. The baseline this layer depends on
cannot be recovered once swept.

`interventions.json` will describe internal working practices and is gitignored.
It reaches only `tokens.json`, which is also gitignored. Nothing about the work
environment can reach the public repository.

## Revision history

**2026-09-03, after adversarial review.** An independent review against the live
corpus found three blockers and nine significant issues. All are folded in above.
The three that changed the design rather than clarifying it:

1. **Subagent dispatch prompts were being counted as user turns** (2,727 spurious
   against 1,607 real), and the numerator excluded subagent requests. The factor
   is now defined as `(main + subagent requests) / main-thread turns` = **32.83**,
   not the 8.41 originally quoted.
2. **The coverage guard was keyed off `dataCoverage()`, which returns `null` on a
   single-tool machine** — i.e. it would have been inert on the work deployment it
   was written for. Now keyed off `coverageWindow(...).start`.
3. **The turn rule admitted 93 non-prompts (5.5%)** — slash-command echoes,
   compaction summaries, interrupts, stdout echoes, bare system reminders.

Two claims in the earlier draft were simply wrong and are withdrawn: that
appending to `DAILY_COLUMNS` requires updating every destructuring site (it
breaks none), and that `index.js` aborts on unpriced models (it warns and
continues).

**2026-09-04, after the whole-branch review of `feat/analysis-layer`.** The
review found `expect` under-specified: the spec named a factor and never named a
direction, while listing only reduction-flavoured verdicts. "The prediction is a
factor AND a direction" above is new, and the declaration example now carries
the field. Correcting only the code would have left this document wrong for the
next reader.
