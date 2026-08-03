# token-dashboard — Sessions

Raw session stubs (auto-captured). Promote meaningful work to CHANGELOG.md via `ledger ship`; stubs remain as audit trail.

## 2026-07-27

#### Handoff — TokenDash review, pricing correctness, and the cost feedback loop

**Goal** — Review TokenDash end to end, fix what the review found, then build something that makes context cost visible while working rather than days later.

**Done** (all on `main`, tree clean)

- `7476a5e` — seven fixes: vendored LiteLLM pricing, cache-write TTL tiers, reconcile tool, poll/caching, gzip, watcher recycling, dead-code removal.
- `5159d3f` — status line showing `+$X/turn` (context × cache-read rate).
- `7a01eba` — `PreToolUse`/`Read` hook pricing a file before it enters context.
- Changelog entry shipped via `ledger ship` for the pricing work.

Verified, not assumed:
- `npm test` → 48 ingest + 35 dashboard tests, 0 failures.
- `node scripts/reconcile.mjs` against a **fresh** ccusage run → every Claude model agrees within 2 cents (opus-4-8 −$0.02, fable-5 −$0.02, opus-5/sonnet-5/haiku/sonnet-4-6 exact). Total drift +1.4%, entirely Codex.
- Dashboard HTTP 200 on :5199; ingest watcher alive.
- Hook proven to fire in-session (its `additionalContext` reached the model on a real Read).

**Next** — Fix Codex model attribution in `packages/ingest/src/parsers/codex.js`. We report `gpt-5.6-terra` at 642M tokens / $208 where ccusage sees 5.5M / $3.09, and `gpt-5.6-sol` at $43 where ccusage sees $144. Token counts disagree, so this is attribution (likely reading a session-level model field instead of per-turn), **not** pricing. It is the entire residual +1.4%. Done when `node scripts/reconcile.mjs` shows terra under 2%.

**Decisions** (settled — don't re-litigate)

- Pricing comes from a **vendored** LiteLLM snapshot (`scripts/update-pricing.mjs` → `packages/ingest/src/pricing-data.json`), not a live fetch: ingest runs every few seconds from a watcher and must work offline, and a committed snapshot makes a rate change a reviewable diff. The hand-written `FALLBACK` table in `pricing.js` is last resort only.
- Payload archival was **deliberately deferred**. Only 109 of 2,391 sessions are older than 30 days, so age-based archiving would drop 4.5% of rows and fix nothing. Transfer cost was solved instead (304s + gzip). Full design and the trigger threshold are in `docs/BACKLOG.md`.
- The Read hook does **not** gate on approval. `permissionDecision: "ask"` would stall the long autonomous sessions it exists to protect, so it injects the cost into the model's context and the model decides.

**Gotchas**

- **After editing anything in `packages/ingest/src`, run `./scripts/autostart.sh`.** Node caches modules, so the long-lived `--watch` ingest keeps running old code and silently overwrites `tokens.json`. `autostart.sh` now recycles it when source is newer than the pidfile, but cron only fires every 10 minutes — so a manual run avoids racing a stale watcher. This bit twice during this session.
- Reconciling with a saved `--ccusage-json` file inflates drift, because `tokens.json` keeps growing while the snapshot doesn't. Re-run ccusage for a true figure.
- `pkill -f "vite --host ... --port 5199"` matches the invoking shell's own command line and kills it. Don't.
- Auditing sessions for `$0` cost: the token fields are flat (`inputTokens`, `cacheReadTokens`, …), not nested under `tokens`. Summing `s.tokens.input` silently yields zero and hides real gaps.

**Resume**

```sh
cd ~/opencode/projects/token-dashboard
npm test
node scripts/reconcile.mjs          # runs ccusage fresh; expect Codex-only drift
./scripts/autostart.sh              # only needed after editing packages/ingest/src
```

## 2026-07-28

#### Handoff — Model attribution reconciles across every tool

**Goal** — Close the one open `Now` item (Codex disagreeing with ccusage on model attribution), then fix whatever that unmasked.

**Done** (all on `main`, tree clean, HEAD `5fe6463`)

- `6842ee4` — **Codex parser, two independent defects.** (1) The model was latched from the FIRST `turn_context` and the whole cumulative counter billed to it; 10 of 40 local rollouts switch models mid-session, which is what put 642M tokens on `gpt-5.6-terra`. Now tracks the active model and emits one session row per model (`__<model>` id suffix only on a split, same rule as `claude.js`). (2) Threads that inherit a conversation — subagent spawns (`source.subagent.thread_spawn`) and resumes — **replay the parent's entire transcript into the new rollout at file-open**, re-stamped with the open timestamp; 787 of 800 token_count events in one real file were the parent's. That billed the parent's history once per child. Anything inside a 2s window from file open is now treated as inherited: counter tracked, not billed.
- `a957230` — **opencode parser + a guard hole.** Two April sessions had a NULL `model` column on the session row, so 31.8M tokens read as `unknown` at $2.02 vs ccusage's $8.24. The model was on every assistant message as `modelID`, so `parseModel` now falls back to the dominant message-level model. Separately, `normalize()` now returns `unknownModelSessions` and ingest warns on it.
- Changelog shipped via `ledger ship` for both (`10307d0`, `84972f3`); BACKLOG `Now` emptied (`83bda6e`, `5fe6463`).

Verified, not assumed:
- `npm test` → 54 ingest + 35 dashboard, 0 failures. Four new regression tests, each written failing first.
- `node scripts/reconcile.mjs` against a **fresh** ccusage run → **all 11 models agree**, no `unknown` row at all. `terra` $3.09 vs $3.09 (was $208), `sol` exact, `deepseek-v4-pro` $8.24 vs $8.24. Total drift **+1.4% → −0.0%**.
- Dashboard HTTP 200 on :5199, ingest watcher alive, `tokens.json` fresh, 0 unknown-model sessions.

**Next** — Nothing is in flight; `Now` is empty. The two `Soon` items are both deliberately parked, and the more interesting one is a question rather than a build: **does the status line (`+$/turn`) actually change behaviour?** If it does, build the burn-rate + 5-hour block panel and the cache-efficiency panel (`rate_limits.five_hour` is already in the statusLine payload, so no new parsing). If it does not, more instrumentation will not help and the answer is structural — shorter sessions, more delegation. Do not build those panels before answering that.

**Decisions** (settled — don't re-litigate)

- Codex usage is the **DELTA of cumulative `total_token_usage`**, not its final value. The delta is what makes per-model attribution possible, and it absorbs repeated token_count emissions that re-report a call without advancing the counter (summing `last_token_usage` instead double-counts those ~3%).
- The replay boundary is **time-based** (2s from file open) rather than lineage-based. Replayed events land in a sub-second burst while a thread's own first call is seconds later; the result is insensitive to the window — 500ms through 5000ms reconcile identically. A lineage/cumulative-key dedupe was tried and **rejected**: sibling subagents forking from the same point produce identical first-call sizes, so they collide and over-dedupe (it under-counted `sol` by 6.5%).
- Unidentified models are counted **separately** from unpriced ones. They are different failures — no rate to add vs. the parser dropped the attribution — and conflating them is what hid the opencode bug.

**Gotchas**

- **`ccusage` is NOT deterministic on Codex.** It dedupes replayed events but its day-attribution is order-dependent: back-to-back runs moved its own totals 239.0M → 234.9M cache-read and shifted tokens between April and today. Compare **per-model totals, not per-day**, and always re-run it alongside our numbers rather than reusing a saved snapshot.
- ccusage now ships as a **compiled native binary** — `src/cli.js` is a 5KB shim and there is no readable JS to consult as a reference implementation. Derive rules from the rollout data and use ccusage only as an oracle.
- The reason the opencode bug survived months: the unpriced-model guard exempts **both** `model === 'unknown'` and any session carrying a cost, and opencode records its own cost — so those sessions hit both exemptions at once. A guard that exempts the "we don't know" case cannot detect attribution failures.
- Still true from the previous session: **after editing anything in `packages/ingest/src`, run `./scripts/autostart.sh`** or the long-lived watcher keeps running old code and overwrites `tokens.json`.

**Resume**

```sh
cd ~/opencode/projects/token-dashboard
npm test                            # expect 54 ingest + 35 dashboard, 0 failures
node scripts/reconcile.mjs          # runs ccusage fresh; expect all models within 2%
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5199/   # expect 200
```

## 2026-08-03

#### Handoff — Cost mix over time panel (Phase A of the habit-trend work)

**Goal** — The dashboard could say *how much* of spend is cache traffic (88.9%) but not whether that number was moving, so an improving habit and a quiet week looked identical. Build a panel showing the `Where the cost goes` breakdown as a trend.

**Done** (all on `main`, tree clean, HEAD `58dd3a9`)

Shipped as a 6-commit branch, fast-forward merged, branch deleted. New files: `src/lib/costMix.js`, `src/lib/costParts.js`, `src/components/CostMixTrend.jsx`, `src/components/ToggleButton.jsx`, plus `formatAxisDollars` in `src/lib/format.js`. **No ingest changes** — the panel reads `session.costParts`, which `normalizer.js` already emits.

The panel: weekly (toggleable daily) cost-weighted share of the four cost components, with a Share/Dollars toggle and a total-cost bar row along the bottom in Share mode. Mounted in `App.jsx` at `delay={265}`, between `CostComposition` and `ActivityHeatmap`, consuming `filtered` so the global DateFilter applies.

Verified, not assumed:
- `npm test` on the merged `main` → **54 ingest + 61 dashboard, 0 failures**. Run personally, not taken from a subagent report.
- Browser-verified personally at :5199 across all three modes: Share (band full height, y-axis 0–100%, 15 weekly bars), Dollars (bars and right axis both unmount, **no layout jump** — grid `x=56 w=707` identical in both modes), Day (97 buckets, 16 dots, no crash). Bar row measured at **24.9%** of plot height, matching the `[0, maxTotal*4]` domain.
- Real-data check reproduces the design-time table: cache% runs 93 → 90 → 93 → 85 → 85 → 90 → 82 across the substantive weeks, with three weeks at $1–$3.

**Next** — **Phase B**, already specced at `docs/superpowers/specs/2026-07-31-cost-mix-over-time-design.md` (Phase B section) and in BACKLOG under Soon. It measures the driver instead of the proxy: context per API call and cost per call. Concretely, the first move is adding an `apiCalls` count to the normalized session by counting usage-bearing assistant events in each parser — `claude.js` (messages carrying `usage`), `opencode.js` (assistant message rows; the session row has only aggregates), `codex.js` (`token_count` events that advance the counter, reusing the existing 2s replay window). Phase B has NOT been brainstormed as its own spec yet; the design doc's Phase B section is an outline with three open questions, not a plan.

**Decisions** (settled — don't re-litigate)

- **Share is cost-weighted per bucket**, never a mean of per-session percentages. Ten sessions are 57% of all spend, so averaging would let a $0.08 subagent session count as much as a $699 one.
- **Weekly is the default bucket**, not daily and not a 7-day rolling window. Daily share is dominated by single sessions; "the week ending here" is harder to reason about and leaves the first six days undefined.
- **Gap buckets carry `null`, not zero.** Recharts breaks a stacked Area on null (`Area.js:482`, `connectNulls` defaults false), which honestly shows a gap; zero would draw the band diving to the floor. A bucket with sessions but exactly $0 also routes to the null contract, keeping its real `sessionCount`.
- **The total-cost bar row is Share-mode only.** It exists to restore the magnitude that normalizing discards; in Dollars mode the stacked height already *is* the total.
- **No tool filter.** Tool mix is a real confound in principle (Codex charges nothing separately for cache writes) but Claude is 95.5% of spend, so no realistic shift can move the line. Revisit only above ~20% Codex.
- **Legend shows a 5th item "Total cost"** despite `legendType="none"` on the `<Bar>` — recharts 2.15.4 does not honour `legendType` when a custom Legend `content` renderer is used. Kept deliberately: the grey bars are otherwise unexplained.

**Gotchas**

- **jsdom reports zero size, so recharts renders no children and chart assertions pass vacuously.** `CostMixTrend.test.jsx` mocks `ResponsiveContainer` to a fixed 800x300 to get real output. `UsageChart.test.jsx` has no such mock, so its two chart assertions are green regardless — logged in BACKLOG. Do not delete that mock thinking it is scaffolding.
- **An isolated bucket renders as an invisible zero-area path.** With nulls on both sides there is no neighbour to form a line segment, and recharts' `hasSinglePoint` fallback (`Area.js:376`) only applies when the *whole series* is one point. `bucketCostMix` therefore flags `isolated` and the Areas dot only those. Fixing this by always setting `dot={true}` would draw ~380 dots in daily mode — the tests deliberately fail under that shortcut.
- **A tick formatter cannot influence recharts' tick generation.** The Share y-axis settles to an uneven `0/30/60/100` and needs an explicit `ticks={...}` to pin it (BACKLOG). Separately, the Share branch of the formatter originally had no rounding where the Dollars branch did, which is how a raw `100.0000001%` reached the browser — that one is fixed.
- Recharts passes the data entry as `payload` to an Area's `dot` render *function* (it does not `cloneElement` a function dot). Destructure `key` out before spreading into a custom dot or React warns.
- Still true: **after editing anything in `packages/ingest/src`, run `./scripts/autostart.sh`** or the long-lived watcher keeps running old code and overwrites `tokens.json`. Phase A did not touch ingest; **Phase B will**, so this bites again.

**Resume**

```sh
cd ~/opencode/projects/token-dashboard
npm test                            # expect 54 ingest + 61 dashboard, 0 failures
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5199/   # expect 200
```

#### Handoff — Session boundary detector: spec + implementation plan

**Goal** — Build the missing *trigger* for `session-checkpoint`, so long sessions get cut automatically at task boundaries instead of relying on the user to notice.

**Done** (design only — no implementation code exists yet)

- `docs/superpowers/specs/2026-08-03-session-boundary-detector-design.md` — approved design (`1d11718`)
- `docs/superpowers/plans/2026-08-03-session-boundary-detector.md` — Phase 1 plan, 8 tasks / 46 steps, TDD throughout, zero placeholders (`4f95362`)
- Verified: `grep` for placeholder patterns returns 0 hits; working tree clean. **No code written, no tests run** — the plan's code blocks are unexecuted.

**Next** — Execute the plan with `superpowers:subagent-driven-development`, one subagent per task, starting at Task 1 (`packages/hooks/lib/bands.mjs` + `test/bands.test.mjs`). The plan is self-contained; it does not need any of this session's analysis context. Task 7 (backtest) is the real gate — it exits 1 unless the thresholds hold against the 72 real transcripts, and the plan says to raise `CTX_ARM_TOKENS` rather than weaken the criteria.

**Decisions** (settled — don't re-litigate)

- **The metric is live context size, not "byte-turns."** Byte-turns (`bytes × turns resident`) was coined mid-analysis and then dropped: it assumes residency lasts to session end, but context is non-monotonic (one session ran 999k → 356k → 948k → 71k → 999k) because of compaction and silent tool-result eviction. `cache_read_input_tokens` prices residency directly with no modelling assumption.
- **ARM 200k / CEILING 300k**, derived from break-even, not chosen for roundness. Session floor is 35,620 tokens, so a boundary costs ~50,525 weighted units and pays back in 3.1 turns at 200k, 1.9 at 300k. An earlier 100k arm was rejected: 7.8-turn payback, and it would arm on most sessions since median peak is 160k.
- **Context comes from the statusline stamp, never from parsing `transcript_path`.** The statusline already receives authoritative `context_window.total_input_tokens` and runs every turn. Transcripts reach 35MB and their format is internal — the docs explicitly warn it changes between releases.
- **Bands key off a monotonic high-water mark.** Banding on instantaneous context was simulated at **8.1 nudges per firing session**.
- **A "continue" verdict does not consume the band.** Otherwise the model can silently disable the mechanism band by band with no record.
- **Subagent cost (32.1% of weighted spend) is explicitly out of scope.** `UserPromptSubmit` never fires inside a subagent. Named as a known limit, not an oversight — and most of that spend is *good* (it keeps bulk out of the main context).
- **Auto-restart (`initialUserMessage`) is Phase 2, not Phase 1.** Copy-paste has one accidental virtue: you glance at the prompt before pasting, so a bad handoff gets caught. Validate handoff quality first.

**Gotchas** (each cost real time to find)

- **`~/.claude/projects/` is NOT a corpus of user sessions.** Of 2,579 `.jsonl` files, **2,498 are `agent-*.jsonl` subagent transcripts** and 8 are journals — only **73** are main sessions. An entire first-pass analysis was computed over the unfiltered set and every threshold came out ~4x wrong. Always filter `basename !~ /^(agent-|journal)/`.
- **The `UserPromptSubmit` payload field is `prompt`, NOT `user_input`.** The published docs page says `user_input` and is wrong. Verified in binary v2.1.220: `hook_event_name:"UserPromptSubmit",prompt:e`. Reading the wrong field yields `undefined` and silently disables the semantic gate. **Treat that docs page as unreliable** — it was wrong about this while being right about `initialUserMessage` (also verified in the binary).
- **"Read then edited" is mostly correct behaviour, not waste.** 633 of 1,170 reads are superseded, but the median gap is **2 entries** and 51.7% are ≤2 — that is mandatory read-before-edit, since `Edit` refuses to run without a prior `Read`. Only a gap of ≥50 entries means anything.
- **Auto-compact will not save you here.** On 1M-context models it fires at ~967k; only 8 of 72 sessions ever reach that, while 29 exceed 200k. The expensive band is entirely unprotected.
- **The last line of a transcript is never a `usage` block** (sampled 40, zero hits), so any transcript-based context read needs a backward scan. Another reason the statusline stamp is the right source.

**Resume**

```sh
cd ~/opencode/projects/token-dashboard
git log --oneline -3                # expect 4f95362 plan, 1d11718 spec
npm test                            # expect ingest + dashboard green (hooks suite does not exist yet)
sed -n '1,60p' docs/superpowers/plans/2026-08-03-session-boundary-detector.md
```
