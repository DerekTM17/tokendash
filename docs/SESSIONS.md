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
