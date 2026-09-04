# Analysis Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add driver decomposition (attributing a period-over-period cost change to the factor that caused it) and guarded intervention measurement (did a deliberate change to working practice actually pay off) to TokenDash.

**Architecture:** Ingest gains a user-turn count, which unlocks the identity `Cost = ActiveDays × Turns/ActiveDay × Requests/Turn × Tokens/Request × Price/Token`. All analysis is computed day-sliced from the existing `daily` rows, over turn-capable tools only. The dashboard stays a pure static consumer of `tokens.json`; interventions are declared in a gitignored config that ingest embeds.

**Tech Stack:** Node 20+ ESM, no new runtime dependencies. Ingest tests use `node --test` + `node:assert`. Dashboard is React 19 + Recharts, tested with Vitest + Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-09-03-analysis-layer-design.md` — read it before starting. The plan argues from the spec; where they disagree, the spec wins.

## Global Constraints

- **Node 20+**, ESM only (`"type": "module"`). No new dependencies in any package.
- **No network calls, uploads, or telemetry.** The tool is fully local.
- **A user turn** is an entry where `type === 'user'` AND `isMeta`, `isSidechain`, `isCompactSummary` are all falsy AND content is not a `tool_result` array AND text matches none of `^<command-name>`, `<local-command-stdout>`, `^\[Request interrupted`, `^<system-reminder>`.
- **`Requests/Turn` = (main-thread requests + subagent requests) / main-thread turns.** Corpus baseline: 20,052 + 32,712 over 1,607 = **32.83**.
- **`Tokens/Request` counts all four buckets** — input + output + cacheRead + cacheWrite. This deliberately differs from `PerCallTrend`'s context measure, which excludes output.
- **Subagent rows always carry `userTurns: null`.** So do `codex` and `opencode` rows, and sibling model rows. Never `0`.
- **The coverage floor comes from `coverageWindow(sessions, coverage).start`, NEVER `dataCoverage().start`** — the latter returns `null` on a single-tool machine.
- **Confound / disagreement threshold: 10 percentage points**, configurable, default 10.
- **Intervention windows are multiples of 7 days**, default 14.
- **Invariant `requests / turns >= 1`** per session. Never weaken this test to make a session pass.
- Test commands: `npm test` (all), `node --test packages/ingest/test/<file>` (one ingest file), `npx vitest run --config vitest.config.js -t "<name>"` from `packages/dashboard` (one dashboard test).

---

### Task 1: Turn detection rule

The rule is its own module because it is the single point where a wrong predicate silently corrupts every downstream factor. It must be testable without a transcript on disk.

**Files:**
- Create: `packages/ingest/src/turns.js`
- Test: `packages/ingest/test/turns.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `isUserTurn(entry) -> boolean`, `turnText(entry) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// packages/ingest/test/turns.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isUserTurn, turnText } from '../src/turns.js';

const user = (content, extra = {}) => ({
  type: 'user',
  message: { role: 'user', content },
  ...extra,
});

describe('isUserTurn', () => {
  it('accepts a plain string prompt', () => {
    assert.equal(isUserTurn(user('fix the parser')), true);
  });

  it('accepts an array with a text part', () => {
    assert.equal(isUserTurn(user([{ type: 'text', text: 'fix it' }])), true);
  });

  it('accepts multi-part content with images', () => {
    assert.equal(isUserTurn(user([
      { type: 'text', text: 'what is this' },
      { type: 'image', source: {} },
    ])), true);
  });

  it('rejects non-user entries', () => {
    assert.equal(isUserTurn({ type: 'assistant', message: { role: 'assistant' } }), false);
    assert.equal(isUserTurn({ type: 'attachment' }), false);
    assert.equal(isUserTurn({ type: 'queue-operation' }), false);
  });

  it('rejects tool results, which Claude Code logs as user entries', () => {
    assert.equal(isUserTurn(user([{ type: 'tool_result', content: 'ok' }])), false);
  });

  it('rejects isMeta, isSidechain and isCompactSummary entries', () => {
    assert.equal(isUserTurn(user('x', { isMeta: true })), false);
    assert.equal(isUserTurn(user('x', { isSidechain: true })), false);
    assert.equal(isUserTurn(user('x', { isCompactSummary: true })), false);
  });

  it('rejects the five non-prompt text shapes', () => {
    assert.equal(isUserTurn(user('<command-name>/clear</command-name>')), false);
    assert.equal(isUserTurn(user('<local-command-stdout>out</local-command-stdout>')), false);
    assert.equal(isUserTurn(user('[Request interrupted by user for tool use]')), false);
    assert.equal(isUserTurn(user('<system-reminder>note</system-reminder>')), false);
    assert.equal(isUserTurn(user([{ type: 'text', text: '<command-name>/model</command-name>' }])), false);
  });

  it('tolerates missing or malformed content', () => {
    assert.equal(isUserTurn({ type: 'user' }), false);
    assert.equal(isUserTurn(user(null)), false);
    assert.equal(isUserTurn(user([])), false);
  });
});

describe('turnText', () => {
  it('reads a string body', () => {
    assert.equal(turnText(user('hello')), 'hello');
  });
  it('reads the first text part of an array body', () => {
    assert.equal(turnText(user([{ type: 'image' }, { type: 'text', text: 'hi' }])), 'hi');
  });
  it('returns empty string when there is no text', () => {
    assert.equal(turnText(user([{ type: 'image' }])), '');
    assert.equal(turnText({ type: 'user' }), '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/turns.test.js`
Expected: FAIL — `Cannot find module '../src/turns.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/ingest/src/turns.js
/**
 * What counts as a user turn.
 *
 * Isolated in its own module because a wrong predicate here silently corrupts
 * every factor downstream, and the failure is not loud: counting `type ===
 * 'user'` naively admits 2,112 entries where 1,607 are real turns, because
 * Claude Code logs tool results, system reminders and slash-command echoes as
 * user-role entries. The tell is Requests/Turn landing at 0.72 — below 1, which
 * is structurally impossible.
 *
 * Verified against the full local corpus (116 main transcripts): the naive rule
 * admitted 93 non-prompts (5.5%) that none of `isMeta` alone would have caught —
 * 41 slash-command echoes, 14 local-command-stdout echoes, 14 compaction
 * summaries, 14 interrupt markers, 10 bare system reminders.
 */

/** Text shapes Claude Code writes into user entries that are not prompts. */
const NON_PROMPT = [
  /^<command-name>/,
  /<local-command-stdout>/,
  /^\[Request interrupted/,
  /^<system-reminder>/,
];

/** The entry's prompt text: a string body, or the first `text` part of an
 *  array body. Multi-part content (text + image) is common and real. */
export function turnText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const part = content.find(p => p && p.type === 'text');
    return (part && part.text) || '';
  }
  return '';
}

/**
 * True when this transcript entry is a human turn.
 *
 * `isSidechain` is defensive: there are 0 such entries inside main transcripts
 * today, but older Claude Code versions inlined sidechains rather than writing
 * them to subagents/, and the clause costs nothing.
 */
export function isUserTurn(entry) {
  if (!entry || entry.type !== 'user') return false;
  if (entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false;

  const content = entry.message?.content;
  if (content == null) return false;
  if (Array.isArray(content)) {
    if (content.length === 0) return false;
    if (content[0]?.type === 'tool_result') return false;
  }

  const text = turnText(entry).trim();
  return !NON_PROMPT.some(re => re.test(text));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/turns.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/turns.js packages/ingest/test/turns.test.js
git commit -m "feat(ingest): add the user-turn detection rule

Isolated so a wrong predicate is caught by its own tests. Excludes the five
non-prompt shapes measured in the corpus (slash-command echoes, stdout echoes,
compaction summaries, interrupt markers, bare system reminders) plus meta,
sidechain and tool_result entries."
```

---

### Task 2: Count turns per day in the Claude parser

**Files:**
- Modify: `packages/ingest/src/daily.js` (add `addTurn`)
- Modify: `packages/ingest/src/parsers/claude.js` (`parseTranscriptFile`, `emit`)
- Test: `packages/ingest/test/claude.test.js` (append)

**Interfaces:**
- Consumes: `isUserTurn` from Task 1.
- Produces: session rows carrying `userTurns: number | null`; `dailyTokens` slices carrying a `turns` field. `addTurn(byDay, day) -> slice`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ingest/test/claude.test.js`.

**Fixture shape matters.** `parseClaudeJSON(base)` scans `base` for project
*directories* and reads `.jsonl` files inside them, so a transcript written
directly into `base` is never parsed — verified: a flat fixture yields 0
sessions, a nested one yields 1. Every fixture must write its transcript to
`<base>/proj/<name>.jsonl` and call `parseClaudeJSON(base)`.

`tmpdir`, `assistant` and `usage` do **not** exist in `claude.test.js` — they
live in `perCall.test.js`. Add local copies, matching that file's versions.

```js
const userLine = (ts, content, extra = {}) => JSON.stringify({
  type: 'user',
  timestamp: ts,
  cwd: '/home/test/proj',
  message: { role: 'user', content },
  ...extra,
});

describe('user turns', () => {
  it('counts real prompts and ignores tool results and slash commands', () => {
    const dir = tmpdir('turns-');
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'first prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
      userLine('2026-07-01T10:00:02Z', [{ type: 'tool_result', content: 'ok' }]),
      assistant('b', '2026-07-01T10:00:03Z', usage(10, 100, 0)),
      userLine('2026-07-01T10:00:04Z', '<command-name>/clear</command-name>'),
      userLine('2026-07-02T09:00:00Z', 'second prompt'),
      assistant('c', '2026-07-02T09:00:01Z', usage(10, 100, 0)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    assert.equal(s.userTurns, 2, 'two real prompts');
    assert.equal(s.apiCalls, 3);

    const byDay = Object.fromEntries(s.dailyTokens.map(d => [d.day, d.turns]));
    assert.equal(byDay['2026-07-01'], 1);
    assert.equal(byDay['2026-07-02'], 1);
  });

  it('satisfies the requests-per-turn floor', () => {
    const dir = tmpdir('turns-floor-');
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'prompt'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    assert.ok(s.apiCalls / s.userTurns >= 1,
      'requests/turn below 1 means the rule admitted a non-prompt');
  });

  it('records a turn on a day with no API calls', () => {
    const dir = tmpdir('turns-noc-');
    fs.writeFileSync(path.join(dir, 'sess.jsonl'), [
      userLine('2026-07-01T23:59:00Z', 'late prompt'),
      assistant('a', '2026-07-02T00:00:30Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    const [s] = parseClaudeJSON(dir);
    const d1 = s.dailyTokens.find(d => d.day === '2026-07-01');
    assert.equal(d1.turns, 1);
    assert.equal(d1.calls, 0, 'no call landed on the first day');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/claude.test.js`
Expected: FAIL — `s.userTurns` is `undefined`

- [ ] **Step 3: Write minimal implementation**

In `packages/ingest/src/daily.js`, add below `addDay`:

```js
/** Record a user turn on `day`. Turns are counted in the transcript's line loop
 *  while calls are counted per assistant entry, so a day can legitimately hold
 *  turns with no calls (a prompt at 23:59 answered after midnight) or calls with
 *  no turns (a long tool loop). Both must produce a valid slice. */
export function addTurn(byDay, day) {
  let slice = byDay.get(day);
  if (!slice) {
    slice = { day, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
    byDay.set(day, slice);
  }
  slice.turns = (slice.turns || 0) + 1;
  return slice;
}
```

In `packages/ingest/src/parsers/claude.js`, import the rule and `addTurn`:

```js
import { addDay, addTurn, toDailyTokens } from '../daily.js';
import { isUserTurn } from '../turns.js';
```

Inside `parseTranscriptFile`, declare a buffer beside `usageById`:

```js
  // Turns are found during the line loop, but the dominant model is not known
  // until after it — so buffer turn days here and apply them to the winning
  // model's byDay once the winner is chosen.
  const turnDays = [];
```

In the line loop, immediately after the `entry.cwd` block and **before** the `if (entry.type !== 'assistant') continue;` guard:

```js
    if (isUserTurn(entry)) {
      turnDays.push(entry.timestamp ? entry.timestamp.slice(0, 10) : null);
    }
```

After the `byModel` loop is built, apply the buffered turns to the model with the most calls (ties break on model name, ascending, so the choice is deterministic):

```js
  // Turns belong to the transcript, not to a model — a person typing a prompt
  // is model-agnostic. Putting them on every sibling row would double-count
  // them and halve Requests/Turn, so they go on exactly one row.
  let turnModel = null;
  let bestCalls = -1;
  for (const [model, acc] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (acc.calls > bestCalls) {
      bestCalls = acc.calls;
      turnModel = model;
    }
  }
  let userTurns = 0;
  if (turnModel !== null) {
    const acc = byModel.get(turnModel);
    for (const rawDay of turnDays) {
      userTurns += 1;
      const day = rawDay || fallbackDay;
      if (day) addTurn(acc.byDay, day);
    }
  }

  return { cwd, firstTimestamp, byModel, turnModel, userTurns };
```

(Replace the existing `return { cwd, firstTimestamp, byModel };`.)

In `emit`, set `userTurns` on the winning row only:

```js
          userTurns: (!isSubagent && model === transcript.turnModel)
            ? transcript.userTurns
            : null,
```

Add that property to the pushed session object, immediately after `apiCalls`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/claude.test.js`
Expected: PASS, including the three new tests

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/daily.js packages/ingest/src/parsers/claude.js packages/ingest/test/claude.test.js
git commit -m "feat(ingest): count user turns per day in the Claude parser

Turns buffer during the line loop and apply to the dominant model's byDay
once the winner is known, so a multi-model transcript carries its turn count
on exactly one row. addTurn creates a zeroed slice when a day has turns but
no calls, which happens whenever a prompt is answered after midnight."
```

---

### Task 3: Subagent rows carry null turns

Separate from Task 2 because it is the difference between 32.83 and 11.9 requests per turn, and a reviewer should be able to reject it independently.

**Files:**
- Modify: `packages/ingest/src/parsers/claude.js` (already handled by the `!isSubagent` guard in Task 2 — this task proves it)
- Test: `packages/ingest/test/claude.test.js` (append)

**Interfaces:**
- Consumes: `parseClaudeJSON` from Task 2.
- Produces: no new API. Guarantees `userTurns === null` on every `claude_sub_` row.

- [ ] **Step 1: Write the failing test**

```js
describe('subagent turns', () => {
  it('never counts a dispatch prompt as a user turn', () => {
    // parseClaudeJSON scans base for PROJECT DIRECTORIES and reads .jsonl
    // inside them — a transcript written straight into base is never seen
    // (verified: flat fixture yields 0 sessions, nested yields 1). Subagent
    // transcripts nest under the project dir, not under base.
    const base = tmpdir('subturn-');
    const dir = path.join(base, 'proj');
    const subDir = path.join(dir, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'main.jsonl'), [
      userLine('2026-07-01T10:00:00Z', 'do the thing'),
      assistant('a', '2026-07-01T10:00:01Z', usage(10, 0, 100)),
    ].join('\n') + '\n');

    // A subagent transcript opens with the dispatch prompt: type user,
    // isSidechain true, non-meta, non-tool_result. It passes every
    // content-shaped test and is not a human turn.
    fs.writeFileSync(path.join(subDir, 'agent.jsonl'), [
      userLine('2026-07-01T10:00:02Z', 'Search the codebase for X', { isSidechain: true }),
      assistant('b', '2026-07-01T10:00:03Z', usage(10, 0, 100)),
      assistant('c', '2026-07-01T10:00:04Z', usage(10, 100, 0)),
    ].join('\n') + '\n');

    const sessions = parseClaudeJSON(base);
    const main = sessions.filter(s => !s.isSubagent);
    const subs = sessions.filter(s => s.isSubagent);

    assert.equal(subs.length, 1);
    assert.equal(subs[0].userTurns, null, 'subagent rows carry null, never 0');
    assert.equal(main.reduce((n, s) => n + (s.userTurns || 0), 0), 1);

    // Requests/Turn counts delegated requests in the numerator: a Task dispatch
    // is the most consequential form of tool-call amplification there is.
    const requests = sessions.reduce((n, s) => n + s.apiCalls, 0);
    const turns = sessions.reduce((n, s) => n + (s.userTurns || 0), 0);
    assert.equal(requests / turns, 3);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `node --test packages/ingest/test/claude.test.js`
Expected: **PASS.** This is deliberate. Unlike every other task here, this test
is a characterization/regression guard rather than TDD-red — the behaviour it
locks down is introduced in Task 2, and it is worth 2.75x on the headline
factor, so it earns a test that fails loudly if anyone later drops the
`!isSubagent` clause. Do not treat "passed on first run" as a defect.

**If it FAILS**, Task 2's guard was omitted — add `!isSubagent &&` to the
`userTurns` expression in `emit` before proceeding.

- [ ] **Step 3: Verify against the real corpus**

`AGENTS.md` requires ingest output be checked against actual data, not just fixtures. Run:

```bash
node -e '
const {parseClaudeJSON}=await import("./packages/ingest/src/parsers/claude.js");
const s=parseClaudeJSON();
const turns=s.reduce((n,x)=>n+(x.userTurns||0),0);
const reqs=s.reduce((n,x)=>n+x.apiCalls,0);
const subTurns=s.filter(x=>x.isSubagent).reduce((n,x)=>n+(x.userTurns||0),0);
console.log("turns",turns,"requests",reqs,"req/turn",(reqs/turns).toFixed(2));
console.log("subagent turns (must be 0):",subTurns);
' --input-type=module
```

Expected: turns ≈ 1607, requests ≈ 52764, req/turn ≈ 32.83, subagent turns exactly 0. Numbers drift upward as you use the tool; the ratio should stay in the low 30s and **must never fall below 1**.

- [ ] **Step 4: Commit**

```bash
git add packages/ingest/test/claude.test.js
git commit -m "test(ingest): subagent dispatch prompts are not user turns

2,688 of 2,696 subagent transcripts open with a dispatch prompt that passes
every content-shaped test. Counting them inflated turns from 1,607 to 4,334
and understated amplification 2.75x."
```

---

### Task 4: Emit turns in the daily rows

**Files:**
- Modify: `packages/ingest/src/daily.js` (`DAILY_COLUMNS`)
- Modify: `packages/ingest/src/normalizer.js` (`buildDaily`, session record)
- Test: `packages/ingest/test/perCall.test.js` (extend the existing sum test)

**Interfaces:**
- Consumes: `dailyTokens` slices with `turns` from Task 2.
- Produces: `daily` rows of length 11 with `turns` at index 10; normalized sessions carrying `userTurns: number | null`.

- [ ] **Step 1: Write the failing test**

In `packages/ingest/test/perCall.test.js`, extend the daily-sum test (around line 130) with two assertions:

```js
    assert.equal(sum(10), s.userTurns ?? 0, 'turns');
    assert.equal(s.daily[0].length, DAILY_COLUMNS.length, 'row length matches the contract');
```

Add the import at the top of the file:

```js
import { DAILY_COLUMNS } from '../src/daily.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/perCall.test.js`
Expected: FAIL — `sum(10)` is `NaN` because index 10 does not exist

- [ ] **Step 3: Write minimal implementation**

In `packages/ingest/src/daily.js`, append to `DAILY_COLUMNS`:

```js
  'costCacheWrite',
  'turns',
];
```

In `packages/ingest/src/normalizer.js`, add the column inside `buildDaily`'s returned array, after `round8(parts.cacheWrite)`:

```js
      round8(parts.cacheWrite),
      d.turns || 0,
    ];
```

Immediately before that `return` inside the `.map`, guard the contract:

```js
    // DAILY_COLUMNS enforced nothing until now: buildDaily hand-builds this row
    // and addDay hand-writes the zeroed slice, which is how cacheWrite1h ended
    // up accumulated and priced but absent from the emitted row. Assert the
    // length so a third column-ordering bug cannot hide here.
```

Then add the length check. Do **not** rewrite the `.map` callback — keep its
existing body exactly as it is, including the pricing logic. Only change the
statement that returns it: where the function currently ends with

```js
  return slices.map(d => {
```

...assign that same expression to a local instead, and check the rows before
returning them. Concretely, change the final `return slices.map(d => {` to
`const rows = slices.map(d => {`, leave the entire callback body untouched, and
replace the closing `});` of that statement with:

```js
  });

  for (const row of rows) {
    if (row.length !== DAILY_COLUMNS.length) {
      throw new Error(
        `daily row has ${row.length} columns, DAILY_COLUMNS declares ${DAILY_COLUMNS.length}`
      );
    }
  }
  return rows;
```

Import it at the top of `normalizer.js`:

```js
import { DAILY_COLUMNS } from './daily.js';
```

In the session record returned by `normalize`, add after `apiCalls`:

```js
        userTurns: s.userTurns ?? null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/perCall.test.js && node --test packages/ingest/test/normalizer.test.js`
Expected: PASS. Appending a trailing column breaks none of the seven positional consumers, which all destructure a prefix — that is the reason to append rather than insert.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/daily.js packages/ingest/src/normalizer.js packages/ingest/test/perCall.test.js
git commit -m "feat(ingest): emit turns as daily column 10, and enforce the column contract

DAILY_COLUMNS documented a contract it did not enforce — nothing imported it,
and buildDaily hand-builds the row. cacheWrite1h is the proof: accumulated and
priced, absent from the emitted row. buildDaily now asserts row length."
```

---

### Task 5: Turn capability across tools

**Files:**
- Modify: `packages/ingest/src/parsers/codex.js`, `packages/ingest/src/parsers/opencode.js`
- Modify: `packages/ingest/src/normalizer.js` (export `TURN_CAPABLE_TOOLS`, add `turnCoverage` to totals)
- Test: `packages/ingest/test/normalizer.test.js` (append)

**Interfaces:**
- Consumes: normalized sessions from Task 4.
- Produces: `TURN_CAPABLE_TOOLS: Set<string>`; `totals.turnCoverage = { cost, excludedCost, share }`.

- [ ] **Step 1: Write the failing test**

```js
// packages/ingest/test/normalizer.test.js — append
import { normalize, TURN_CAPABLE_TOOLS } from '../src/normalizer.js';

describe('turn capability', () => {
  it('names claude as the only turn-capable tool', () => {
    assert.ok(TURN_CAPABLE_TOOLS.has('claude'));
    assert.equal(TURN_CAPABLE_TOOLS.has('codex'), false);
    assert.equal(TURN_CAPABLE_TOOLS.has('opencode'), false);
  });

  it('reports null turns for tools that cannot count them, never zero', () => {
    const { normalized } = normalize([
      { id: 'x', tool: 'codex', model: 'gpt-5', startedAt: '2026-07-01T00:00:00Z',
        inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
        apiCalls: 4, dailyTokens: [{ day: '2026-07-01', calls: 4, input: 100, output: 10, cacheRead: 0, cacheWrite: 0 }] },
    ], []);
    assert.strictEqual(normalized[0].userTurns, null,
      'zero would make requests/turn infinite and corrupt mixed-tool aggregates');
  });

  it('reports the share of cost the decomposition can cover', () => {
    const mk = (id, tool, turns) => ({
      id, tool, model: 'claude-opus-5', startedAt: '2026-07-01T00:00:00Z',
      inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      apiCalls: 2, userTurns: turns,
      dailyTokens: [{ day: '2026-07-01', calls: 2, input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, turns: turns || 0 }],
    });
    const { totals } = normalize([mk('a', 'claude', 1), mk('b', 'codex', null)], []);
    assert.ok(totals.turnCoverage.share > 0 && totals.turnCoverage.share < 1);
    assert.ok(totals.turnCoverage.excludedCost > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/normalizer.test.js`
Expected: FAIL — `TURN_CAPABLE_TOOLS` is not exported

- [ ] **Step 3: Write minimal implementation**

In `packages/ingest/src/parsers/codex.js` and `packages/ingest/src/parsers/opencode.js`, add `userTurns: null` to each pushed session object.

In `packages/ingest/src/normalizer.js`:

```js
/** Tools whose transcripts let us identify a human turn. Claude Code is the
 *  only one today. Adding another parser's support is a one-line change here.
 *
 *  This is a FILTER, not a caption: the decomposition is computed over these
 *  tools only. 11 of 81 active days in the corpus mix tools, and on three of
 *  them Codex is ~70% of the day's calls — summing those requests against
 *  Claude-only turns would inflate Requests/Turn by up to 3x on exactly the
 *  days a comparison might land. */
export const TURN_CAPABLE_TOOLS = new Set(['claude']);
```

Add to the `totals` computation:

```js
  const turnCoverage = normalized.reduce(
    (acc, s) => {
      if (TURN_CAPABLE_TOOLS.has(s.tool)) acc.cost += s.cost;
      else acc.excludedCost += s.cost;
      return acc;
    },
    { cost: 0, excludedCost: 0 }
  );
  turnCoverage.share = (turnCoverage.cost + turnCoverage.excludedCost)
    ? turnCoverage.cost / (turnCoverage.cost + turnCoverage.excludedCost)
    : 0;
```

Add `turnCoverage` to the `totals` object returned by `normalize`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/normalizer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/parsers/codex.js packages/ingest/src/parsers/opencode.js packages/ingest/src/normalizer.js packages/ingest/test/normalizer.test.js
git commit -m "feat(ingest): declare turn capability per tool and report its coverage

Turn capability is a filter, not a caption. codex and opencode emit null,
never 0 — a zero makes requests/turn infinite and silently corrupts any
mixed-tool aggregate."
```

---

### Task 6: The coverage floor, fixed

The guard the whole intervention design rests on is inert on a single-tool machine. This task is small and is the highest-severity fix in the plan.

**Files:**
- Modify: `packages/dashboard/src/lib/coverage.js`
- Test: `packages/dashboard/test/coverage.test.js` (append)

**Interfaces:**
- Consumes: `dataCoverage`, `coverageWindow` (existing).
- Produces: `firstCoveredDay(sessions) -> string | null` (a `YYYY-MM-DD` day).

- [ ] **Step 1: Write the failing test**

```js
// packages/dashboard/test/coverage.test.js — append
import { firstCoveredDay, dataCoverage } from '../src/lib/coverage.js';

const day = (d, cost) => [d, 1, 100, 10, 0, 0, cost, 0, 0, 0, 1];

describe('firstCoveredDay', () => {
  it('returns a floor on a single-tool corpus, where dataCoverage returns null', () => {
    const sessions = [
      { id: 'a', tool: 'claude', cost: 1, daily: [day('2026-06-11', 1)] },
      { id: 'b', tool: 'claude', cost: 2, daily: [day('2026-07-01', 2)] },
    ];
    // The trap: nothing predates the dominant tool's first day, so dataCoverage
    // has nothing to report and returns null. A guard keyed off it would have
    // no floor at all — on the one deployment it was written to protect.
    assert.equal(dataCoverage(sessions), null);
    assert.equal(firstCoveredDay(sessions), '2026-06-11');
  });

  it('returns the trimmed start when an earlier tool exists', () => {
    const sessions = [
      { id: 'a', tool: 'opencode', cost: 0.5, daily: [day('2026-04-01', 0.5)] },
      { id: 'b', tool: 'claude', cost: 100, daily: [day('2026-06-11', 100)] },
    ];
    assert.equal(firstCoveredDay(sessions), '2026-06-11');
  });

  it('returns null when there is no data at all', () => {
    assert.equal(firstCoveredDay([]), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js coverage`
Expected: FAIL — `firstCoveredDay is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/dashboard/src/lib/coverage.js — append

/**
 * The first day the record actually covers — the floor every guard must key off.
 *
 * `dataCoverage` answers a different question: "what is being TRIMMED from the
 * charts", so it returns null when there is nothing earlier to trim. On a
 * single-tool machine there never is — and the work deployment is Claude Code
 * only. Verified on the local corpus: filtered to Claude sessions,
 * `dataCoverage()` is null while the real floor is 2026-06-11.
 *
 * A guard keyed off `dataCoverage().start` would therefore have no floor and
 * would silently pass every window, including ones reaching into transcripts
 * the 30-day retention sweep already deleted — re-arming the exact failure
 * `coverageWindow` was written to fix.
 */
export function firstCoveredDay(sessions) {
  const window = coverageWindow(sessions, dataCoverage(sessions));
  return window ? window.start : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/coverage.js packages/dashboard/test/coverage.test.js
git commit -m "fix(coverage): add firstCoveredDay, a floor that survives a single-tool corpus

dataCoverage returns null when no session predates the dominant tool's first
day — exactly the case on a Claude-Code-only machine. Every guard keys off
firstCoveredDay instead."
```

---

### Task 7: Factor extraction over a date window

**Files:**
- Create: `packages/dashboard/src/lib/factors.js`
- Test: `packages/dashboard/test/factors.test.js`

**Interfaces:**
- Consumes: `TURN_CAPABLE_TOOLS` (re-declared locally — the dashboard does not import from ingest).
- Produces: `factorsFor(sessions, from, to) -> { activeDays, turnsPerActiveDay, requestsPerTurn, tokensPerRequest, pricePerToken, cost, turns, requests, tokens, excludedCost } | null`, and `FACTOR_KEYS: string[]`.

- [ ] **Step 1: Write the failing test**

```js
// packages/dashboard/test/factors.test.js
import { describe, it, expect } from 'vitest';
import { factorsFor, FACTOR_KEYS } from '../src/lib/factors.js';

// [day, calls, input, output, cacheRead, cacheWrite, cI, cO, cR, cW, turns]
const row = (d, calls, tokens, cost, turns) =>
  [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];

const claude = (id, rows) => ({ id, tool: 'claude', daily: rows });

describe('factorsFor', () => {
  it('computes the five factors and they multiply back to cost', () => {
    const sessions = [claude('a', [
      row('2026-07-01', 4, 1000, 10, 2),
      row('2026-07-02', 6, 2000, 20, 2),
    ])];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-02');

    expect(f.activeDays).toBe(2);
    expect(f.turns).toBe(4);
    expect(f.requests).toBe(10);
    expect(f.turnsPerActiveDay).toBe(2);
    expect(f.requestsPerTurn).toBe(2.5);
    expect(f.tokensPerRequest).toBe(300);
    expect(f.cost).toBe(30);

    const product = FACTOR_KEYS.reduce((p, k) => p * f[k], 1);
    expect(product).toBeCloseTo(f.cost, 8);
  });

  it('excludes turn-incapable tools and reports what it excluded', () => {
    const sessions = [
      claude('a', [row('2026-07-01', 2, 1000, 10, 1)]),
      { id: 'b', tool: 'codex', daily: [row('2026-07-01', 8, 5000, 40, 0)] },
    ];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-01');
    // Without the filter, requestsPerTurn would be 10 instead of 2 — a 5x
    // inflation from requests that have no matching turn.
    expect(f.requestsPerTurn).toBe(2);
    expect(f.excludedCost).toBe(40);
  });

  it('ignores days outside the window', () => {
    const sessions = [claude('a', [
      row('2026-06-30', 9, 9000, 90, 9),
      row('2026-07-01', 2, 1000, 10, 1),
    ])];
    const f = factorsFor(sessions, '2026-07-01', '2026-07-01');
    expect(f.activeDays).toBe(1);
    expect(f.cost).toBe(10);
  });

  it('returns null when the window has no active days', () => {
    expect(factorsFor([claude('a', [row('2026-07-01', 2, 1000, 10, 1)])],
      '2026-08-01', '2026-08-14')).toBeNull();
  });

  it('does not count a zero-call day as active', () => {
    const sessions = [claude('a', [
      row('2026-07-01', 0, 0, 0, 1),
      row('2026-07-02', 2, 1000, 10, 1),
    ])];
    expect(factorsFor(sessions, '2026-07-01', '2026-07-02').activeDays).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js factors`
Expected: FAIL — cannot resolve `../src/lib/factors.js`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/dashboard/src/lib/factors.js
/**
 * The five factors of the cost identity, over a day window.
 *
 *   Cost = ActiveDays x Turns/ActiveDay x Requests/Turn x Tokens/Request x Price/Token
 *
 * Everything is day-sliced. Assigning whole sessions to their start date would
 * be much simpler and much wronger: only 85 of 2,729 sessions are multi-day, but
 * they carry 76.9% of all cost, so start-date assignment puts three quarters of
 * spend on whichever day a long session happened to begin.
 *
 * `Tokens/Request` counts ALL FOUR buckets — input, output, cacheRead,
 * cacheWrite — because the identity requires Tokens x Price/Token to equal cost,
 * and cost is priced from all four. This deliberately differs from
 * PerCallTrend's context measure, which excludes output. Both panels must name
 * which measure they show.
 */

/** Mirrors ingest's TURN_CAPABLE_TOOLS. The dashboard reads tokens.json and
 *  does not import from the ingest package, so the list is restated here. */
const TURN_CAPABLE = new Set(['claude']);

/** Multiplication order matters for sequential attribution, so it is fixed. */
export const FACTOR_KEYS = [
  'activeDays',
  'turnsPerActiveDay',
  'requestsPerTurn',
  'tokensPerRequest',
  'pricePerToken',
];

export function factorsFor(sessions, from, to) {
  const days = new Set();
  let turns = 0, requests = 0, tokens = 0, cost = 0, excludedCost = 0;

  for (const s of sessions) {
    if (!s.daily?.length) continue;
    const capable = TURN_CAPABLE.has(s.tool);
    for (const [day, calls, input, output, cacheRead, cacheWrite,
      cI, cO, cR, cW, dayTurns] of s.daily) {
      if (day < from || day > to) continue;
      const dayCost = cI + cO + cR + cW;
      if (!capable) {
        excludedCost += dayCost;
        continue;
      }
      if (calls > 0) days.add(day);
      requests += calls;
      turns += dayTurns || 0;
      tokens += input + output + cacheRead + cacheWrite;
      cost += dayCost;
    }
  }

  const activeDays = days.size;
  if (!activeDays || !turns || !requests || !tokens) return null;

  return {
    activeDays,
    turnsPerActiveDay: turns / activeDays,
    requestsPerTurn: requests / turns,
    tokensPerRequest: tokens / requests,
    pricePerToken: cost / tokens,
    cost, turns, requests, tokens, excludedCost,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js factors`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/factors.js packages/dashboard/test/factors.test.js
git commit -m "feat(dashboard): extract the five cost factors over a day window

Day-sliced, over turn-capable tools only, reporting the cost it excluded."
```

---

### Task 8: Sequential and LMDI decomposition

**Files:**
- Create: `packages/dashboard/src/lib/decompose.js`
- Test: `packages/dashboard/test/decompose.test.js`

**Interfaces:**
- Consumes: `FACTOR_KEYS`, factor objects from Task 7.
- Produces: `decompose(before, after) -> { contributions: Record<string, number>, total: number, orderSensitive: boolean, oracleSkipped: boolean }`.

- [ ] **Step 1: Write the failing test**

```js
// packages/dashboard/test/decompose.test.js
import { describe, it, expect } from 'vitest';
import { decompose } from '../src/lib/decompose.js';
import { FACTOR_KEYS } from '../src/lib/factors.js';

const f = (activeDays, turnsPerActiveDay, requestsPerTurn, tokensPerRequest, pricePerToken) => {
  const cost = activeDays * turnsPerActiveDay * requestsPerTurn * tokensPerRequest * pricePerToken;
  return { activeDays, turnsPerActiveDay, requestsPerTurn, tokensPerRequest, pricePerToken, cost };
};

describe('decompose', () => {
  it('contributions sum exactly to the change in cost', () => {
    const before = f(10, 5, 8, 20000, 0.000004);
    const after = f(12, 6, 6, 18000, 0.0000035);
    const { contributions, total } = decompose(before, after);
    const sum = FACTOR_KEYS.reduce((n, k) => n + contributions[k], 0);
    expect(sum).toBeCloseTo(after.cost - before.cost, 8);
    expect(total).toBeCloseTo(after.cost - before.cost, 8);
  });

  it('sums to the delta across 200 randomised inputs', () => {
    const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
    for (let i = 0; i < 200; i++) {
      const a = f(rnd(1, 30), rnd(1, 40), rnd(1, 60), rnd(1000, 60000), rnd(1e-6, 1e-5));
      const b = f(rnd(1, 30), rnd(1, 40), rnd(1, 60), rnd(1000, 60000), rnd(1e-6, 1e-5));
      const { contributions } = decompose(a, b);
      const sum = FACTOR_KEYS.reduce((n, k) => n + contributions[k], 0);
      const delta = b.cost - a.cost;
      expect(Math.abs(sum - delta) / Math.max(Math.abs(delta), 1e-9)).toBeLessThan(1e-9);
    }
  });

  it('agrees with LMDI on an ordinary change', () => {
    const { orderSensitive } = decompose(f(10, 5, 8, 20000, 4e-6), f(11, 5.2, 7.5, 19000, 3.9e-6));
    expect(orderSensitive).toBe(false);
  });

  it('flags order sensitivity when the change is violent', () => {
    const { orderSensitive } = decompose(f(2, 1, 1, 1000, 1e-6), f(40, 60, 90, 90000, 9e-6));
    expect(orderSensitive).toBe(true);
  });

  it('skips the oracle when a factor is zero', () => {
    const before = { ...f(10, 5, 8, 20000, 4e-6), turnsPerActiveDay: 0, cost: 0 };
    const { oracleSkipped, orderSensitive } = decompose(before, f(11, 5, 8, 20000, 4e-6));
    expect(oracleSkipped).toBe(true);
    expect(orderSensitive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js decompose`
Expected: FAIL — cannot resolve `../src/lib/decompose.js`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/dashboard/src/lib/decompose.js
/**
 * Attribute a change in cost to the factor that caused it.
 *
 * Sequential (chained) attribution, the same decomposition Uber published: for
 * factor i, hold the factors to its left at their new values and the factors to
 * its right at their old ones. Contributions sum exactly to the change.
 *
 * That method is order-dependent, which is a real weakness. LMDI (log-mean
 * Divisia) is exact AND order-independent, so it is computed alongside as an
 * ORACLE — not displayed. When the two disagree, the change is too large for
 * order-dependence to be ignored and the panel must say so rather than quietly
 * presenting whichever result it computed first.
 *
 * Sequential is what gets shown: "holding everything else constant, adoption
 * added $340" survives contact with a stakeholder and "log-mean Divisia index"
 * does not.
 */
import { FACTOR_KEYS } from './factors.js';

/** Disagreement threshold, as a share of the total change. */
const DISAGREEMENT = 0.10;

function sequential(before, after) {
  const out = {};
  for (let i = 0; i < FACTOR_KEYS.length; i++) {
    let term = after[FACTOR_KEYS[i]] - before[FACTOR_KEYS[i]];
    for (let j = 0; j < i; j++) term *= after[FACTOR_KEYS[j]];
    for (let j = i + 1; j < FACTOR_KEYS.length; j++) term *= before[FACTOR_KEYS[j]];
    out[FACTOR_KEYS[i]] = term;
  }
  return out;
}

/** Logarithmic mean. L(a,a) = a; undefined if either side is <= 0. */
function logMean(a, b) {
  if (a === b) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

function lmdi(before, after) {
  const L = logMean(after.cost, before.cost);
  const out = {};
  for (const k of FACTOR_KEYS) out[k] = L * Math.log(after[k] / before[k]);
  return out;
}

export function decompose(before, after) {
  const contributions = sequential(before, after);
  const total = after.cost - before.cost;

  // LMDI needs every factor and both costs strictly positive.
  const positive = v => Number.isFinite(v) && v > 0;
  const oracleSkipped = !positive(before.cost) || !positive(after.cost)
    || FACTOR_KEYS.some(k => !positive(before[k]) || !positive(after[k]));

  let orderSensitive = false;
  if (!oracleSkipped) {
    const other = lmdi(before, after);
    const scale = Math.max(Math.abs(total), 1e-9);
    orderSensitive = FACTOR_KEYS.some(k => {
      const gap = Math.abs(contributions[k] - other[k]) / scale;
      const signFlip = Math.sign(contributions[k]) !== Math.sign(other[k])
        && contributions[k] !== 0 && other[k] !== 0;
      return gap > DISAGREEMENT || signFlip;
    });
  }

  return { contributions, total, orderSensitive, oracleSkipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js decompose`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/decompose.js packages/dashboard/test/decompose.test.js
git commit -m "feat(dashboard): sequential cost decomposition with an LMDI oracle

Sequential is displayed because it is explainable and matches the published
method. LMDI is order-independent and is used only to detect when order
dependence has stopped being ignorable."
```

---

### Task 9: Intervention config

**Files:**
- Create: `interventions.example.json`
- Modify: `.gitignore`, `packages/ingest/src/index.js`
- Create: `packages/ingest/src/interventions.js`
- Test: `packages/ingest/test/interventions.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `readInterventions(filePath) -> { entries: Array<{date,label,expect,note,expectedShift}>, warnings: string[] }`. `entries` are embedded into `tokens.json` as a top-level `interventions` array.

- [ ] **Step 1: Write the failing test**

```js
// packages/ingest/test/interventions.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInterventions } from '../src/interventions.js';

function write(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-'));
  const f = path.join(dir, 'interventions.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

describe('readInterventions', () => {
  it('returns an empty list when the file is absent', () => {
    const { entries, warnings } = readInterventions('/nonexistent/interventions.json');
    assert.deepEqual(entries, []);
    assert.deepEqual(warnings, []);
  });

  it('accepts a valid entry', () => {
    const { entries } = readInterventions(write([
      { date: '2026-09-15', label: 'MCP to CLI', expect: 'tokensPerRequest' },
    ]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].expect, 'tokensPerRequest');
  });

  it('warns and skips an unknown expect key, keeping the rest of the file', () => {
    const { entries, warnings } = readInterventions(write([
      { date: '2026-09-15', label: 'bad', expect: 'cacheHitRate' },
      { date: '2026-09-20', label: 'good', expect: 'requestsPerTurn' },
    ]));
    assert.equal(entries.length, 1, 'the valid entry survives');
    assert.equal(entries[0].label, 'good');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cacheHitRate/);
    assert.match(warnings[0], /tokensPerRequest/, 'lists the valid keys');
  });

  it('warns and skips entries missing a date or label', () => {
    const { entries, warnings } = readInterventions(write([
      { label: 'no date', expect: 'activeDays' },
      { date: 'not-a-date', label: 'bad date', expect: 'activeDays' },
    ]));
    assert.equal(entries.length, 0);
    assert.equal(warnings.length, 2);
  });

  it('warns and returns empty on malformed JSON rather than throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-bad-'));
    const f = path.join(dir, 'interventions.json');
    fs.writeFileSync(f, '{ not json');
    const { entries, warnings } = readInterventions(f);
    assert.deepEqual(entries, []);
    assert.equal(warnings.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/interventions.test.js`
Expected: FAIL — cannot find `../src/interventions.js`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/ingest/src/interventions.js
/**
 * Read declared interventions.
 *
 * Warns and skips bad entries rather than aborting. `index.js` already warns and
 * continues on unpriced and unidentified models, and aborting here would kill
 * tokens.json regeneration in --watch mode over a typo in an optional file,
 * taking the whole dashboard down for a config error.
 */
import fs from 'node:fs';

export const FACTOR_KEYS = [
  'activeDays',
  'turnsPerActiveDay',
  'requestsPerTurn',
  'tokensPerRequest',
  'pricePerToken',
];

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function readInterventions(filePath) {
  const warnings = [];
  if (!fs.existsSync(filePath)) return { entries: [], warnings };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    warnings.push(`interventions.json is not valid JSON (${e.message}) — ignoring the file.`);
    return { entries: [], warnings };
  }
  if (!Array.isArray(raw)) {
    warnings.push('interventions.json must be an array — ignoring the file.');
    return { entries: [], warnings };
  }

  const entries = [];
  for (const [i, entry] of raw.entries()) {
    const where = `interventions.json[${i}]`;
    if (!entry || typeof entry !== 'object') {
      warnings.push(`${where} is not an object — skipped.`);
      continue;
    }
    if (!isDay(entry.date)) {
      warnings.push(`${where} has no valid YYYY-MM-DD "date" — skipped.`);
      continue;
    }
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      warnings.push(`${where} has no "label" — skipped.`);
      continue;
    }
    if (!FACTOR_KEYS.includes(entry.expect)) {
      warnings.push(
        `${where} has "expect": ${JSON.stringify(entry.expect)}, which is not a factor. ` +
        `Valid keys: ${FACTOR_KEYS.join(', ')} — skipped.`
      );
      continue;
    }
    entries.push({
      date: entry.date,
      label: entry.label,
      expect: entry.expect,
      note: typeof entry.note === 'string' ? entry.note : '',
      // Pre-registered categories exempt from the confound verdict. Cost shares
      // are endogenous: an intervention that scopes subagent dispatches better
      // drops subagent cost share by design, and flagging that would mark every
      // successful intervention confounded.
      expectedShift: Array.isArray(entry.expectedShift) ? entry.expectedShift : [],
    });
  }
  return { entries, warnings };
}
```

Create `interventions.example.json`:

```json
[
  {
    "date": "2026-09-15",
    "label": "Replaced MCP servers with CLI tools",
    "expect": "tokensPerRequest",
    "note": "Removed 4 MCP servers; schema overhead was ~55K tokens/session",
    "expectedShift": []
  }
]
```

Append to `.gitignore`:

```
interventions.json
interventions.results.json
```

In `packages/ingest/src/index.js`, import and wire it. Inside `ingest()`, after the normalize call:

```js
  const { entries: interventions, warnings: interventionWarnings } =
    readInterventions(path.resolve(__dirname, '..', '..', '..', 'interventions.json'));
  for (const w of interventionWarnings) console.error(`WARNING: ${w}`);
```

Add `interventions` to the object written to `tokens.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/interventions.test.js && npm run ingest`
Expected: tests PASS; `npm run ingest` completes and `tokens.json` contains `"interventions": []`

- [ ] **Step 5: Commit**

```bash
git add interventions.example.json .gitignore packages/ingest/src/interventions.js packages/ingest/src/index.js packages/ingest/test/interventions.test.js
git commit -m "feat(ingest): read declared interventions and embed them in tokens.json

Warns and skips bad entries rather than aborting — index.js already warns and
continues, and aborting would kill --watch regeneration over a config typo."
```

---

### Task 10: Intervention guards and verdict

**Files:**
- Create: `packages/dashboard/src/lib/intervention.js`
- Test: `packages/dashboard/test/intervention.test.js`

**Interfaces:**
- Consumes: `factorsFor` (Task 7), `decompose` (Task 8), `firstCoveredDay` (Task 6).
- Produces: `evaluate(sessions, intervention, options) -> { verdict, reasons, before, after, contributions, confounds, windows, declared }`. `verdict` is one of `'supported' | 'not-supported' | 'underpowered' | 'confounded' | 'refused' | 'pending' | 'provisional'`.

- [ ] **Step 1: Write the failing test**

```js
// packages/dashboard/test/intervention.test.js
import { describe, it, expect } from 'vitest';
import { evaluate } from '../src/lib/intervention.js';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10), i));
  return out;
};
const claude = (id, rows, extra = {}) => ({ id, tool: 'claude', daily: rows, ...extra });

// 14 days before and 14 after, with tokens/request halving at the boundary.
const corpus = () => [claude('a', [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
])];

const iv = { date: '2026-07-15', label: 'test', expect: 'tokensPerRequest', expectedShift: [] };
const today = '2026-08-20';

describe('evaluate', () => {
  it('supports a real improvement in the declared factor', () => {
    const r = evaluate(corpus(), iv, { today });
    expect(r.verdict).toBe('supported');
    expect(r.before.tokensPerRequest).toBe(2000);
    expect(r.after.tokensPerRequest).toBe(1000);
  });

  it('refuses when the before-window predates coverage', () => {
    const sessions = [claude('a', days('2026-07-10', 24, d => row(d, 10, 20000, 8, 2)))];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('refused');
    expect(r.reasons.join(' ')).toMatch(/coverage/i);
  });

  it('refuses when either side has zero active days', () => {
    const sessions = [claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)))];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('refused');
    expect(r.reasons.join(' ')).toMatch(/no active days/i);
  });

  it('reports pending for a future intervention date', () => {
    const r = evaluate(corpus(), { ...iv, date: '2026-12-01' }, { today });
    expect(r.verdict).toBe('pending');
  });

  it('reports provisional while the after-window is still elapsing', () => {
    const r = evaluate(corpus(), iv, { today: '2026-07-20' });
    expect(r.verdict).toBe('provisional');
  });

  it('labels underpowered when active days fall below the minimum', () => {
    const sessions = [claude('a', [
      ...days('2026-07-01', 14, (d, i) => row(d, i < 2 ? 10 : 0, i < 2 ? 20000 : 0, i < 2 ? 8 : 0, i < 2 ? 2 : 0)),
      ...days('2026-07-16', 14, (d, i) => row(d, i < 2 ? 10 : 0, i < 2 ? 10000 : 0, i < 2 ? 4 : 0, i < 2 ? 2 : 0)),
    ])];
    expect(evaluate(sessions, iv, { today }).verdict).toBe('underpowered');
  });

  it('flags a model-mix shift as a confound', () => {
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { model: 'claude-sonnet-5' }),
    ];
    const r = evaluate(sessions, iv, { today });
    expect(r.verdict).toBe('confounded');
    expect(r.confounds.some(c => c.dimension === 'model')).toBe(true);
  });

  it('does not flag a pre-registered expected shift', () => {
    const sessions = [
      claude('a', days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)), { model: 'claude-opus-5' }),
      claude('b', days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)), { model: 'claude-sonnet-5' }),
    ];
    const r = evaluate(sessions, { ...iv, expectedShift: ['model'] }, { today });
    expect(r.verdict).toBe('supported');
    expect(r.confounds.some(c => c.dimension === 'model' && c.expected)).toBe(true);
  });

  it('lists an overlapping intervention as a confound', () => {
    const r = evaluate(corpus(), iv, {
      today,
      others: [{ date: '2026-07-20', label: 'another change' }],
    });
    expect(r.confounds.some(c => c.dimension === 'intervention')).toBe(true);
  });

  it('rejects a window length that is not a multiple of 7', () => {
    expect(() => evaluate(corpus(), iv, { today, windowDays: 10 })).toThrow(/multiple of 7/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js intervention`
Expected: FAIL — cannot resolve `../src/lib/intervention.js`

- [ ] **Step 3: Write minimal implementation**

```js
// packages/dashboard/src/lib/intervention.js
/**
 * Did a declared change to working practice actually pay off?
 *
 * The purpose is not to detect an improvement. It is to make a claim that
 * survives a skeptic, so this module is mostly guards: a comparison that cannot
 * be trusted is refused rather than qualified.
 */
import { factorsFor } from './factors.js';
import { decompose } from './decompose.js';
import { firstCoveredDay } from './coverage.js';

const DAY = 86400000;
const shift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY)
  .toISOString().slice(0, 10);

const DEFAULTS = { windowDays: 14, minActiveDays: 5, confoundThreshold: 0.10 };

/** Cost share by category, over a day window, for one dimension. */
function shares(sessions, from, to, dimension) {
  const out = {};
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    const key = dimension === 'model' ? (s.model || 'unknown')
      : dimension === 'project' ? (s.project || 'other')
      : dimension === 'subagent' ? (s.isSubagent ? 'subagent' : 'main')
      : 'other';
    for (const [day, , , , , , cI, cO, cR, cW] of s.daily) {
      if (day < from || day > to) continue;
      const c = cI + cO + cR + cW;
      out[key] = (out[key] || 0) + c;
      total += c;
    }
  }
  if (total) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

/** Token-type cost share. The blended Price/Token moves whenever the
 *  cacheRead:input mix moves, so a cache-TTL change registers there as well as
 *  in Tokens/Request. Without this dimension the panel would credit a mix
 *  change to model selection. */
function tokenTypeShares(sessions, from, to) {
  const out = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let total = 0;
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, , , , , , cI, cO, cR, cW] of s.daily) {
      if (day < from || day > to) continue;
      out.input += cI; out.output += cO; out.cacheRead += cR; out.cacheWrite += cW;
      total += cI + cO + cR + cW;
    }
  }
  if (total) for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

function compareShares(before, after, dimension, threshold, expectedShift) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const found = [];
  for (const k of keys) {
    const delta = (after[k] || 0) - (before[k] || 0);
    if (Math.abs(delta) > threshold) {
      found.push({
        dimension, category: k, delta,
        expected: expectedShift.includes(dimension),
      });
    }
  }
  return found;
}

export function evaluate(sessions, intervention, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (opts.windowDays % 7 !== 0) {
    // Mean cost per active day runs $130-141 Mon-Thu against $77 Sun and $85
    // Sat, a 1.8x spread. A window that is not whole weeks compares different
    // day-of-week mixes and manufactures a difference.
    throw new Error(`windowDays must be a multiple of 7 (got ${opts.windowDays})`);
  }

  const n = opts.windowDays;
  const date = intervention.date;
  const windows = {
    beforeFrom: shift(date, -n), beforeTo: shift(date, -1),
    afterFrom: shift(date, 1), afterTo: shift(date, n),
  };
  const reasons = [];
  const base = { windows, declared: intervention.expect, reasons, confounds: [] };

  if (date > opts.today) {
    return { ...base, verdict: 'pending', reasons: ['The intervention date is in the future.'] };
  }

  const floor = firstCoveredDay(sessions);
  if (!floor || windows.beforeFrom < floor) {
    reasons.push(
      `The before-window starts ${windows.beforeFrom}, but coverage begins ${floor || 'nowhere'}. ` +
      `Transcripts before that were deleted by the 30-day retention sweep, so the baseline ` +
      `would read artificially cheap and manufacture an improvement.`
    );
    return { ...base, verdict: 'refused' };
  }

  const before = factorsFor(sessions, windows.beforeFrom, windows.beforeTo);
  const after = factorsFor(sessions, windows.afterFrom, windows.afterTo);
  if (!before || !after) {
    reasons.push('One side of the comparison has no active days, so there is nothing to compare.');
    return { ...base, verdict: 'refused' };
  }

  const confounds = [
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'model'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'model'),
      'model', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'project'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'project'),
      'project', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      shares(sessions, windows.beforeFrom, windows.beforeTo, 'subagent'),
      shares(sessions, windows.afterFrom, windows.afterTo, 'subagent'),
      'subagent', opts.confoundThreshold, intervention.expectedShift || []),
    ...compareShares(
      tokenTypeShares(sessions, windows.beforeFrom, windows.beforeTo),
      tokenTypeShares(sessions, windows.afterFrom, windows.afterTo),
      'tokenType', opts.confoundThreshold, intervention.expectedShift || []),
  ];

  for (const other of opts.others || []) {
    if (other.date === date) continue;
    if (other.date >= windows.beforeFrom && other.date <= windows.afterTo) {
      confounds.push({
        dimension: 'intervention', category: other.label,
        delta: 0, expected: false,
      });
    }
  }

  const { contributions, total, orderSensitive, oracleSkipped } = decompose(before, after);
  const result = { ...base, before, after, contributions, total, confounds, orderSensitive, oracleSkipped };

  if (before.activeDays < opts.minActiveDays || after.activeDays < opts.minActiveDays) {
    reasons.push(
      `Only ${before.activeDays} active days before and ${after.activeDays} after, ` +
      `below the ${opts.minActiveDays}-day minimum. Watch it accumulate.`
    );
    return { ...result, verdict: 'underpowered' };
  }

  const unexpected = confounds.filter(c => !c.expected);
  if (unexpected.length) {
    reasons.push(
      `Something other than the intervention moved: ` +
      unexpected.map(c => `${c.dimension}/${c.category}`).join(', ') + '.'
    );
    return { ...result, verdict: 'confounded' };
  }

  if (windows.afterTo > opts.today) {
    const remaining = Math.round((Date.parse(windows.afterTo) - Date.parse(opts.today)) / DAY);
    reasons.push(`The after-window has ${remaining} day(s) left to run.`);
    return { ...result, verdict: 'provisional' };
  }

  const moved = after[intervention.expect] < before[intervention.expect];
  reasons.push(moved
    ? `${intervention.expect} fell from ${before[intervention.expect]} to ${after[intervention.expect]}.`
    : `${intervention.expect} did not fall.`);
  return { ...result, verdict: moved ? 'supported' : 'not-supported' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js intervention`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/intervention.js packages/dashboard/test/intervention.test.js
git commit -m "feat(dashboard): guarded intervention evaluation

Coverage, maturity, power (in active days, not calendar days), confounds
across four dimensions including token-type mix, and overlapping
interventions. A comparison that cannot be trusted is refused, not qualified."
```

---

### Task 11: Driver decomposition panel

**Files:**
- Create: `packages/dashboard/src/components/DriverDecomposition.jsx`
- Modify: `packages/dashboard/src/lib/glossary.js`, `packages/dashboard/src/App.jsx`
- Test: `packages/dashboard/test/DriverDecomposition.test.jsx`

**Interfaces:**
- Consumes: `factorsFor`, `decompose`, `FACTOR_KEYS`.
- Produces: `<DriverDecomposition sessions={...} delay={number} />`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/dashboard/test/DriverDecomposition.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DriverDecomposition from '../src/components/DriverDecomposition.jsx';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10)));
  return out;
};

const sessions = [{ id: 'a', tool: 'claude', daily: [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
] }];

describe('DriverDecomposition', () => {
  it('names every factor', () => {
    render(<DriverDecomposition sessions={sessions} delay={0} />);
    for (const label of ['Active days', 'Turns per active day', 'Requests per turn',
      'Tokens per request', 'Price per token']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders an explanatory message rather than a chart when a period is empty', () => {
    render(<DriverDecomposition sessions={[]} delay={0} />);
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });

  it('warns when the attribution is order-sensitive', () => {
    const violent = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 1, 1000, 0.01, 1)),
      ...days('2026-07-16', 14, d => row(d, 90, 900000, 90, 60)),
    ] }];
    render(<DriverDecomposition sessions={violent} delay={0} />);
    expect(screen.getByText(/order/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js DriverDecomposition`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Write minimal implementation**

Add to `packages/dashboard/src/lib/glossary.js`, following the house style (say what the number IS first, then why it matters):

```js
  'active days': {
    title: 'Active days',
    body: 'Days on which any API call was recorded. Used instead of "sessions" because most spend lives in sessions that span several days — 85 multi-day sessions carry 77% of all cost here — so counting whole sessions on their start date would pile three quarters of the bill onto whichever day each long one began.',
  },
  'turns per active day': {
    title: 'Turns per active day',
    body: 'How many prompts you sent on a typical working day. This is an engagement measure: it goes up when you use the tool more, not when it becomes less efficient.',
  },
  'requests per turn': {
    title: 'Requests per turn',
    body: 'How many API calls one prompt of yours sets off. One turn typically triggers many, because every tool call is another round trip, and a dispatched subagent brings a whole second conversation with it. This is the number that falls when tool calls are batched or MCP servers are swapped for CLI tools.',
  },
  'tokens per request': {
    title: 'Tokens per request',
    body: 'The average size of a single API call, counting everything billed: fresh input, output, and cache traffic both read and written. Note this is larger than the figure on the Per API call panel, which shows only the context handed to the model and leaves out what came back.',
  },
  'price per token': {
    title: 'Price per token',
    body: 'What a token costs on average across everything you ran. It moves when you switch models, but also when the mix of token types shifts — a cache read costs a tenth of fresh input, so reading more from cache pulls this number down without any model change.',
  },
  'driver decomposition': {
    title: 'Driver decomposition',
    body: 'Splits a change in spend between the five things that can cause it, so a bigger bill can be traced to using the tool more, sending bigger prompts, or paying a higher rate. Each factor is measured holding the others still, and the five contributions add up to the total change exactly.',
  },
```

**Styling — follow the house pattern, not the sketch below's class names.**
This project styles components with inline styles over CSS custom properties,
wrapped in an `animate-in` div. Open `packages/dashboard/src/components/CostMixTrend.jsx`
and mirror its outer structure exactly: the `<div className="animate-in"
style={{ animationDelay }}>` wrapper, the card `<div>` using
`var(--color-card)`, `var(--color-border)`, and the uppercase display heading
using `var(--f-display)` and `var(--cyan)`. The class names `panel`, `muted` and
`warn` used below are shorthand for "the house equivalent" — they do not exist
in `index.css` and must not be introduced.

```jsx
// packages/dashboard/src/components/DriverDecomposition.jsx
import { useMemo } from 'react';
import { factorsFor, FACTOR_KEYS } from '../lib/factors.js';
import { decompose } from '../lib/decompose.js';
import { formatCost } from '../lib/format.js';
import InfoTip from './InfoTip.jsx';

const LABELS = {
  activeDays: 'Active days',
  turnsPerActiveDay: 'Turns per active day',
  requestsPerTurn: 'Requests per turn',
  tokensPerRequest: 'Tokens per request',
  pricePerToken: 'Price per token',
};
const TERMS = {
  activeDays: 'active days',
  turnsPerActiveDay: 'turns per active day',
  requestsPerTurn: 'requests per turn',
  tokensPerRequest: 'tokens per request',
  pricePerToken: 'price per token',
};

/** Split the covered span in half and compare the halves. */
function halves(sessions) {
  const days = new Set();
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, calls] of s.daily) if (calls > 0) days.add(day);
  }
  const sorted = [...days].sort();
  if (sorted.length < 4) return null;
  const mid = Math.floor(sorted.length / 2);
  return {
    beforeFrom: sorted[0], beforeTo: sorted[mid - 1],
    afterFrom: sorted[mid], afterTo: sorted[sorted.length - 1],
  };
}

export default function DriverDecomposition({ sessions, delay = 0 }) {
  const result = useMemo(() => {
    const w = halves(sessions);
    if (!w) return null;
    const before = factorsFor(sessions, w.beforeFrom, w.beforeTo);
    const after = factorsFor(sessions, w.afterFrom, w.afterTo);
    if (!before || !after) return null;
    return { w, before, after, ...decompose(before, after) };
  }, [sessions]);

  return (
    <section className="panel" style={{ animationDelay: `${delay}ms` }}>
      <h2>
        Why the bill moved
        <InfoTip term="driver decomposition" />
      </h2>

      {!result ? (
        <p className="muted">Not enough data yet — this needs at least four active days.</p>
      ) : (
        <>
          <p className="muted">
            {result.w.beforeFrom}–{result.w.beforeTo} compared with {result.w.afterFrom}–{result.w.afterTo}.
            Total change {formatCost(result.total)}.
          </p>

          {result.orderSensitive && (
            <p className="warn">
              These periods differ too much for the attribution order to be ignored:
              a different factor order would tell a different story. Treat the split
              between factors as indicative, not exact — the total is still right.
            </p>
          )}

          <table>
            <thead>
              <tr><th>Factor</th><th>Before</th><th>After</th><th>Contribution</th></tr>
            </thead>
            <tbody>
              {FACTOR_KEYS.map(k => (
                <tr key={k}>
                  <td>{LABELS[k]}<InfoTip term={TERMS[k]} /></td>
                  <td>{result.before[k].toPrecision(4)}</td>
                  <td>{result.after[k].toPrecision(4)}</td>
                  <td>{formatCost(result.contributions[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.before.excludedCost + result.after.excludedCost > 0 && (
            <p className="muted">
              {formatCost(result.before.excludedCost + result.after.excludedCost)} excluded:
              only Claude Code records the user turns this breakdown needs.
            </p>
          )}
        </>
      )}
    </section>
  );
}
```

Mount it in `App.jsx` beside the other trend panels:

```jsx
              <DriverDecomposition sessions={filtered} delay={285} />
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js DriverDecomposition && npx vitest run --config vitest.config.js glossary`
Expected: PASS. The glossary test asserts every `term=` prop resolves, so a typo in `TERMS` fails there.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/DriverDecomposition.jsx packages/dashboard/src/lib/glossary.js packages/dashboard/src/App.jsx packages/dashboard/test/DriverDecomposition.test.jsx
git commit -m "feat(dashboard): add the driver decomposition panel"
```

---

### Task 12: Intervention panel

**Files:**
- Create: `packages/dashboard/src/components/InterventionPanel.jsx`
- Modify: `packages/dashboard/src/lib/glossary.js`, `packages/dashboard/src/App.jsx`
- Test: `packages/dashboard/test/InterventionPanel.test.jsx`

**Interfaces:**
- Consumes: `evaluate` from Task 10; `interventions` array from `tokens.json` (Task 9).
- Produces: `<InterventionPanel sessions={...} interventions={...} today={string} delay={number} />`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/dashboard/test/InterventionPanel.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InterventionPanel from '../src/components/InterventionPanel.jsx';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10)));
  return out;
};
const sessions = [{ id: 'a', tool: 'claude', daily: [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
] }];
const iv = [{ date: '2026-07-15', label: 'MCP to CLI', expect: 'tokensPerRequest', note: '', expectedShift: [] }];

describe('InterventionPanel', () => {
  it('shows the verdict and the declared factor', () => {
    render(<InterventionPanel sessions={sessions} interventions={iv} today="2026-08-20" delay={0} />);
    expect(screen.getByText('MCP to CLI')).toBeInTheDocument();
    expect(screen.getByText(/supported/i)).toBeInTheDocument();
  });

  it('explains itself when nothing is declared', () => {
    render(<InterventionPanel sessions={sessions} interventions={[]} today="2026-08-20" delay={0} />);
    expect(screen.getByText(/interventions\.json/i)).toBeInTheDocument();
  });

  it('shows the refusal reason rather than a number', () => {
    render(<InterventionPanel sessions={sessions} today="2026-08-20" delay={0}
      interventions={[{ ...iv[0], date: '2026-07-03' }]} />);
    expect(screen.getByText(/refused/i)).toBeInTheDocument();
    expect(screen.getByText(/coverage/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js InterventionPanel`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Write minimal implementation**

Add to `glossary.js`:

```js
  'intervention': {
    title: 'Intervention',
    body: 'A change to how you work, written down with a date and a prediction before you look at the result. Declaring the prediction in advance is the point: with five factors and two directions there are ten ways to find a flattering story after the fact, so a metric chosen afterwards proves nothing.',
  },
  'verdict': {
    title: 'Verdict',
    body: 'Supported means the factor you predicted moved the way you said. Confounded means something else moved too, so the result cannot be pinned on the change. Underpowered means too few active days to tell. Refused means the comparison could not be made honestly at all — usually because the baseline reaches into transcripts that were deleted.',
  },
```

**Styling:** same house pattern as Task 11 — mirror `CostMixTrend.jsx`'s
wrapper, card and heading. `panel`/`muted`/`warn`/`good` below stand in for the
house equivalents and must not be introduced as real class names.

```jsx
// packages/dashboard/src/components/InterventionPanel.jsx
import { useMemo } from 'react';
import { evaluate } from '../lib/intervention.js';
import InfoTip from './InfoTip.jsx';

const TONE = {
  supported: 'good',
  'not-supported': 'muted',
  provisional: 'muted',
  underpowered: 'muted',
  pending: 'muted',
  confounded: 'warn',
  refused: 'warn',
};

export default function InterventionPanel({ sessions, interventions = [], today, delay = 0 }) {
  const results = useMemo(
    () => interventions.map(iv => ({
      iv,
      result: evaluate(sessions, iv, { today, others: interventions }),
    })),
    [sessions, interventions, today]
  );

  return (
    <section className="panel" style={{ animationDelay: `${delay}ms` }}>
      <h2>
        Did it work?
        <InfoTip term="intervention" />
      </h2>

      {results.length === 0 ? (
        <p className="muted">
          Nothing declared yet. Copy <code>interventions.example.json</code> to
          <code>interventions.json</code>, name a change and the factor you expect
          it to move, then re-run ingest. Declaring the prediction before you look
          is what makes the answer worth anything.
        </p>
      ) : results.map(({ iv, result }) => (
        <article key={iv.date + iv.label}>
          <h3>{iv.label}</h3>
          <p className="muted">{iv.date} — predicted to move {iv.expect}</p>
          <p className={TONE[result.verdict]}>
            <strong>{result.verdict}</strong>
            <InfoTip term="verdict" />
          </p>
          <ul>{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>

          {result.confounds?.length > 0 && (
            <ul>
              {result.confounds.map((c, i) => (
                <li key={i}>
                  {c.dimension}/{c.category}
                  {c.delta ? ` moved ${(c.delta * 100).toFixed(1)} points` : ' overlaps this window'}
                  {c.expected ? ' (pre-registered, not counted against the result)' : ''}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
```

Mount in `App.jsx`, passing the new `tokens.json` field:

```jsx
              <InterventionPanel
                sessions={filtered}
                interventions={data?.interventions || []}
                today={new Date().toISOString().slice(0, 10)}
                delay={290}
              />
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js InterventionPanel && npx vitest run --config vitest.config.js glossary`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/InterventionPanel.jsx packages/dashboard/src/lib/glossary.js packages/dashboard/src/App.jsx packages/dashboard/test/InterventionPanel.test.jsx
git commit -m "feat(dashboard): add the intervention verdict panel"
```

---

### Task 13: Intervention markers on the trend charts

A visible discontinuity in a chart the reader is already looking at does more persuasive work than a table.

**Files:**
- Modify: `packages/dashboard/src/components/PerCallTrend.jsx`, `packages/dashboard/src/components/CostMixTrend.jsx`
- Test: `packages/dashboard/test/PerCallTrend.test.jsx` (append)

**Interfaces:**
- Consumes: `interventions` array.
- Produces: both components accept an optional `interventions` prop.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/dashboard/test/PerCallTrend.test.jsx — append
it('draws a reference line for each intervention in range', () => {
  // This file already mocks ResponsiveContainer to a fixed size, so recharts
  // actually renders. Without that mock jsdom reports zero size, recharts
  // renders no children, and any assertion here would pass vacuously.
  const { container } = render(
    <PerCallTrend sessions={sessions} delay={0}
      interventions={[{ date: '2026-07-15', label: 'MCP to CLI' }]} />
  );
  expect(container.querySelectorAll('.recharts-reference-line').length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js PerCallTrend`
Expected: FAIL — 0 reference lines

- [ ] **Step 3: Write minimal implementation**

In both components, import `ReferenceLine` from `recharts`, accept `interventions = []`, and render inside the chart:

```jsx
      {interventions.map(iv => (
        <ReferenceLine
          key={iv.date + iv.label}
          x={bucketKey(iv.date, granularity)}
          stroke="currentColor"
          strokeDasharray="3 3"
          label={{ value: iv.label, position: 'insideTopRight', fontSize: 11 }}
        />
      ))}
```

`bucketKey` is currently module-private in both `lib/perCall.js` (line 50) and
`lib/costMix.js` (line 21). **Export it from both** and import it into the
matching component — recomputing the bucket in the component would risk drifting
from the key the series actually uses. `granularity` is already component state
in both files.

In `App.jsx`, pass `interventions={data?.interventions || []}` to both.

**Note:** `UsageChart.test.jsx` does not mock `ResponsiveContainer`, so its chart assertions pass vacuously (`BACKLOG` tech-debt item). Do not add marker tests there until that mock is applied.

- [ ] **Step 4: Run test to verify it passes**

Run (from `packages/dashboard`): `npx vitest run --config vitest.config.js PerCallTrend`
Expected: PASS

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm test
git add packages/dashboard/src/components/PerCallTrend.jsx packages/dashboard/src/components/CostMixTrend.jsx packages/dashboard/src/App.jsx packages/dashboard/test/PerCallTrend.test.jsx
git commit -m "feat(dashboard): mark interventions on the per-call and cost-mix trends"
```

---

### Task 14: Persist matured results

A verdict computed today is not stable: transcripts grow in place and the retention sweep advances the coverage floor, so a `supported` result becomes `refused` once its before-window is swept. This is the same non-reproducibility that makes the boundary detector's backtest gate unreliable.

**Files:**
- Modify: `packages/ingest/src/interventions.js` (add `mergeResults`)
- Modify: `packages/ingest/src/index.js`
- Test: `packages/ingest/test/interventions.test.js` (append)

**Interfaces:**
- Consumes: `readInterventions` from Task 9.
- Produces: `mergeResults(entries, sidecarPath) -> entries` where a matured entry carries a frozen `result` object read from `interventions.results.json`.

- [ ] **Step 1: Write the failing test**

```js
// packages/ingest/test/interventions.test.js — append
import { mergeResults } from '../src/interventions.js';

describe('mergeResults', () => {
  it('attaches a persisted result to its intervention', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivr-'));
    const sidecar = path.join(dir, 'interventions.results.json');
    fs.writeFileSync(sidecar, JSON.stringify({
      '2026-09-15::MCP to CLI': { verdict: 'supported', frozenAt: '2026-10-01' },
    }));
    const entries = mergeResults(
      [{ date: '2026-09-15', label: 'MCP to CLI', expect: 'tokensPerRequest' }],
      sidecar
    );
    assert.equal(entries[0].result.verdict, 'supported');
    assert.equal(entries[0].result.frozenAt, '2026-10-01');
  });

  it('leaves entries untouched when no sidecar exists', () => {
    const entries = mergeResults(
      [{ date: '2026-09-15', label: 'x', expect: 'activeDays' }],
      '/nonexistent/interventions.results.json'
    );
    assert.equal(entries[0].result, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/ingest/test/interventions.test.js`
Expected: FAIL — `mergeResults` is not exported

- [ ] **Step 3: Write minimal implementation**

```js
// packages/ingest/src/interventions.js — append
/**
 * Attach frozen results to their interventions.
 *
 * A verdict is only computable while its before-window is still on disk. Once
 * the 30-day retention sweep passes that window, the same intervention re-reads
 * as `refused` — the number changes because history was deleted, not because
 * anything about the work changed. Freezing a matured result keeps a record of
 * what was true when it could still be measured.
 *
 * The sidecar is written by the dashboard operator, not by ingest; ingest only
 * carries it through to tokens.json.
 */
export function mergeResults(entries, sidecarPath) {
  if (!fs.existsSync(sidecarPath)) return entries;
  let frozen;
  try {
    frozen = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch {
    return entries;
  }
  return entries.map(e => {
    const result = frozen[`${e.date}::${e.label}`];
    return result ? { ...e, result } : e;
  });
}
```

In `index.js`, wrap the entries before embedding:

```js
  const interventionsWithResults = mergeResults(
    interventions,
    path.resolve(__dirname, '..', '..', '..', 'interventions.results.json')
  );
```

Embed `interventionsWithResults` as `interventions` in `tokens.json`.

In `InterventionPanel.jsx`, prefer the frozen result when present:

```js
      result: iv.result || evaluate(sessions, iv, { today, others: interventions }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/ingest/test/interventions.test.js && npm test`
Expected: PASS, whole suite green

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/interventions.js packages/ingest/src/index.js packages/ingest/test/interventions.test.js packages/dashboard/src/components/InterventionPanel.jsx
git commit -m "feat: freeze matured intervention results against the retention sweep

A supported verdict becomes refused once its before-window is swept — the
number changes because history was deleted, not because the work changed."
```

---

### Task 15: Documentation and verification against real data

**Files:**
- Modify: `README.md`, `AGENTS.md`, `docs/BACKLOG.md`, `docs/CHANGELOG.md`

- [ ] **Step 1: Verify ingest output against the real corpus**

`AGENTS.md` requires this: a passing suite is not proof the parsers are right.

```bash
npm run ingest
node -e '
const d=JSON.parse(require("fs").readFileSync("packages/dashboard/public/tokens.json","utf8"));
const s=d.sessions||d;
const turns=s.reduce((n,x)=>n+(x.userTurns||0),0);
const reqs=s.reduce((n,x)=>n+x.apiCalls,0);
console.log("turns",turns,"requests",reqs,"req/turn",(reqs/turns).toFixed(2));
console.log("subagent turns (must be 0):",s.filter(x=>x.isSubagent).reduce((n,x)=>n+(x.userTurns||0),0));
console.log("turnCoverage share:",(d.totals?.turnCoverage?.share ?? 0).toFixed(3));
const bad=s.filter(x=>x.userTurns>0 && x.apiCalls/x.userTurns<1);
console.log("sessions breaching requests/turn >= 1:",bad.length);
'
```

Expected: req/turn in the low 30s; subagent turns exactly 0; **zero** sessions breaching the floor. A breach means the turn rule admitted a non-prompt — fix the rule, never the assertion.

- [ ] **Step 2: Document the two panels in the README**

Add a section after "Two things worth knowing about the numbers" explaining driver decomposition and interventions, including that `interventions.json` is gitignored and that `expect` must be declared before looking.

- [ ] **Step 3: Note the definitional split in AGENTS.md**

Record that `Tokens/Request` (all four buckets, decomposition) and per-call context (three buckets, `PerCallTrend`) are deliberately different measures, so a future reader does not "fix" one to match the other.

- [ ] **Step 4: Update BACKLOG and CHANGELOG**

Tick the Analysis layer item. Add a follow-up: **use `~/.claude/history.jsonl` as a direct deletion detector** — it survives the retention sweep and records prompts per day, so any day with history prompts but zero ingested turns proves deletion rather than inferring it. That would turn the coverage guard from a proxy into a measurement. Deliberately out of scope here to avoid a new data source mid-build.

Capture the CHANGELOG entry with `ledger ship` if available, per project convention.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md docs/BACKLOG.md docs/CHANGELOG.md
git commit -m "docs: document driver decomposition and interventions"
```

---

## Self-Review

**Spec coverage.** Section 1 (turn counting) → Tasks 1–5. Section 2 (decomposition) → Tasks 7, 8, 11. Section 3 (intervention) → Tasks 6, 9, 10, 12, 13, 14. Testing section → distributed across every task, with the real-data verification `AGENTS.md` requires in Tasks 3 and 15. Deployment note and the `history.jsonl` follow-up → Task 15.

**Two spec items deliberately deferred, both recorded in Task 15 rather than dropped:**
- The `history.jsonl` deletion detector — a genuine improvement to the coverage guard, but it introduces a new data source and the `coverageWindow` floor is sufficient to close the blocker.
- Variance display (daily series with n, mean, median) is computed in `factorsFor` but not yet rendered per-window in `InterventionPanel`. Add it there if the panel reads thin in use; the guard logic does not depend on it.

**Placeholder scan.** No TBDs, no "add error handling", no "similar to Task N". Every code step carries real code.

**Type consistency.** `FACTOR_KEYS` is defined twice on purpose — `packages/dashboard/src/lib/factors.js` for the dashboard and `packages/ingest/src/interventions.js` for config validation — because the dashboard does not import from ingest. The two lists must stay identical; both are asserted against real config in Task 9's tests. `TURN_CAPABLE_TOOLS` (ingest) and `TURN_CAPABLE` (dashboard) mirror each other for the same reason. `evaluate`, `factorsFor`, `decompose`, `firstCoveredDay`, `readInterventions` and `mergeResults` keep the same signatures everywhere they appear.
