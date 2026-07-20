# AGENTS.md — TokenDash

Cross-tool token/cost dashboard. Monorepo: `packages/ingest` (Node CLI → `tokens.json`) and
`packages/dashboard` (React + Vite + Recharts, reads the JSON, no server).

## The cardinal rule: verify ingest output against REAL data — green tests are not proof

This project's whole value is turning real local files into truthful numbers. The failure mode is a
parser that reads the wrong source and emits zeros/garbage while the unit tests — which feed
hand-written props — stay green. **A passing `npm test` tells you nothing about correctness.**

Before claiming any ingest work is done, run it and inspect the output:

```bash
npm run ingest
python3 - <<'PY'
import json
s = json.load(open('packages/dashboard/public/tokens.json'))['sessions']
def z(x): return x['inputTokens']+x['outputTokens']+x['cacheReadTokens']+x['cacheWriteTokens']==0
print('sessions:', len(s),
      '| zero-token:', sum(1 for x in s if z(x)),
      '| unknown-model:', sum(1 for x in s if x['model']=='unknown'),
      "| project=other:", sum(1 for x in s if x['project']=='other'))
PY
```

If most sessions are zero-token, or models are "unknown", or everything is one project bucket —
the parser is wrong, no matter what the test suite says. Fix the source, don't ship the zeros.

## Data sources and their traps (learned the hard way)

- **Claude Code** — DO NOT rely on `~/.claude.json`. Its `projects` map only holds the *single most
  recent* session per project (`lastCost`, `lastSessionId`, `lastTotal*`) — ~6 sessions total, and
  it has no `model` field (real models are in `lastModelUsage` keys). Real per-session history lives
  in transcript JSONLs at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; each assistant line
  has `message.usage` (input/output/cache tokens) and `message.model`. Parse those.
- **opencode** — SQLite at `~/.local/share/opencode/opencode.db`, `session` table. Real usage is in
  columns `cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write`.
  Gotchas: `model` is stored as a JSON string (`{"id":"...","providerID":"..."}`) — extract `.id`;
  `directory` is often just `$HOME`, so the last-path-segment gives a useless project name — prefer
  `session.title` / the `project.worktree` column. Uses `node:sqlite` (Node ≥ 22.5); the DB is in
  WAL mode and may be open by a running opencode — open readonly.
- **Codex** — `~/.codex/history.jsonl` is per-prompt text (`session_id`, `ts`, `text`), NO tokens.
  Real usage is in rollout files `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (token_count events).
  `ts` in history.jsonl is in **seconds** (×1000 for ms is correct). The counters in
  `total_token_usage` OVERLAP: `cached_input_tokens` ⊆ `input_tokens` and
  `reasoning_output_tokens` ⊆ `output_tokens` (`total_tokens` = input + output, verified across
  every live rollout event). Our buckets are disjoint — subtract cached from input, never add
  reasoning to output, or tokens and cost double-count.

## Project discovery

`discoverProjects` must find nested repos, not just direct children of `$HOME` (real projects live
under `~/projects/*` and `~/opencode/projects/*`), but must SKIP hidden dirs — `~/.codex`/`~/.claude`
hold plugin/skill git repos that are tool machinery, not projects. Match cwd→project with a
path-separator boundary, not bare `startsWith` (else `/a/foobar` matches project `/a/foo`).

Sessions launched from `$HOME` (common with Codex) get a content-dominance fallback: the parser
tallies absolute paths in the transcript and the normalizer attributes only on strong evidence
(winner ≥3 refs AND majority-or-3x-runner-up), flagged `projectInferred` so the UI marks it (`~`).
Ties/thin evidence stay "other" — verified correct against real sessions (a cross-project
plugin-install session must NOT get pinned to the project it happened to mention most).

## Conventions

- Define "tokens" ONE way (decide whether cache tokens count) and use it in totals, tables, and
  charts identically. Inconsistency here is a bug.
- Every parser needs an integration test that runs the real parser against a small trimmed real
  fixture and asserts non-zero, correctly-shaped output — not just component tests with fake props.
- Commands: `npm run ingest`, `npm run dev`, `npm run build`, `npm test`.
- Long-running dev server: see `~/AGENTS.md` (use `setsid`/`disown`, verify with curl — `&` alone
  gets killed).
