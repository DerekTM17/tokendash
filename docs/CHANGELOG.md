# token-dashboard — Changelog

A record of significant changes. Entries grouped by date (descending,
most recent first). Each covers **What** + **Why**; bigger decisions
also include **Tradeoffs / Alternatives considered**.

Curated, not exhaustive — `git log` has every commit.

## 2026-08-18

### Tooltips for every term, and the repo published at DerekTM17/tokendash

**Why:** Two things. (1) 23 tooltips — summary cards, metrics strip, the four cost parts and all eleven panel headings — driven by a single glossary in lib/glossary.js so a term cannot drift between panels. The bubble is PORTALLED to document.body: several panels clip their overflow (SummaryCards for its glow) and an absolutely-positioned tooltip is cut off at the card edge. Visibility is React state rather than CSS :hover, which buys keyboard support (focus opens, Escape closes) and makes it testable at all — a CSS-only tooltip is invisible to jsdom and its tests pass either way. glossary.test.js scans components/ for every term= prop and fails on a missing entry; SummaryCards and MetricsStrip pass theirs dynamically so they carry their own assertions. Verified in Chromium: 23 tooltips at 1440px and 900px, none leaving the viewport. (2) Published PUBLIC at https://github.com/DerekTM17/tokendash with README, MIT license and a screenshot. autostart.sh no longer hardcodes one machine: ROOT resolves from the script's own location, and node resolution falls back to the highest nvm version because cron does not source a login shell — command -v node finds nothing there. TOKENDASH_NODE_BIN overrides. Decision on docs: kept the engineering diary intact, real spend figures and all, because the design rationale is what makes the code legible to a reader. tokens.json stays gitignored so no usage data is published.

## 2026-08-14

### Burn rate and projection scoped to the covered window

**Why:** The rate metrics divided total cost by the span from the earliest session of ANY tool, so six near-empty weeks of April opencode activity padded the denominator while that pre-boundary spend sat in the numerator as though it belonged to the window. Live effect: $78.49/day reported over 110 days where the honest figure is $132.77/day over 65 — a 41% understatement, and $2,355/mo projected against $3,983/mo. New coverageWindow() in lib/coverage.js returns { start, end, days, cost, excludedCost } and keeps the excluded $4.08 visible rather than dropping it. The strip also carries a caption now: the totals above are the sum of what survives, not a lifetime figure — transcripts older than 30 days were deleted until cleanupPeriodDays was raised on 2026-07-27, so earlier spend is unrecoverable rather than zero. Deliberately did NOT trim the headline totals to the window: that would discard real dollars to fix a labelling problem.

## 2026-08-04

### Session boundary detector — Phase 1 shipped, thresholds retuned to 325k/450k

**Why:** Brings the design spec and changelog into line with what actually shipped
(implementation diverged from the 2026-08-03 design in four ways during execution).
**Thresholds moved to ARM 325k / CEILING 450k**, not the 200k/300k below — the
break-even arithmetic didn't change, but the backtest gate measures a live, growing
corpus and 200k fired on 41.9% of real sessions against a <=35% budget; 275k/300k
passed at 33.8% and drifted to 36.0% within hours, so 325k/450k was chosen for ~7pp of
headroom. **The band ladder is gone** — exactly two terminal bands (arm, ceiling)
instead of ARM/250k/CEILING/+100k-forever, which cut nudges per firing session from
7.52 to 2.88; a session peaking near 1M no longer earns nine nudges. **Compaction no
longer clears fired bands** — a context drop resets the high-water mark but keeps
`firedBands`, taking nudges per firing session from 2.88 to 1.86 at the cost of going
quiet on repeatedly-compacting sessions (7 of 8 in the measured corpus get no nudge
after their first pair); Phase 2's deferred `PostCompact` hook is the principled fix.
**Stale-read counting was rewritten** to pair each read with the next edit to that
path (one count per path) instead of only the earliest read/earliest edit, which both
under- and over-counted files touched more than once. Final backtest on 75 main
sessions: 21/75 firing (28.0%, target <=35%), 1.86 nudges/firing session (target
<=2.0), 18/18 sessions with peak >=500k fire, 0/33 below 100k fire, gate exit 0.
**Known gap, not shipped:** the design's "continue verdicts don't consume the band"
mitigation for the highest-severity risk (the model rationalizing "continue"
indefinitely) was never built — there is no return channel from the model back into
hook state, so the band is consumed unconditionally at fire time and `state.verdicts[]`
is a misleadingly-named fire log that nothing reads back. Below `CEILING_TOKENS` that
risk is unmitigated. Full detail in
`docs/superpowers/specs/2026-08-03-session-boundary-detector-design.md`.

## 2026-08-03

### Per API call panel — context and cost per call, on per-day attribution

**Why:** Phase A could say cache share was 88.9% but not whether that was context discipline improving; delegating more raises cache-write share, so a good habit and a bad one looked alike. This measures the driver: context per API call. Building it surfaced a defect that also affected Phase A — bucketing a session's totals at startedAt, when 95.2% of Claude main-thread calls live in transcripts spanning more than one calendar day (max 19.2 days). Parsers now emit per-day slices and both panels bucket from those. The correction halves the apparent improvement: Claude main context per call is 320k then 191k for the last two weeks, not the 209k/117k the startedAt version claimed.

### Session boundary detector — design and Phase 1 plan

**Why:** Long sessions are the dominant cost: 82.5% of input spend occurs above 300k context, and half of all sessions peak above 160k. session-checkpoint already writes good handoffs but must be invoked deliberately, so it fires too rarely. This specs the missing trigger — a UserPromptSubmit hook that reads context from the statusline stamp, applies high-water band logic, and asks the model to judge whether the incoming prompt starts a new task. Thresholds (ARM 200k, CEILING 300k) were the design-time estimate, derived from break-even against a measured 35.6k session floor — the implementation retuned them; see the 2026-08-04 entry above for the shipped values and why they moved. Design only at time of writing; no implementation code yet.

### Cost mix over time panel

**Why:** The dashboard could report that 88.9% of spend is cache traffic but not whether that number was moving, so an improving habit and a quiet week looked identical — cache share is now a weekly cost-weighted trend beside the aggregate it extends, reading 93 → 90 → 93 → 85 → 85 → 90 → 82 across the substantive weeks. Two choices carry the design. A total-cost bar row under the band, because three weeks at $1-$3 would otherwise render as the three best weeks on record and make idleness look like discipline. And gap buckets carrying null rather than zero, so the band breaks across dead weeks instead of diving to the floor. Isolated buckets get a dot: a bucket with no live neighbour has nothing to form a line segment with and draws an invisible zero-area path, which would have silently erased exactly the two low-volume weeks the bar row exists to expose. Share is cost-weighted per bucket, never a mean of per-session percentages — ten sessions are 57% of all spend, so averaging would let a $0.08 subagent count as much as a $699 session. Cache share is also a confounded proxy: delegating more is a good habit that raises cache-write share, since every subagent starts a fresh context and pays writes instead of riding long reads. The direct measures — context per API call, cost per call — are specced as Phase B and need an apiCalls count added across all three parsers, which is why they are not in this change.

## 2026-07-28

### Model attribution reconciles across every tool

**Why:** Two parsers were mis-filing tokens by model and the guard meant to catch it had a hole. opencode left two April sessions at model 'unknown' because their session row never had the model column populated — 31.8M deepseek-v4-pro tokens priced $2.02 against ccusage's $8.24 — so the parser now falls back to the modelID on each assistant message. That bug survived months because the unpriced-model warning exempts both 'unknown' and any session carrying a cost, and opencode records its own cost, so it hit both exemptions at once; an unidentified model is a parser failure rather than a missing rate and now gets its own warning across every parser. With Codex fixed the same day, reconcile agrees with ccusage on all 11 models with no 'unknown' row at all.

### Codex attribution: per-turn model, replayed history dropped

**Why:** Codex was the entire residual drift against ccusage, reading ~70% high and putting 642M tokens on gpt-5.6-terra that belonged to gpt-5.6-sol: the parser latched the first turn_context model and billed the whole cumulative counter to it, and threads that inherit a conversation (subagent spawns, resumes) replay the parent's entire transcript at file-open — 787 of 800 token_count events in one real rollout — so the parent's history was charged once per child. Usage is now the delta of the cumulative counter attributed to the model active at the time, with the file-open replay burst tracked but not billed; every Codex model now matches ccusage and total drift went +1.4% to -0.0%.

## 2026-07-27

### Cost feedback loop: status line + Read hook

**Why:** Usage analysis put 62% of ~7k dollars of spend in ten long sessions and 88% of cost in cache traffic rather than output, because cost tracks context size times number of API calls — but that feedback only ever arrived days later in a dashboard. The status line now prices the next turn (context x cache-read rate) and a PreToolUse hook prices a file before it enters context, both at the moment the decision is actually made.

### Pricing reconciliation + payload cost

**Why:** Every Claude dollar here is estimated, so a wrong rate moved the headline number invisibly — Opus 5 read $0 and Sonnet 5 sat 50% high; pricing now comes from a vendored LiteLLM snapshot, cache writes are billed by TTL tier (55% are 1-hour at 2x, previously all charged at 1.25x), and scripts/reconcile.mjs cross-checks against ccusage, which now agrees to the cent on every Claude model. Polling also stopped re-downloading 1.5MB every 8 seconds.

## 2026-07-25

### Opus 5 pricing + unpriced-model warning

**Why:** Claude Opus 5 was missing from the pricing table so 31 sessions and 354M tokens priced at $0 (the prefix matcher can't reach it from claude-opus-4); ingest now warns on any model that has tokens but no pricing entry, so the next new model family surfaces on first ingest instead of silently understating cost.

## 2026-07-21

### Per-model attribution within a session

**Why:** Mid-session /model switches were collapsed to the dominant model, hiding the other model's tokens and pricing them wrong; each model in a transcript now gets its own accurately-priced row.

### Delegated subagent transcripts ingested (Sonnet/Haiku visibility)

**Why:** All delegated-agent usage was invisible — the parser skipped the nested subagents/ transcripts where Sonnet/Haiku run under Task delegation, understating totals by ~$786 and hiding Sonnet entirely.

## 2026-07-20

### Content-inferred project attribution for $HOME-launched sessions

**Why:** All Codex/GPT usage bucketed to 'other' because Codex runs from $HOME; transcript path dominance now attributes it (marked ~inferred), and hidden-dir tool repos no longer masquerade as projects.

### Contained sessions table + per-model project breakdown

**Why:** The sessions table made the page an endless scroll, and 'which models on which project' had no answer — the group slide panel was showing only a session count and total.

### OpenAI/Codex cost capture (GPT pricing + token-bucket dedup)

**Why:** OpenAI usage showed $0 everywhere because pricing was Anthropic-only, and pricing it exposed that the Codex parser double-counted cached-input and reasoning tokens (Codex counters overlap; ours are disjoint).

### Always-on cron autostart (ingest watcher + Vite on :5199)

**Why:** The dashboard only ran when started by hand, unlike ledger's; a ledger-pattern scripts/autostart.sh (@reboot + 10-min watchdog, HTTP liveness + pidfile checks, nvm node path hardcoded for cron) keeps tokens.json fresh via ingest --watch and the UI always reachable.

