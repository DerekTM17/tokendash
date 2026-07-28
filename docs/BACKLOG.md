# token-dashboard — Backlog

Open work organized by horizon (Now / Soon / Someday) with `[tag]` for
domain. Markdown checkboxes; edit by hand. Shipped items go to
`CHANGELOG.md`, not here.

## Now

Items we're actively working on or planning to do imminently.
- [ ] **[bug]** opencode parser leaves 2 April sessions at model `unknown` — reconcile (2026-07-28) shows deepseek-v4-pro at ours $6.22 vs ccusage $8.24, with a matching 31.8M tokens/$2.02 sitting under `unknown`. One-to-one swap, so it is model ATTRIBUTION in packages/ingest/src/parsers/opencode.js, not pricing. Only 2 of 27 opencode deepseek sessions are affected (ses_22feaf0e… and ses_230edc28…, both 2026-04-27), so it is likely an early-schema difference in how those rows record the model. Pre-existing — it was masked by the larger Codex drift until that was fixed. Repro: node scripts/reconcile.mjs <!-- added 2026-07-28 -->

## Soon

Items we want to tackle in the near term but aren't started yet.
- [ ] **[perf]** Daily rollups + bounded session list in tokens.json — deferred deliberately 2026-07-26 after measurement: payload is 1.44MB/2391 sessions growing ~600KB/day, but only 109 sessions are >30d, so age-based archiving would drop 4.5% of rows and fix nothing. Transfer cost is already solved (no cache-buster => 304 on unchanged; gzip plugin => 147KB when changed). What remains is browser JSON.parse of the full payload on each change, binding somewhere north of ~10MB (weeks out). Design when needed: ingest emits rollups.daily[] over ALL sessions + a bounded sessions[] (recent window + top-N by cost) + a coverage{} block; aggregates (UsageChart, ActivityHeatmap, Cost/Model/Tool/Project breakdowns, SummaryCards) read rollups, SessionsTable/ExpensiveSessions read the bounded list, older detail lazy-loads from a second file. Do NOT truncate sessions[] before moving those aggregates — they would silently understate. <!-- added 2026-07-26 -->
- [ ] **[feat]** Burn-rate + 5-hour block panel, and a cache-efficiency panel — the natural follow-ons once the status line proves out. Claude Code's statusLine payload already carries rate_limits.five_hour.{used_percentage,resets_at}, so the block data needs no new parsing. Cache efficiency matters because 88% of spend is cache traffic (60% read / 28% write): a per-project read:write ratio answers 'are long sessions amortising their cache writes or just re-reading?'. Hold both until there is evidence the status line changed behaviour — if it did not, more instrumentation will not help and the answer is structural (shorter sessions, more delegation). <!-- added 2026-07-27 -->

## Someday

Latent items captured for future-when-they-bite. Not blocking anything now.

<!-- Suggested tags: bug, feat, perf, tech-debt, docs, ops, security, strategic. Use whatever fits. -->
