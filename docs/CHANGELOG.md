# token-dashboard — Changelog

A record of significant changes. Entries grouped by date (descending,
most recent first). Each covers **What** + **Why**; bigger decisions
also include **Tradeoffs / Alternatives considered**.

Curated, not exhaustive — `git log` has every commit.

## 2026-07-21

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

