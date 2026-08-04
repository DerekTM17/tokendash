# Session boundary detector — design

**Status:** implemented (Phase 1 shipped 2026-08-04; Phases 2–3 not started)
**Date:** 2026-08-03
**Repo:** token-dashboard (`packages/hooks/`)

## Problem

Claude Code re-sends the entire conversation on every turn. Session cost therefore
grows with the square of session length, and the marginal cost of one more turn is
set by how much context is already resident.

`session-checkpoint` (in `~/.claude/skills/`) already solves the *hard* part — writing
a handoff good enough to resume from. It is not the bottleneck. The bottleneck is that
it must be invoked deliberately, which means noticing mid-work that a session has grown
expensive and choosing to interrupt yourself. That noticing is the friction.

**This spec does not add a skill. It adds the missing trigger for the skill that exists.**

## Measured evidence

All figures from 72 real user sessions (31,943 API calls) under `~/.claude/projects/`.

> **Population note.** `~/.claude/projects/` contains 2,579 `.jsonl` files, but 2,498 are
> `agent-*.jsonl` subagent transcripts and 8 are journals. Only **73** are main user
> sessions. An earlier pass over the unfiltered set produced thresholds that were wrong by
> ~4x. Any future analysis must filter `basename !~ /^(agent-|journal)/`.

Cost weights, relative to base input (Opus): fresh input 1.0x, cache write 1.25x
(2x on 1-hour TTL), cache read 0.1x, output 5.0x.

### Where the money is

| context at time of call | share of input cost |
|---|---|
| >= 100k | 97.7% |
| >= 200k | 90.5% |
| >= 300k | 82.5% |
| >= 500k | 62.3% |
| >= 750k | 31.3% |

Peak context per session: p25 27.0k, **p50 160.4k**, p75 529.0k, p90 985.9k, max 999.7k.

Half of all sessions peak above 160k; a quarter run past 529k.

### Cost composition

94.56% of input tokens are cache reads. Cache efficiency is healthy — 17.7 reads per
write — so there is no cache-thrash problem to fix. The problem is volume and residency,
not cache behaviour.

### Break-even

Session floor (system prompt + tools + skill frontmatter + CLAUDE.md + MEMORY.md),
measured as first-call context: **p50 35,620 tokens**, stable over time (36.1k in the
older half of sessions vs 35.6k in the newer half).

A boundary costs `floor x 1.25 + handoff_output x 5.0` ~= **50,525 weighted units**.
Cutting at context `C` saves `(C - floor) x 0.1` units per turn avoided.

| context when cut | turns to pay back |
|---|---|
| 100k | 7.8 |
| **200k** | **3.1** |
| **300k** | **1.9** |
| 500k | 1.1 |

Thresholds are derived from this table, not chosen for roundness.

**Why the shipped thresholds are 325k/450k, not the 200k/300k this table points at.**
The arithmetic above did not change and remains valid — it justifies cutting somewhere
in the 200k–500k range, not one specific pair of numbers. The specific ARM/CEILING pair
came from the backtest gate (Testing, below), run against a live, growing corpus of real
sessions, and that gate pushed the operating point higher than break-even alone
suggests: 200k fired on **41.9%** of real sessions against a <=35% budget. An
intermediate 275k/300k passed at 33.8% when chosen, but the margin was thin and it had
drifted to **36.0%** within hours of ordinary use, no threshold change involved — see
"Gate reproducibility" under Testing. The shipped values, **ARM 325k / CEILING 450k**,
measure 28.0% firing with ~7pp of headroom and widen the arm band from 25k wide to 125k
wide, giving the model's topic-continuity judgment (Component 3) room to matter before
the ceiling makes it moot.

## Why this is not redundant

**Auto-compact does not cover the range where the money goes.** On 1M-context models
auto-compact fires at ~967k tokens. Only **8 of 72 sessions (11.1%) ever reach that
threshold**, while 29 (40.3%) exceed 200k and 18 (25.0%) exceed 500k. Nothing built-in
intervenes in the 200k–967k band, which carries 90.5% of input cost.

**Compaction is not the same as a boundary.** Per Anthropic's prompt-caching docs a
warm-cache `/compact` is cheap, so cost is not the argument against it. The argument is
that compaction preserves a 9-section summary plus the last 4 messages and *silently
drops* `paths:`-scoped rules and nested CLAUDE.md until a matching file is re-read. A
deliberate handoff written at a task boundary is a better artifact than a summary
generated at an arbitrary token threshold.

**There is a quality argument independent of cost.** Anthropic's context-editing
benchmark reports +29% task performance from pruning alone (+39% with the memory tool,
-84% tokens). Anthropic's own best-practices doc states performance degrades as the
window fills. What degrades is *stale, mutually inconsistent* accumulated context —
superseded reads, abandoned approaches, dead tool output. This argues for cutting at
genuine task boundaries and against cutting on token count alone.

**Prior art is thin and the one strong negative signal does not transfer.** Sourcegraph's
Amp shipped a handoff feature and removed it in May 2026 ("compaction made it obsolete").
That reasoning depends on compaction firing in the expensive range; here it does not.
No shipped Claude Code tool detects a task shift in the incoming prompt and proposes a
boundary — existing tools (`cdeust/session-optimizer`, `thepushkarp/handoff`, and
several PreCompact variants) all trigger on token count or an explicit human command.
Anthropic ships a 100k-token summary offer on *resume-after-idle*, never on
*new-task-in-active-session*.

## Non-goals

- **Retrieval / context-packet selection.** Fresh input is 0.09% of token volume and
  ~0.5% of cost. Not worth building.
- **Bash result deduplication.** 0.4% of waste. Not worth building.
- **Automatic clearing.** The decision stays with the user. The system proposes; it never
  clears.
- **Topic detection inside the hook.** Lexical topic matching fails silently in both
  directions. Semantic judgment belongs to the model, which already has the prompt.
- **Subagent context.** 32.1% of weighted cost lives in `agent-*.jsonl` transcripts.
  `UserPromptSubmit` never fires inside a subagent, so this design cannot reach it. That
  is a separate lever (a `PreToolUse` matcher on `Task`) and is explicitly out of scope
  rather than silently uncovered.

## Architecture

Three components. Two are new; one is an existing file gaining two lines.

```
statusline.mjs  --(stamps context_window.used to a file, every turn)-->  .ctx-state
                                                                            |
user submits prompt                                                         v
   |                                                            context-boundary.mjs
   v                                                              (UserPromptSubmit)
Claude Code  <--(additionalContext: numbers + directive)-----------------  |
   |
   | model judges: does this prompt continue the thread?
   |
   +-- continues --> stay silent, answer normally
   |                  (band already consumed when the hook fired — see
   |                  "Band consumption did not ship" under Component 3)
   |
   +-- new task --> write handoff (session-checkpoint)
                    write restart prompt to .restart-prompt
                    tell user to /clear
                                    |
                          user types /clear
                                    v
                    session-restart.mjs (SessionStart, matcher: clear)
                    reads .restart-prompt, emits initialUserMessage, deletes file
                                    v
                          new session resumes automatically
```

### Component 1 — context signal (modify `packages/statusline/statusline.mjs`)

The statusline already receives `context_window.used_percentage` and
`context_window.context_window_size` directly from Claude Code (`statusline.mjs:63-66`).

Add: write `{ tokens, pct, sessionId, ts }` to
`~/.claude/.context-boundary/<session_id>.ctx` on each invocation.

**Rationale.** The obvious alternative — parsing `transcript_path` for the last `usage`
block — was rejected. The largest main transcripts are 35MB; the entry format is
internal and Anthropic's docs explicitly warn that scripts parsing it break on any
release; and the last line of a transcript is never a usage block (sampled 40
transcripts: 0 had usage on the final line), so it requires a backward scan. The
statusline already holds the number, first-party and version-stable. The hook reads a
few bytes.

**Staleness bound.** The statusline runs every turn, so the stamped value is at most one
turn behind. Acceptable — thresholds are not that sharp.

### Component 2 — the detector (new: `packages/hooks/context-boundary.mjs`)

Wired as `UserPromptSubmit` in `~/.claude/settings.json`. Mirrors the conventions of the
existing `read-context-cost.mjs`: reads hook JSON on stdin, writes JSON on stdout,
**always exits 0**.

**Input fields consumed:** `session_id`, `cwd`, `transcript_path`, and `prompt`.

> The incoming prompt arrives as `prompt`, **not** `user_input`. Verified against the
> v2.1.220 binary (`hook_event_name:"UserPromptSubmit",prompt:e`). The published docs
> page says `user_input` and is wrong. Reading the wrong field yields `undefined` and
> silently disables the semantic gate.

**Algorithm:**

1. Read `<session_id>.ctx`. Missing or older than 10 minutes → exit 0 silent.
2. `ctx < ARM` → exit 0 silent. This is the common path and must be fast.
3. Load band state `<session_id>.json`: `{ highWater, firedBands[], lastFiredPrompt, verdicts[] }`.
4. If `ctx < highWater * DROP_RATIO` (0.6), a compaction or eviction occurred → reset
   `highWater` to 0 so it tracks live context again, but **keep** `firedBands` — a band
   fires at most once for the lifetime of a session, never once per compaction epoch.
   See "Compaction does not re-arm" below.
5. `highWater = max(highWater, ctx)`. Compute band from **`highWater`**, not from `ctx`.
6. Band already in `firedBands`, or fewer than 10 prompts since `lastFiredPrompt` → exit 0.
7. Count **stale reads** by scanning the transcript in order, pairing each `Read` with
   the **next** edit to that path — a re-read refreshes the outstanding read, and an
   edit consumes it either way — and counting a path once if that gap is **>= 50
   entries**. Skip `isSidechain` entries. (Rewritten from the original design, which
   paired only the earliest read with the earliest edit per path; that both
   under-counted and over-counted any file touched more than once.)
8. Emit `systemMessage` + `hookSpecificOutput.additionalContext`.

**Bands:** exactly two, keyed off the high-water mark. Below `ARM_TOKENS` nothing
fires. From `ARM_TOKENS` up to (not including) `CEILING_TOKENS` is the arm band.
`CEILING_TOKENS` and above is one terminal ceiling band — there is nothing above it, so
growth past the ceiling can never earn a third nudge. Shipped values: **ARM 325k,
CEILING 450k**. `ARM` and `CEILING` must stay well separated: at `ARM >= CEILING` the
arm band collapses (`bandOf` only ever returns the ceiling band), the soft
"judge whether the topic changed" branch in Component 3 never runs, and every nudge
becomes the unconditional ceiling directive — the entire point of having two bands is
lost.

> **Why only two bands.** This section originally specified a mid band and then one band
> per +100k above the ceiling: ARM (200k), 250k, CEILING (300k), then every +100k. A
> session peaking near 1M crosses nine such bands. High-water marking (below) caps
> nudges at one per band per session, but with ~10 bands that cap bought little: the
> backtest over 74 real sessions measured **7.52 nudges per firing session** against a
> budget of 2.0, because ARM only governs the first two bands of the ladder — no ARM
> value fixed it. Cutting to exactly two terminal bands made the budget structural
> rather than dependent on band count: a session can be nudged at most once for arming
> and once for hitting the ceiling, no matter how large it grows. Measured: **2.88**
> nudges per firing session right after the cut, **1.86** after the compaction fix
> below.

> **Why the high-water mark.** Context is not monotonic — one session measured
> 999k -> 356k -> 948k -> 71k -> 999k. Banding on instantaneous context produced an
> estimated **8.1 nudges per firing session** against the old ~10-band ladder above.
> Banding on the high-water mark caps it at one nudge per band per session — but that
> cap barely mattered against ~10 bands (8.1 -> 7.52, above). It only became decisive
> once the ladder itself was cut to two bands.

> **Compaction does not re-arm.** The original design cleared `firedBands` on a
> high-water drop, on the reasoning that post-compaction context is new context and
> deserves a fresh warning. The backtest falsified it: each compaction epoch granted a
> fresh arm+ceiling pair, so repeatedly-compacting sessions earned up to 7 nudges and the
> corpus averaged 2.88 nudges per firing session against the 2.0 budget. Keeping
> `firedBands` through a drop yields 1.86. **Known cost, accepted, not free:** the
> mechanism goes quiet on repeatedly-compacting sessions — in the measured corpus, 7 of
> the 8 sessions that compact receive no further nudges after their first arm+ceiling
> pair. Phase 2's deferred `PostCompact` hook (Component 4) is the intended principled
> fix: it can re-arm on an exact compaction event instead of inferring one from the
> `DROP_RATIO` heuristic, which cannot tell real compaction apart from ordinary
> tool-result eviction.

> **Why the >= 50-entry gap on stale reads.** Measured across all main transcripts: 633
> of 1,170 reads are followed by an edit to the same path, but the median gap is **2
> entries** and 51.7% have a gap <= 2. That is mandatory read-before-edit, not waste —
> `Edit` refuses to run without a prior `Read`. Counting it would put a meaningless number
> in front of the model and train it to discount the whole directive. A >= 50-entry gap
> cuts the population ~77% and leaves genuinely superseded content.

### Component 3 — the directive

Emitted as `additionalContext`. Text:

> SESSION BOUNDARY CHECK — mechanical trigger, not a user request.
>
> Context is now **{N}k tokens**. Every further turn costs ~**${X}** in cache reads
> alone; the same work in a fresh session costs ~**${Y}**. **{S} files** in context are
> stale copies (read, then edited much later). A boundary pays for itself in **{B}
> turns**.
>
> Before answering, judge silently: does the user's message continue the current thread,
> or start something new?
>
> **If it continues** — say nothing about this. Answer normally.
>
> **If it starts something new, or the current task just finished** —
> 1. Write the handoff FIRST (invoke `session-checkpoint`) and confirm it is on disk.
> 2. Tell the user in one line why now, with the number, and print the restart prompt.
>
> Never do both: do not write a handoff and then also answer the new question in this
> session.

Above CEILING the first clause is replaced with: *raise the boundary now, regardless of
topic continuity.*

**Phase 1 gap versus the architecture diagram above.** Step 2 says "print the restart
prompt," not "write it to disk and tell the user to `/clear`" — Component 4 (the file
write plus the `SessionStart` auto-resume) is Phase 2 and has not shipped, so there is
nothing yet for a written `.restart` file to feed into. When Phase 2 lands, step 2 is
expected to change to match the diagram.

**Two failure modes this text is written against.** (a) The model helpfully checkpoints
*and* answers, leaving the user with a handoff plus 40 more turns on the old context —
hence the explicit prohibition. (b) The model rationalizes "this refines what we just
did" indefinitely, because continuing is helpful and invisible while stopping is
disruptive and visible. The only mitigation that shipped for (b) is the non-semantic
ceiling: past `CEILING_TOKENS` the directive drops the topic-continuity judgment
entirely. Below the ceiling, (b) is **unmitigated** — see "Band consumption did not
ship," next.

**Band consumption did not ship.** The design called for marking a band fired only when
a boundary was actually offered: a "continue" verdict would leave the band unfired so the
next prompt re-evaluates, closing off the silent-rationalization failure mode. That
requires a return channel from the model's judgment back into hook state, and none
exists — `UserPromptSubmit` decides whether to fire *before* the model ever sees the
prompt, so there is nothing for the model to report back to. What shipped
(`context-boundary.mjs`) consumes the band unconditionally at fire time, regardless of
what the model goes on to decide, then pushes a record to `state.verdicts[]`. That field
name is misleading: the record (`{ts, tokens, mode, prompt}`) is identical in shape
whether the model continues or checkpoints — it is a fire log, not a verdict — and
nothing in the codebase reads `verdicts[]` back. The high-severity risk this rule was
meant to close (Risks, below) is therefore live: below the ceiling, a model that
rationalizes "continue" indefinitely faces no consequence.

### Component 4 — the restart (new: `packages/hooks/session-restart.mjs`)

Wired as `SessionStart` with `matcher: "clear"`. Reads
`~/.claude/.context-boundary/*.restart`, emits the contents as
`hookSpecificOutput.initialUserMessage`, then deletes the file.

Effect: `/clear` and the new session starts already working. No clipboard step. This is
the friction the whole design exists to remove, and it is the part `session-checkpoint`
could never do on its own.

Also wired as `PostCompact` (separate entry) to clear `firedBands` — an exact signal,
rather than inferring compaction from a context drop.

**Restart prompt format** (target < 15 lines):

```
Resume <project>: <one-line goal>.
Read docs/SESSIONS.md -> latest "#### Handoff — <title>" for full state.

Next: <the single concrete next action>
Files: <2-4 paths>
Verify: <exact command + expected result>
```

It **points at** the handoff rather than inlining it. A fat restart prompt is a large
early injection, which is the exact pattern this design exists to prevent. The global
`CLAUDE.md` already instructs reading the newest `docs/SESSIONS.md` handoff at session
start, so pointing is sufficient.

Handoff content should carry **in-flight task state** — what is half-done, the next
action, files touched, blockers — and not learnings, which auto-memory already handles.
Structure it by section (intent / files modified / decisions / next steps); evaluation
work on 36,611 production messages found structured, incrementally-merged summaries
outperform regenerate-from-scratch ones, and that file lists specifically need explicit
indexing rather than prose.

## Error handling

Same contract as `read-context-cost.mjs`: every path wrapped, **always exit 0**. A hook
that can break a session is worse than no hook.

| condition | behaviour |
|---|---|
| `.ctx` file missing / stale / unparseable | silent |
| state dir unwritable | silent; worst case a duplicate nudge |
| transcript unreadable | emit without the stale-read count |
| no usage data | silent (never default to 0, which would silently disarm) |
| `usage.iterations[]` present | read `usage.iterations.at(-1) ?? usage` |
| `isSidechain` entries | skipped in all scans |

**State GC.** `~/.claude/.context-boundary/` accumulates one file per session. Sweep
entries older than 7 days on each run. On `--resume` the `session_id` is reused, so
reset `firedBands` whenever observed context is below the lowest fired band.

## Testing

**Unit (vitest, already configured in this repo).** Synthetic fixtures asserting:
arm/silent at boundaries; band hysteresis; the 10-prompt gap; high-water behaviour across
a simulated compaction; `prompt` field read correctly; stale-read gap filter; every
error-handling row above.

**Backtest.** Replay all 72 real main-session transcripts through the detector.
Acceptance criteria:

| criterion | target |
|---|---|
| sessions producing a visible nudge | <= 35% |
| nudges per firing session | <= 2.0 |
| sessions with peak >= 500k that fire | 100% (18 of 72) |
| sessions with peak < 100k that fire | 0 |

If the thresholds cannot hit this on historical data, they are wrong and get tuned before
this ever runs live. Results at the shipped thresholds are in Open questions #1.

> **Gate reproducibility.** The backtest walks the live `~/.claude/projects/`
> directory, which both gains files (new sessions) and grows existing transcripts in
> place as sessions continue. The gate is therefore **not reproducible over time** — at
> 275k/300k it passed at 33.8% when chosen and had drifted to 36.0% (target <=35%)
> within a single day of ordinary use, with no threshold change involved. Pinning or
> snapshotting the corpus before comparing runs is the durable fix and has not been
> done. If a future run fails this gate, the correct response is to investigate the
> corpus — what changed, is the `agent-*`/`journal` population filter still correct, did
> a handful of unusually large sessions land — **not** to loosen the 35% target.

**Live validation.** After two weeks, compare median peak context per session against the
72-session baseline (p50 160.4k, p75 529.0k). The mechanism works if p75 falls
materially. Anthropic's `plugins/session-report` ships `analyze-sessions.mjs` for
before/after instrumentation.

## Phasing

| phase | scope | gate |
|---|---|---|
| **1** | Components 1–3: statusline stamp, detector, directive. Nudge only — no auto-restart. | Backtest criteria pass — **met, 2026-08-04** (Open questions #1) |
| **2** | Component 4: `initialUserMessage` auto-restart + `PostCompact` reset | Phase 1 nudges land at sensible moments for 2 weeks — **not started** |
| **3** | Floor reduction (below) | Phases 1–2 stable — **not started** |

### Phase 3 — floor reduction

The 35.6k floor is 88% of the cost of every boundary. It is *not* growth — it is stable
and structural — and at 3.5% of a 999k session it is irrelevant to marathon cost. It
matters only as the per-cut tax, which makes it a multiplier on this design rather than a
competing problem.

Measured contributors: `CLAUDE.md` 253 tok, `MEMORY.md` ~1,990 tok, and **82 `SKILL.md`
files** whose frontmatter loads every session (~5–8k tok, the largest addressable chunk).
The remainder is system prompt and tool definitions, which are not user-controlled.

Dropping the floor 35.6k -> 25k would improve break-even at 200k from 3.1 turns to 2.1.
Primary lever: prune unused plugins and skills. Requires per-component instrumentation
before acting — the decomposition above is partly inferred, not measured.

## Risks

| risk | severity | mitigation |
|---|---|---|
| Model rationalizes "continue" indefinitely | high | non-semantic ceiling only, and only above `CEILING_TOKENS`; the band-non-consumption / verdict-audit mitigation described here was **never built** ("Band consumption did not ship," Component 3) — below the ceiling this risk is **unmitigated** |
| Handoff loses task-critical state | high | write and verify handoff *before* proposing; every comparable tool surveyed has open issues of exactly this kind |
| Nudge fires mid-task and breaks flow | medium | 325k arm is well above the measured p50 peak (160.4k); semantic gate; 10-prompt gap |
| Statusline stamp goes stale or absent | medium | 10-minute staleness bound, silent on miss |
| Hook payload shape changes across versions | medium | consume only `session_id`, `cwd`, `prompt`; no transcript-format parsing in the hot path |
| `additionalContext` is itself permanently resident | low | ~200 tokens, capped at one per band; the alternative is not measuring at all |

## Open questions

1. ~~Does the 200k arm survive the backtest, or does it need to move to 250k?~~
   Resolved, and the answer was more work than a single move. 200k did not survive —
   against the live corpus it fired on 41.9% of sessions (target <=35%). An intermediate
   275k/300k passed at 33.8% but drifted to 36.0% within hours (see "Gate
   reproducibility" under Testing). Shipped at **ARM 325k / CEILING 450k**, backtest on
   75 main sessions:

   | criterion | target | measured |
   |---|---|---|
   | sessions firing | <= 35% | 21/75 (28.0%) |
   | nudges per firing session | <= 2.0 | 1.86 |
   | peak >= 500k that fire | 100% | 18/18 |
   | peak < 100k that fire | 0 | 0/33 |
   | gate exit code | 0 | 0 |
2. Should a quiet statusline marker show when the detector armed but stayed silent? It
   would give visibility into the mechanism's real behaviour at the cost of some noise.
3. Is the 10-prompt gap right, or should it be time-based?
