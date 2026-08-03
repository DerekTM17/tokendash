# token-dashboard — Changelog

A record of significant changes. Entries grouped by date (descending,
most recent first). Each covers **What** + **Why**; bigger decisions
also include **Tradeoffs / Alternatives considered**.

Curated, not exhaustive — `git log` has every commit.

## 2026-08-03

### Session boundary detector — design and Phase 1 plan

**Why:** Long sessions are the dominant cost: 82.5% of input spend occurs above 300k context, and half of all sessions peak above 160k. session-checkpoint already writes good handoffs but must be invoked deliberately, so it fires too rarely. This specs the missing trigger — a UserPromptSubmit hook that reads context from the statusline stamp, applies high-water band logic, and asks the model to judge whether the incoming prompt starts a new task. Thresholds (ARM 200k, CEILING 300k) are derived from break-even against a measured 35.6k session floor, not chosen. Design only; no implementation code yet.

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

