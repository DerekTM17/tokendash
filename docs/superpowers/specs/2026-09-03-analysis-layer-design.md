# Analysis layer: driver decomposition and intervention measurement

**Date:** 2026-09-03
**Status:** design approved, implementation plan not yet written
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
context at 400K; ours arms at 325K), cache-share tracking in `CostMix`, cost per
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
way. Measured over 40 local transcripts larger than 50KB:

| | naive | correct |
|---|---:|---:|
| entries counted as turns | 2,112 | **182** |
| resulting requests/turn | **0.72** | **8.41** |

The naive figure is below 1, which is structurally impossible — a turn cannot
produce fewer than one request. That inequality is asserted as a test invariant.

The `last-prompt` entry type looked like a convenient turn proxy and is not: it
matched the true turn count in **0 of 40** transcripts (346 vs 182, no consistent
ratio). It must not be used.

### The rule

A user turn is an entry where all of the following hold:

- `type === 'user'`
- `message.content` is not an array whose first element has `type === 'tool_result'`
- `isMeta` is falsy

### Multi-model transcripts

The parser emits one session row *per model* when a transcript switches models,
so that per-model token attribution is correct. Turns are not attributable to a
model — a user typing a prompt is model-agnostic — and duplicating the turn count
onto each sibling row would double-count turns and halve `Requests/turn`.

Rule: `userTurns` is carried on exactly **one** row per transcript, the row for
the model with the most calls. Sibling rows carry `null`.

Aggregation therefore sums requests across all rows and turns across non-null
rows only, which is correct by construction.

### Tools that cannot report turns

`parsers/codex.js` and `parsers/opencode.js` emit `userTurns: null`, never `0`.
A zero would make `Requests/turn` infinite and silently corrupt any mixed-tool
aggregate.

`packages/ingest/src/normalizer.js` owns the cross-parser view, so it exports
`TURN_CAPABLE_TOOLS = new Set(['claude'])` and emits a `turnCoverage` summary
into the `tokens.json` totals — the share of cost carried by turn-capable tools.
The dashboard reads that figure rather than recomputing it, and states its own
coverage honestly ("decomposition covers 94% of spend"). Adding turn support to
another parser is then a one-line change to the set.

This does not affect the work deployment, which is Claude Code only, but the
public tool must not report a fabricated number to anyone else.

### Per-day slices

Turns must slice by day, for the reason established in Section 2. `addDay` is
called once per API call and increments `calls`, so turns need a separate
accumulation path: a new `addTurn(byDay, day)` that creates a zeroed slice if the
day is not yet present and increments `turns`. A day may legitimately have turns
without calls, or calls without turns.

`DAILY_COLUMNS` in `packages/ingest/src/daily.js` is the exported producer /
consumer contract for the positional `daily` tuple. `turns` is appended as a new
final column. Because the array is positional, every destructuring site must be
updated; the exported constant is what keeps both sides from drifting.

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

The identity is exact, it reconciles with the existing trend panels, and it
generalizes to the team phase as `Users x ActiveDays/User x ...`, which maps onto
Uber's structure more directly than sessions did.

Each factor corresponds to an action someone can take:

| Factor | Meaning | Lever |
|---|---|---|
| ActiveDays | days with any recorded activity | adoption |
| Turns/ActiveDay | prompts per working day | engagement |
| Requests/Turn | tool-call amplification | MCP removal, tool-call batching |
| Tokens/Request | context size per call | context hygiene, compaction, cache TTL |
| Price/Token | blended rate | model selection, subagent routing |

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
  "note": "Removed 4 MCP servers; schema overhead was ~55K tokens/session"
}]
```

`expect` must be exactly one of the five factor keys — `activeDays`,
`turnsPerActiveDay`, `requestsPerTurn`, `tokensPerRequest`, `pricePerToken`. Any
other value is a configuration error and fails ingest loudly with the list of
valid keys, in keeping with how `index.js` already surfaces unpriced and
unidentified models rather than absorbing them.

`expect` names which of the five factors is predicted to move, and must be
declared **before the data is examined**. This is the most important field in the
design. Five factors and two directions is ten chances to find a flattering
story; choosing the metric after seeing the result guarantees a win every time
and makes the finding worthless. Pre-registration is what separates a measurement
from a rationalization.

All five factors are still displayed, so an unexpected mover is visible. Only the
declared one is the claim.

### Windows

Equal-length windows either side of the intervention, default 14 days,
configurable. The intervention day itself is excluded from both windows, being
partial on each side.

### Guards

1. **Coverage.** The before-window must lie entirely at or after
   `dataCoverage().start`. If it does not, the comparison is **refused**, not
   truncated silently. A baseline reaching into deleted transcripts reads as a
   suspiciously cheap "before" and manufactures an improvement from nothing. This
   is the failure already paid for once, at 41% understatement, by
   `coverageWindow()`.

2. **Maturity.** If the after-window has not fully elapsed, the result is labelled
   provisional, with days remaining shown.

3. **Power.** Below the configured minimum window, the result is shown but
   labelled underpowered. Shown rather than hidden, so it can be watched as it
   accumulates.

4. **Confounds.** Across the boundary, compare model mix (cost share by model),
   project mix (cost share by project), and subagent share. A shift is reported
   when any single category's cost share moves by more than **10 percentage
   points** between the two windows — configurable, defaulting to 10. Every shift
   at or above the threshold is listed with its magnitude; the verdict becomes
   `confounded` when at least one is present.
   This is the guard that earns its keep in a meeting: the first
   question a skeptical stakeholder asks is whether something else caused the
   change, and a model switch inside the window invalidates a Price/Token claim
   outright and probably a Tokens/Request claim too.

5. **Variance.** Report the daily series for both sides with n, mean and median —
   not two bare averages. A 20% drop inside 50% daily spread is not a finding.

### No significance test

No p-value is computed. Daily cost series are autocorrelated and far from
normal; a t-test over 14 such days produces a number that looks authoritative and
means nothing. A competent challenge to that statistic would discredit the entire
presentation over a figure that was never needed. Showing both distributions and
letting any overlap be visible is both more honest and, in front of an audience,
more persuasive.

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
- a day with turns but no calls produces a valid slice

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
- a before-window preceding coverage start is refused
- an incomplete after-window is marked provisional
- a synthetic model-mix shift trips the confound detector
- the intervention day is excluded from both windows
- a window below minimum length is labelled underpowered

## Non-goals

- Team or multi-user aggregation. Single user throughout; the equation is shaped
  so `Users` prefixes cleanly later.
- Outcome denominators (cost per commit, per PR). The Outcome layer.
- Audience-scoped views. The Presentation layer.
- Any network call, upload, or telemetry. The tool stays fully local.
- Automatic intervention detection. Interventions are declared, never inferred —
  inferring them from the data is the same error pre-registration exists to
  prevent.

## Deployment note

On the work machine, raise `cleanupPeriodDays` in `~/.claude/settings.json`
before anything else. It defaults to 30 days, and every transcript older than
that is being deleted continuously. The baseline this layer depends on
cannot be recovered once swept.

`interventions.json` will describe internal working practices and is gitignored.
It reaches only `tokens.json`, which is also gitignored. Nothing about the work
environment can reach the public repository.
