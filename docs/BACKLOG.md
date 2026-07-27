# token-dashboard — Backlog

Open work organized by horizon (Now / Soon / Someday) with `[tag]` for
domain. Markdown checkboxes; edit by hand. Shipped items go to
`CHANGELOG.md`, not here.

## Now

Items we're actively working on or planning to do imminently.

## Soon

Items we want to tackle in the near term but aren't started yet.
- [ ] **[perf]** Daily rollups + bounded session list in tokens.json — deferred deliberately 2026-07-26 after measurement: payload is 1.44MB/2391 sessions growing ~600KB/day, but only 109 sessions are >30d, so age-based archiving would drop 4.5% of rows and fix nothing. Transfer cost is already solved (no cache-buster => 304 on unchanged; gzip plugin => 147KB when changed). What remains is browser JSON.parse of the full payload on each change, binding somewhere north of ~10MB (weeks out). Design when needed: ingest emits rollups.daily[] over ALL sessions + a bounded sessions[] (recent window + top-N by cost) + a coverage{} block; aggregates (UsageChart, ActivityHeatmap, Cost/Model/Tool/Project breakdowns, SummaryCards) read rollups, SessionsTable/ExpensiveSessions read the bounded list, older detail lazy-loads from a second file. Do NOT truncate sessions[] before moving those aggregates — they would silently understate. <!-- added 2026-07-26 -->

## Someday

Latent items captured for future-when-they-bite. Not blocking anything now.

<!-- Suggested tags: bug, feat, perf, tech-debt, docs, ops, security, strategic. Use whatever fits. -->
