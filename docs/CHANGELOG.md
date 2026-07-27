# token-dashboard — Changelog

A record of significant changes. Entries grouped by date (descending,
most recent first). Each covers **What** + **Why**; bigger decisions
also include **Tradeoffs / Alternatives considered**.

Curated, not exhaustive — `git log` has every commit.

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

