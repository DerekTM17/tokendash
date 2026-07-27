# token-dashboard — Backlog

Open work organized by horizon (Now / Soon / Someday) with `[tag]` for
domain. Markdown checkboxes; edit by hand. Shipped items go to
`CHANGELOG.md`, not here.

## Now

Items we're actively working on or planning to do imminently.
- [ ] **[bug]** Codex parser disagrees with ccusage on model attribution — reconcile (2026-07-27) shows every Claude model matching to the cent, but Codex does not: we report gpt-5.6-terra at 642M tokens/$208 where ccusage sees 5.5M/$3.09, and gpt-5.6-sol at $43 where ccusage sees $144. Totals: ours $252 vs ccusage $148 across Codex. Token counts disagree, so this is model ATTRIBUTION in packages/ingest/src/parsers/codex.js, not pricing — likely reading the wrong model field from the rollout, or the session-level model rather than per-turn. ~3.5% of the headline number. Repro: node scripts/reconcile.mjs <!-- added 2026-07-27 -->

## Soon

Items we want to tackle in the near term but aren't started yet.
- [ ] **[perf]** Daily rollups + bounded session list in tokens.json — deferred deliberately 2026-07-26 after measurement: payload is 1.44MB/2391 sessions growing ~600KB/day, but only 109 sessions are >30d, so age-based archiving would drop 4.5% of rows and fix nothing. Transfer cost is already solved (no cache-buster => 304 on unchanged; gzip plugin => 147KB when changed). What remains is browser JSON.parse of the full payload on each change, binding somewhere north of ~10MB (weeks out). Design when needed: ingest emits rollups.daily[] over ALL sessions + a bounded sessions[] (recent window + top-N by cost) + a coverage{} block; aggregates (UsageChart, ActivityHeatmap, Cost/Model/Tool/Project breakdowns, SummaryCards) read rollups, SessionsTable/ExpensiveSessions read the bounded list, older detail lazy-loads from a second file. Do NOT truncate sessions[] before moving those aggregates — they would silently understate. <!-- added 2026-07-26 -->
- [ ] **[feat]** Burn-rate + 5-hour block panel, and a cache-efficiency panel — the natural follow-ons once the status line proves out. Claude Code's statusLine payload already carries rate_limits.five_hour.{used_percentage,resets_at}, so the block data needs no new parsing. Cache efficiency matters because 88% of spend is cache traffic (60% read / 28% write): a per-project read:write ratio answers 'are long sessions amortising their cache writes or just re-reading?'. Hold both until there is evidence the status line changed behaviour — if it did not, more instrumentation will not help and the answer is structural (shorter sessions, more delegation). <!-- added 2026-07-27 -->

## Someday

Latent items captured for future-when-they-bite. Not blocking anything now.

<!-- Suggested tags: bug, feat, perf, tech-debt, docs, ops, security, strategic. Use whatever fits. -->
