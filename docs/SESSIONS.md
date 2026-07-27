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
