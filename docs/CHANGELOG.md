# token-dashboard — Changelog

A record of significant changes. Entries grouped by date (descending,
most recent first). Each covers **What** + **Why**; bigger decisions
also include **Tradeoffs / Alternatives considered**.

Curated, not exhaustive — `git log` has every commit.

## 2026-07-20

### Always-on cron autostart (ingest watcher + Vite on :5199)

**Why:** The dashboard only ran when started by hand, unlike ledger's; a ledger-pattern scripts/autostart.sh (@reboot + 10-min watchdog, HTTP liveness + pidfile checks, nvm node path hardcoded for cron) keeps tokens.json fresh via ingest --watch and the UI always reachable.

