# Session Boundary Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `UserPromptSubmit` hook that detects when a Claude Code session has grown expensive and a new task is starting, and prompts the model to offer a session boundary.

**Architecture:** The statusline already receives authoritative context size from Claude Code each turn; it stamps that to a small per-session file. The hook reads that file (never the 35MB transcript), applies high-water-mark band logic, and injects a directive as `additionalContext`. Pure logic lives in three small `lib/` modules so it is testable without I/O; the hook entry point only orchestrates.

**Tech Stack:** Node 20+ ESM (`.mjs`), `node --test` (matches `packages/ingest`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-session-boundary-detector-design.md`

## Global Constraints

- **Phase 1 only.** Component 4 (`session-restart.mjs`, `initialUserMessage` auto-restart) and Phase 3 (floor reduction) are out of scope for this plan.
- **Hooks must always `exit 0`.** A hook that can break a session is worse than no hook. Every entry point wraps everything in try/catch.
- **No new dependencies.** Node built-ins only.
- **The `UserPromptSubmit` payload field for the user's text is `prompt`, NOT `user_input`.** Verified against binary v2.1.220 (`hook_event_name:"UserPromptSubmit",prompt:e`). The published docs page says `user_input` and is wrong.
- **Never parse `transcript_path` in the hot path.** Only the stale-read counter reads it, and only after the decision to fire has already been made.
- Constants (all env-overridable): `ARM_TOKENS=200000`, `CEILING_TOKENS=300000`, `MIN_PROMPT_GAP=10`, `STALE_GAP_ENTRIES=50`, `FLOOR_TOKENS=35620`, `CTX_MAX_AGE_MS=600000`, `DROP_RATIO=0.6`, `STATE_GC_DAYS=7`.
- **State dir:** `~/.claude/.context-boundary/`
- Cost weights (relative to base input): fresh 1.0, cache write 1.25, cache read 0.1, output 5.0.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/hooks/package.json` | Create — declares ESM + `node --test` script |
| `packages/hooks/lib/bands.mjs` | Create — pure band/threshold/high-water logic. No I/O. |
| `packages/hooks/lib/state.mjs` | Create — read/write/GC the per-session state and `.ctx` stamp files |
| `packages/hooks/lib/stale-reads.mjs` | Create — count superseded reads in a transcript |
| `packages/hooks/lib/directive.mjs` | Create — build the directive text and cost figures. Pure. |
| `packages/hooks/context-boundary.mjs` | Create — `UserPromptSubmit` entry point; orchestrates the above |
| `packages/hooks/test/*.test.mjs` | Create — unit tests per module |
| `packages/hooks/test/backtest.mjs` | Create — replay real transcripts, assert acceptance criteria |
| `packages/statusline/statusline.mjs` | Modify — stamp context to `.ctx` each turn |
| `package.json` | Modify — add hooks tests to the root `test` script |

---

### Task 1: Package scaffold and band logic

Pure functions first: no I/O, so the hardest logic is testable in isolation.

**Files:**
- Create: `packages/hooks/package.json`
- Create: `packages/hooks/lib/bands.mjs`
- Test: `packages/hooks/test/bands.test.mjs`
- Modify: `package.json` (root, line 12 `test` script)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `bandOf(tokens: number) -> number|null` — band id (200, 250, 300, 400, 500…) or `null` below ARM
  - `nextState(prev: State, ctx: number, promptIndex: number) -> {state: State, fire: false|'arm'|'ceiling'}` where `State = {highWater: number, firedBands: number[], lastFiredPrompt: number, verdicts: object[]}`
  - `EMPTY_STATE: State`

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/bands.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, nextState, EMPTY_STATE } from '../lib/bands.mjs';

test('bandOf returns null below ARM', () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(199_999), null);
});

test('bandOf buckets ARM, mid, CEILING, then every 100k', () => {
  assert.equal(bandOf(200_000), 200);
  assert.equal(bandOf(249_999), 200);
  assert.equal(bandOf(250_000), 250);
  assert.equal(bandOf(299_999), 250);
  assert.equal(bandOf(300_000), 300);
  assert.equal(bandOf(399_999), 300);
  assert.equal(bandOf(400_000), 400);
  assert.equal(bandOf(999_999), 900);
});

test('below ARM never fires', () => {
  const r = nextState(EMPTY_STATE, 150_000, 5);
  assert.equal(r.fire, false);
  assert.equal(r.state.highWater, 150_000);
});

test('first crossing of ARM fires as arm', () => {
  const r = nextState(EMPTY_STATE, 210_000, 20);
  assert.equal(r.fire, 'arm');
  assert.deepEqual(r.state.firedBands, [200]);
  assert.equal(r.state.lastFiredPrompt, 20);
});

test('above CEILING fires as ceiling', () => {
  const r = nextState(EMPTY_STATE, 310_000, 20);
  assert.equal(r.fire, 'ceiling');
});

test('same band does not fire twice', () => {
  const a = nextState(EMPTY_STATE, 210_000, 20);
  const b = nextState(a.state, 240_000, 40);
  assert.equal(b.fire, false);
});

test('min prompt gap suppresses an adjacent band', () => {
  const a = nextState(EMPTY_STATE, 210_000, 20);
  const b = nextState(a.state, 260_000, 25); // new band, only 5 prompts later
  assert.equal(b.fire, false);
  assert.deepEqual(b.state.firedBands, [200], 'unfired band is not recorded');
});

test('bands key off high-water, so a modest dip does not re-fire', () => {
  const a = nextState(EMPTY_STATE, 410_000, 10);   // fires band 400
  const b = nextState(a.state, 300_000, 30);       // dip, but above DROP_RATIO -> no reset
  assert.equal(b.fire, false);
  assert.equal(b.state.highWater, 410_000, 'high-water is retained');
  const c = nextState(b.state, 350_000, 50);       // climbs back
  assert.equal(c.fire, false, 'still band 400, already fired');
});

test('a drop past DROP_RATIO resets fired bands', () => {
  const a = nextState(EMPTY_STATE, 410_000, 10);
  const b = nextState(a.state, 200_000, 30);       // 200k < 410k * 0.6 -> reset
  assert.deepEqual(b.state.firedBands, [200]);
  assert.equal(b.state.highWater, 200_000);
  assert.equal(b.fire, 'arm', 'post-compaction climb can fire again');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/bands.test.mjs`
Expected: FAIL — `Cannot find module '../lib/bands.mjs'`

- [ ] **Step 3: Create the package scaffold**

```json
// packages/hooks/package.json
{
  "name": "@token-dashboard/hooks",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs"
  }
}
```

- [ ] **Step 4: Write the implementation**

```javascript
// packages/hooks/lib/bands.mjs
// Pure threshold logic for the session boundary detector. No I/O, no clock.
//
// Bands key off a monotonic HIGH-WATER MARK, not instantaneous context.
// Measured on real sessions, context is not monotonic — one ran
// 999k -> 356k -> 948k -> 71k -> 999k. Banding on instantaneous context
// produced 8.1 nudges per firing session; high-water caps it at one per band.

const num = (name, fallback) => Number(process.env[name] || fallback);

export const ARM_TOKENS = num('CTX_ARM_TOKENS', 200_000);
export const CEILING_TOKENS = num('CTX_CEILING_TOKENS', 300_000);
export const MIN_PROMPT_GAP = num('CTX_MIN_PROMPT_GAP', 10);
export const DROP_RATIO = num('CTX_DROP_RATIO', 0.6);

export const EMPTY_STATE = Object.freeze({
  highWater: 0,
  firedBands: [],
  lastFiredPrompt: -Infinity,
  verdicts: [],
  promptCount: 0,
});

/** Band id for a context size, or null below ARM. */
export function bandOf(tokens) {
  if (!Number.isFinite(tokens) || tokens < ARM_TOKENS) return null;
  if (tokens < (ARM_TOKENS + CEILING_TOKENS) / 2) return Math.floor(ARM_TOKENS / 1000);
  if (tokens < CEILING_TOKENS) return Math.floor(((ARM_TOKENS + CEILING_TOKENS) / 2) / 1000);
  return Math.floor(tokens / 100_000) * 100;
}

/**
 * Advance detector state by one prompt.
 * Returns { state, fire } where fire is false | 'arm' | 'ceiling'.
 *
 * A band is recorded in firedBands ONLY when it actually fires. A suppressed
 * band stays unrecorded so it can fire later once the gap has elapsed.
 */
export function nextState(prev, ctx, promptIndex) {
  const s = {
    highWater: prev.highWater ?? 0,
    firedBands: [...(prev.firedBands ?? [])],
    lastFiredPrompt: prev.lastFiredPrompt ?? -Infinity,
    verdicts: [...(prev.verdicts ?? [])],
    promptCount: prev.promptCount ?? 0, // owned by the caller; preserved, not advanced here
  };

  // A large drop means compaction or tool-result eviction: the old bands no
  // longer describe the live context, so let them fire again.
  if (s.highWater > 0 && ctx < s.highWater * DROP_RATIO) {
    s.highWater = 0;
    s.firedBands = [];
  }

  s.highWater = Math.max(s.highWater, ctx);

  const band = bandOf(s.highWater);
  if (band === null) return { state: s, fire: false };
  if (s.firedBands.includes(band)) return { state: s, fire: false };
  if (promptIndex - s.lastFiredPrompt < MIN_PROMPT_GAP) return { state: s, fire: false };

  s.firedBands.push(band);
  s.lastFiredPrompt = promptIndex;
  return { state: s, fire: s.highWater >= CEILING_TOKENS ? 'ceiling' : 'arm' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/bands.test.mjs`
Expected: PASS — 8 tests

- [ ] **Step 6: Wire hooks tests into the root test script**

In root `package.json`, change the `test` script from:

```
"test": "node --test packages/ingest/test/*.test.js && cd packages/dashboard && npx vitest run"
```

to:

```
"test": "node --test packages/ingest/test/*.test.js && node --test packages/hooks/test/*.test.mjs && cd packages/dashboard && npx vitest run"
```

- [ ] **Step 7: Run the full suite**

Run: `npm test` from the repo root
Expected: PASS — ingest, hooks, and dashboard suites all green

- [ ] **Step 8: Commit**

```bash
git add packages/hooks/package.json packages/hooks/lib/bands.mjs packages/hooks/test/bands.test.mjs package.json
git commit -m "feat(hooks): band and high-water logic for boundary detector"
```

---

### Task 2: State persistence and the context stamp

**Files:**
- Create: `packages/hooks/lib/state.mjs`
- Test: `packages/hooks/test/state.test.mjs`

**Interfaces:**
- Consumes: `EMPTY_STATE` from `lib/bands.mjs`
- Produces:
  - `stateDir() -> string`
  - `readCtx(sessionId) -> {tokens, pct, model, cacheRate, ts}|null` — returns `null` if missing, unparseable, or older than `CTX_MAX_AGE_MS`
  - `writeCtx(sessionId, payload) -> void` — atomic
  - `readState(sessionId) -> State`
  - `writeState(sessionId, state) -> void` — atomic
  - `gcState(maxAgeDays) -> number` — deletes stale files, returns count

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EMPTY_STATE } from '../lib/bands.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-'));
process.env.CTX_STATE_DIR = tmp;
const { readCtx, writeCtx, readState, writeState, gcState } = await import('../lib/state.mjs');

test('readCtx returns null when absent', () => {
  assert.equal(readCtx('nope'), null);
});

test('writeCtx then readCtx round-trips', () => {
  writeCtx('s1', { tokens: 250_000, pct: 25, model: 'claude-opus-5', cacheRate: 0.5 });
  const got = readCtx('s1');
  assert.equal(got.tokens, 250_000);
  assert.equal(got.cacheRate, 0.5);
  assert.ok(got.ts > 0);
});

test('readCtx returns null for a stale stamp', () => {
  writeCtx('s2', { tokens: 250_000, pct: 25, model: 'm', cacheRate: 0.5 });
  const f = path.join(tmp, 's2.ctx');
  const old = JSON.parse(fs.readFileSync(f, 'utf8'));
  old.ts = Date.now() - 60 * 60 * 1000;
  fs.writeFileSync(f, JSON.stringify(old));
  assert.equal(readCtx('s2'), null);
});

test('readCtx returns null on malformed JSON', () => {
  fs.writeFileSync(path.join(tmp, 's3.ctx'), '{not json');
  assert.equal(readCtx('s3'), null);
});

test('readState returns EMPTY_STATE when absent', () => {
  assert.deepEqual(readState('fresh'), EMPTY_STATE);
});

test('writeState then readState round-trips', () => {
  writeState('s4', { highWater: 400_000, firedBands: [200, 300], lastFiredPrompt: 12, verdicts: [], promptCount: 41 });
  const got = readState('s4');
  assert.equal(got.highWater, 400_000);
  assert.deepEqual(got.firedBands, [200, 300]);
  assert.equal(got.promptCount, 41, 'promptCount must survive — MIN_PROMPT_GAP depends on it');
});

test('gcState removes files older than the cutoff and keeps fresh ones', () => {
  writeState('old', EMPTY_STATE);
  const f = path.join(tmp, 'old.json');
  const past = Date.now() - 30 * 24 * 60 * 60 * 1000;
  fs.utimesSync(f, past / 1000, past / 1000);
  writeState('new', EMPTY_STATE);
  const removed = gcState(7);
  assert.ok(removed >= 1);
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.existsSync(path.join(tmp, 'new.json')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/state.test.mjs`
Expected: FAIL — `Cannot find module '../lib/state.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// packages/hooks/lib/state.mjs
// Persistence for the boundary detector. Two file kinds per session:
//   <id>.ctx   written by the statusline every turn: authoritative context size
//   <id>.json  written by the hook: high-water mark, fired bands, verdicts
//
// Writes are temp+rename so a concurrent reader never sees a partial file.
// Every function is total: on any failure it degrades to "no information"
// rather than throwing, because the caller is a hook that must never break.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EMPTY_STATE } from './bands.mjs';

const CTX_MAX_AGE_MS = Number(process.env.CTX_MAX_AGE_MS || 600_000);

export function stateDir() {
  return process.env.CTX_STATE_DIR || path.join(os.homedir(), '.claude', '.context-boundary');
}

function ensureDir() {
  const d = stateDir();
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

// Session ids come from Claude Code, but never build a path from unvalidated
// input — a crafted id containing ../ would escape the state directory.
const safeId = (id) => String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);

export function readCtx(sessionId) {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), `${safeId(sessionId)}.ctx`), 'utf8');
    const d = JSON.parse(raw);
    if (!Number.isFinite(d?.tokens) || !Number.isFinite(d?.ts)) return null;
    if (Date.now() - d.ts > CTX_MAX_AGE_MS) return null; // stale: session likely ended
    return d;
  } catch {
    return null;
  }
}

export function writeCtx(sessionId, payload) {
  try {
    writeAtomic(
      path.join(ensureDir(), `${safeId(sessionId)}.ctx`),
      JSON.stringify({ ...payload, ts: Date.now() }),
    );
  } catch {
    /* the statusline must render regardless */
  }
}

export function readState(sessionId) {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), `${safeId(sessionId)}.json`), 'utf8');
    const d = JSON.parse(raw);
    return {
      highWater: Number(d.highWater) || 0,
      firedBands: Array.isArray(d.firedBands) ? d.firedBands : [],
      lastFiredPrompt: Number.isFinite(d.lastFiredPrompt) ? d.lastFiredPrompt : -Infinity,
      verdicts: Array.isArray(d.verdicts) ? d.verdicts : [],
      // Counts every prompt, not just fired ones — MIN_PROMPT_GAP is measured
      // in prompts elapsed, so this must advance even on silent turns.
      promptCount: Number(d.promptCount) || 0,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function writeState(sessionId, state) {
  try {
    writeAtomic(path.join(ensureDir(), `${safeId(sessionId)}.json`), JSON.stringify(state));
  } catch {
    /* worst case: a duplicate nudge */
  }
}

/** Delete state files untouched for maxAgeDays. Returns how many were removed. */
export function gcState(maxAgeDays) {
  let removed = 0;
  try {
    const d = stateDir();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(d)) {
      if (!/\.(ctx|json)$/.test(name)) continue;
      const f = path.join(d, name);
      try {
        if (fs.statSync(f).mtimeMs < cutoff) {
          fs.unlinkSync(f);
          removed++;
        }
      } catch { /* raced with another process */ }
    }
  } catch { /* no dir yet */ }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/state.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add packages/hooks/lib/state.mjs packages/hooks/test/state.test.mjs
git commit -m "feat(hooks): atomic per-session state and context stamp"
```

---

### Task 3: Statusline writes the context stamp

The statusline is the only component Claude Code hands authoritative context size to. It becomes the sensor.

**Files:**
- Modify: `packages/statusline/statusline.mjs` (add stamp after the existing `priceForModel` block, ~line 85)
- Test: `packages/hooks/test/stamp.test.mjs`

**Interfaces:**
- Consumes: `writeCtx` from `lib/state.mjs`
- Produces: `<session_id>.ctx` containing `{tokens, pct, model, cacheRate, ts}`

**Verified payload shape** (docs "Full JSON schema" for statusLine): `session_id`, `transcript_path`, `cwd`, `model.id`, and `context_window.total_input_tokens` / `.context_window_size` / `.used_percentage`. `total_input_tokens` equals input + cache_creation + cache_read — the same context measure the thresholds were derived from.

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/stamp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const statusline = path.resolve(here, '../../statusline/statusline.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-stamp-'));

function run(payload) {
  return execFileSync('node', [statusline], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CTX_STATE_DIR: tmp },
  });
}

test('statusline stamps context to the state dir', () => {
  run({
    session_id: 'stamp-1',
    model: { id: 'claude-opus-5', display_name: 'Opus' },
    context_window: { total_input_tokens: 250_000, context_window_size: 1_000_000, used_percentage: 25 },
    cost: { total_cost_usd: 1.5 },
  });
  const d = JSON.parse(fs.readFileSync(path.join(tmp, 'stamp-1.ctx'), 'utf8'));
  assert.equal(d.tokens, 250_000);
  assert.equal(d.pct, 25);
  assert.equal(d.model, 'claude-opus-5');
  assert.ok(d.cacheRate > 0, 'cache-read rate is resolved for a known model');
  assert.ok(Date.now() - d.ts < 60_000);
});

test('statusline still renders when session_id is absent', () => {
  const out = run({
    model: { id: 'claude-opus-5', display_name: 'Opus' },
    context_window: { total_input_tokens: 1000, context_window_size: 1_000_000, used_percentage: 1 },
  });
  assert.ok(out.includes('Opus'), 'rendering is unaffected by a missing session_id');
});

test('malformed statusline input still exits 0', () => {
  const out = execFileSync('node', [statusline], {
    input: 'not json', encoding: 'utf8', env: { ...process.env, CTX_STATE_DIR: tmp },
  });
  assert.equal(out.trim(), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/stamp.test.mjs`
Expected: FAIL — no `stamp-1.ctx` file is produced

- [ ] **Step 3: Add the stamp to the statusline**

Add the import at the top of `packages/statusline/statusline.mjs`, beside the existing imports:

```javascript
import { writeCtx } from '../hooks/lib/state.mjs';
```

Then, immediately after the existing `+$/turn` block (the one ending `parts.push(\`${color}+${fmtMoney(perTurn)}/turn${C.reset}\`);`) and before the `rate_limits` block, insert:

```javascript
  // Stamp context for the boundary detector. The statusline is the only place
  // Claude Code hands us an authoritative context size, and it runs every turn.
  // The alternative — parsing transcript_path — means reading up to 35MB of an
  // internal format the docs warn can change on any release.
  if (d.session_id) {
    writeCtx(d.session_id, {
      tokens: used,
      pct: Math.round(pct),
      model: d.model?.id ?? null,
      cacheRate: rate?.cacheRead ?? null,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/stamp.test.mjs`
Expected: PASS — 3 tests

- [ ] **Step 5: Verify the live statusline is unbroken**

Run:
```bash
echo '{"session_id":"smoke","model":{"id":"claude-opus-5","display_name":"Opus"},"context_window":{"total_input_tokens":250000,"context_window_size":1000000,"used_percentage":25},"cost":{"total_cost_usd":1.5}}' \
  | node packages/statusline/statusline.mjs
```
Expected: a normal statusline containing `Opus`, a context bar, and `+$…/turn`. Confirm `~/.claude/.context-boundary/smoke.ctx` now exists, then delete it.

- [ ] **Step 6: Commit**

```bash
git add packages/statusline/statusline.mjs packages/hooks/test/stamp.test.mjs
git commit -m "feat(statusline): stamp context size for the boundary detector"
```

---

### Task 4: Stale-read counter

**Files:**
- Create: `packages/hooks/lib/stale-reads.mjs`
- Test: `packages/hooks/test/stale-reads.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `countStaleReads(transcriptPath: string, gapEntries?: number) -> number`

**Why the gap threshold exists:** measured across all main transcripts, 633 of 1,170 reads are followed by an edit to the same path — but the median gap is **2 entries**, and 51.7% have a gap of 2 or less. That is mandatory read-before-edit (`Edit` refuses to run without a prior `Read`), not waste. Counting it would put a meaningless number in front of the model. A gap of 50+ entries cuts the population ~77% and leaves genuinely superseded content.

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/stale-reads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countStaleReads } from '../lib/stale-reads.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-stale-'));

function transcript(name, entries) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n'));
  return f;
}
const read = (p) => ({ message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: p } }] } });
const edit = (p) => ({ message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: p } }] } });
const filler = () => ({ message: { content: [{ type: 'text', text: 'x' }] } });

test('returns 0 for a missing file', () => {
  assert.equal(countStaleReads(path.join(tmp, 'nope.jsonl')), 0);
});

test('read-then-immediate-edit is NOT stale', () => {
  const f = transcript('a.jsonl', [read('/x.js'), edit('/x.js')]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('read then edit far later IS stale', () => {
  const f = transcript('b.jsonl', [read('/x.js'), ...Array(60).fill(0).map(filler), edit('/x.js')]);
  assert.equal(countStaleReads(f, 50), 1);
});

test('a read never edited is not stale', () => {
  const f = transcript('c.jsonl', [read('/x.js'), ...Array(60).fill(0).map(filler)]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('an edit BEFORE the read does not count', () => {
  const f = transcript('d.jsonl', [edit('/x.js'), ...Array(60).fill(0).map(filler), read('/x.js')]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('sidechain entries are ignored', () => {
  const f = transcript('e.jsonl', [
    { isSidechain: true, ...read('/x.js') },
    ...Array(60).fill(0).map(filler),
    edit('/x.js'),
  ]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('malformed lines are skipped, not fatal', () => {
  const f = path.join(tmp, 'f.jsonl');
  fs.writeFileSync(f, ['{bad', JSON.stringify(read('/x.js')),
    ...Array(60).fill(0).map(() => JSON.stringify(filler())),
    JSON.stringify(edit('/x.js'))].join('\n'));
  assert.equal(countStaleReads(f, 50), 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/stale-reads.test.mjs`
Expected: FAIL — `Cannot find module '../lib/stale-reads.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// packages/hooks/lib/stale-reads.mjs
// Count file reads whose content is superseded by a later edit to the same path.
//
// Only called AFTER the decision to fire, so a full read of the transcript is
// acceptable here (measured: ~0.04s for 8MB, against a 60s hook timeout). It is
// deliberately NOT in the hot path.

import fs from 'node:fs';

const STALE_GAP_ENTRIES = Number(process.env.CTX_STALE_GAP_ENTRIES || 50);
const EDITORS = new Set(['Edit', 'Write', 'NotebookEdit']);

/**
 * @returns number of reads superseded by an edit at least `gapEntries` later.
 */
export function countStaleReads(transcriptPath, gapEntries = STALE_GAP_ENTRIES) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return 0;
  }

  const firstRead = new Map();   // path -> earliest read index
  const firstEdit = new Map();   // path -> earliest edit index

  lines.forEach((line, idx) => {
    if (!line) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return; // a truncated or malformed line must not abort the scan
    }
    if (ev?.isSidechain) return;
    const content = ev?.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const p = b?.input?.file_path;
      if (typeof p !== 'string') continue;
      if (b.name === 'Read' && !firstRead.has(p)) firstRead.set(p, idx);
      else if (EDITORS.has(b.name) && !firstEdit.has(p)) firstEdit.set(p, idx);
    }
  });

  let stale = 0;
  for (const [p, readIdx] of firstRead) {
    const editIdx = firstEdit.get(p);
    if (editIdx !== undefined && editIdx - readIdx >= gapEntries) stale++;
  }
  return stale;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/stale-reads.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add packages/hooks/lib/stale-reads.mjs packages/hooks/test/stale-reads.test.mjs
git commit -m "feat(hooks): count superseded reads with a gap threshold"
```

---

### Task 5: Directive text

**Files:**
- Create: `packages/hooks/lib/directive.mjs`
- Test: `packages/hooks/test/directive.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `costFigures({tokens, cacheRate, floor?}) -> {perTurn, freshPerTurn, breakEven}`
  - `buildDirective({tokens, cacheRate, staleReads, mode}) -> {systemMessage, additionalContext}` where `mode` is `'arm'|'ceiling'`

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/directive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costFigures, buildDirective } from '../lib/directive.mjs';

test('costFigures computes per-turn cost and break-even', () => {
  const f = costFigures({ tokens: 300_000, cacheRate: 0.5, floor: 35_620 });
  assert.ok(Math.abs(f.perTurn - 0.15) < 0.001, 'perTurn = 300k * 0.5 / 1e6');
  assert.ok(Math.abs(f.freshPerTurn - 0.0178) < 0.001);
  assert.ok(f.breakEven > 1.5 && f.breakEven < 2.5, `break-even ~1.9 turns, got ${f.breakEven}`);
});

test('break-even falls as context grows', () => {
  const a = costFigures({ tokens: 200_000, cacheRate: 0.5 });
  const b = costFigures({ tokens: 500_000, cacheRate: 0.5 });
  assert.ok(b.breakEven < a.breakEven);
});

test('arm mode asks for a silent judgement and keeps the continue branch', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 4, mode: 'arm' });
  assert.match(d.additionalContext, /SESSION BOUNDARY CHECK/);
  assert.match(d.additionalContext, /continue the current thread/i);
  assert.match(d.additionalContext, /If it continues/i);
  assert.match(d.additionalContext, /Never do both/i);
  assert.match(d.additionalContext, /4 files/);
  assert.match(d.systemMessage, /250k/);
});

test('ceiling mode removes the judgement call', () => {
  const d = buildDirective({ tokens: 350_000, cacheRate: 0.5, staleReads: 0, mode: 'ceiling' });
  assert.match(d.additionalContext, /regardless of topic/i);
  assert.doesNotMatch(d.additionalContext, /If it continues/i);
});

test('stale-read sentence is omitted when the count is zero', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 0, mode: 'arm' });
  assert.doesNotMatch(d.additionalContext, /stale copies/);
});

test('directive stays small — it is resident for the rest of the session', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: 0.5, staleReads: 4, mode: 'arm' });
  assert.ok(d.additionalContext.length < 1400, `got ${d.additionalContext.length} chars`);
});

test('a null cacheRate degrades to token-only text without NaN', () => {
  const d = buildDirective({ tokens: 250_000, cacheRate: null, staleReads: 0, mode: 'arm' });
  assert.doesNotMatch(d.additionalContext, /NaN/);
  assert.doesNotMatch(d.systemMessage, /NaN/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/directive.test.mjs`
Expected: FAIL — `Cannot find module '../lib/directive.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
// packages/hooks/lib/directive.mjs
// Builds the text injected as additionalContext.
//
// Kept deliberately short: this text becomes permanently resident and is
// re-read at cache-read price on every subsequent call for the rest of the
// session. It is additive to the problem it describes, so it must earn its size.

const FLOOR_TOKENS = Number(process.env.CTX_FLOOR_TOKENS || 35_620);
const HANDOFF_OUTPUT_TOKENS = 1_200;
const W_WRITE = 1.25;
const W_READ = 0.1;
const W_OUT = 5.0;

const k = (n) => `${Math.round(n / 1000)}k`;
const usd = (n) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

/** Per-turn cache-read cost now, the same in a fresh session, and turns to break even. */
export function costFigures({ tokens, cacheRate, floor = FLOOR_TOKENS }) {
  const boundaryCost = floor * W_WRITE + HANDOFF_OUTPUT_TOKENS * W_OUT;
  const savedPerTurn = Math.max(1, (tokens - floor) * W_READ);
  return {
    perTurn: cacheRate ? (tokens * cacheRate) / 1e6 : null,
    freshPerTurn: cacheRate ? (floor * cacheRate) / 1e6 : null,
    breakEven: boundaryCost / savedPerTurn,
  };
}

export function buildDirective({ tokens, cacheRate, staleReads, mode }) {
  const { perTurn, freshPerTurn, breakEven } = costFigures({ tokens, cacheRate });

  const money = perTurn
    ? ` Every further turn costs ~${usd(perTurn)} in cache reads alone; the same work in a fresh session costs ~${usd(freshPerTurn)}.`
    : '';
  const stale = staleReads > 0
    ? ` ${staleReads} files in context are stale copies (read, then edited much later).`
    : '';

  const judgement = mode === 'ceiling'
    ? 'Raise the boundary now, regardless of topic continuity.'
    : [
        "Before answering, judge silently: does the user's message continue the current thread, or start something new?",
        '',
        '**If it continues** — say nothing about this. Answer normally.',
        '',
        '**If it starts something new, or the current task just finished** —',
      ].join('\n');

  const additionalContext = [
    'SESSION BOUNDARY CHECK — mechanical trigger, not a user request.',
    '',
    `Context is now ${k(tokens)} tokens.${money}${stale} A boundary pays for itself in ${breakEven.toFixed(1)} turns.`,
    '',
    judgement,
    '1. Write the handoff FIRST (invoke session-checkpoint) and confirm it is on disk.',
    '2. Tell the user in one line why now, with the number, and print the restart prompt.',
    '',
    'Never do both: do not write a handoff and then also answer the new question in this session.',
  ].join('\n');

  const flag = mode === 'ceiling' ? '⛔' : '⚑';
  const cost = perTurn ? ` (+${usd(perTurn)}/turn)` : '';
  return {
    systemMessage: `${flag} context ${k(tokens)}${cost} — boundary check`,
    additionalContext,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/directive.test.mjs`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add packages/hooks/lib/directive.mjs packages/hooks/test/directive.test.mjs
git commit -m "feat(hooks): boundary directive text and break-even figures"
```

---

### Task 6: The hook entry point

**Files:**
- Create: `packages/hooks/context-boundary.mjs`
- Test: `packages/hooks/test/context-boundary.test.mjs`

**Interfaces:**
- Consumes: `nextState`/`EMPTY_STATE` (`lib/bands.mjs`), `readCtx`/`readState`/`writeState`/`gcState` (`lib/state.mjs`), `countStaleReads` (`lib/stale-reads.mjs`), `buildDirective` (`lib/directive.mjs`)
- Produces: an executable hook. Stdout is either empty or `{systemMessage, hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext}}`.

- [ ] **Step 1: Write the failing test**

```javascript
// packages/hooks/test/context-boundary.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = path.resolve(here, '../context-boundary.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-hook-'));

function stamp(id, tokens) {
  fs.writeFileSync(path.join(tmp, `${id}.ctx`),
    JSON.stringify({ tokens, pct: 25, model: 'claude-opus-5', cacheRate: 0.5, ts: Date.now() }));
}
function run(payload) {
  const out = execFileSync('node', [hook], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CTX_STATE_DIR: tmp },
  });
  return out.trim() ? JSON.parse(out) : null;
}

test('silent when no stamp exists', () => {
  assert.equal(run({ session_id: 'no-stamp', prompt: 'hi' }), null);
});

test('silent below ARM', () => {
  stamp('low', 150_000);
  assert.equal(run({ session_id: 'low', prompt: 'hi' }), null);
});

test('fires above ARM with the right envelope', () => {
  stamp('armed', 250_000);
  const out = run({ session_id: 'armed', prompt: 'now lets do something else' });
  assert.ok(out, 'expected output');
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /SESSION BOUNDARY CHECK/);
  assert.match(out.systemMessage, /250k/);
});

test('does not fire twice in the same band', () => {
  stamp('once', 250_000);
  assert.ok(run({ session_id: 'once', prompt: 'a' }));
  assert.equal(run({ session_id: 'once', prompt: 'b' }), null);
});

test('ceiling mode above 300k', () => {
  stamp('high', 350_000);
  const out = run({ session_id: 'high', prompt: 'x' });
  assert.match(out.hookSpecificOutput.additionalContext, /regardless of topic/i);
});

test('reads the prompt field, not user_input', () => {
  const src = fs.readFileSync(hook, 'utf8');
  assert.match(src, /\.prompt/, 'must read d.prompt');
  assert.doesNotMatch(src, /user_input/, 'user_input is the wrong field name');
});

test('malformed stdin exits 0 and prints nothing', () => {
  const out = execFileSync('node', [hook], {
    input: 'not json', encoding: 'utf8', env: { ...process.env, CTX_STATE_DIR: tmp },
  });
  assert.equal(out.trim(), '');
});

test('a stale stamp is ignored', () => {
  fs.writeFileSync(path.join(tmp, 'stale.ctx'),
    JSON.stringify({ tokens: 500_000, pct: 50, cacheRate: 0.5, ts: Date.now() - 3600_000 }));
  assert.equal(run({ session_id: 'stale', prompt: 'x' }), null);
});

test('a missing transcript still fires, without a stale count', () => {
  stamp('notrans', 250_000);
  const out = run({ session_id: 'notrans', prompt: 'x', transcript_path: '/does/not/exist.jsonl' });
  assert.ok(out);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /stale copies/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/hooks && node --test test/context-boundary.test.mjs`
Expected: FAIL — `Cannot find module '../context-boundary.mjs'`

- [ ] **Step 3: Write the implementation**

```javascript
#!/usr/bin/env node
// UserPromptSubmit hook: detect when a session has grown expensive enough that
// starting fresh beats continuing, and ask the model to judge whether the
// incoming prompt is a new task.
//
// Why a hook and not an instruction: detection must be free and never forgotten.
// Arithmetic runs every prompt at ~1ms; the model is only asked to judge on the
// rare occasions the arithmetic says it is worth judging.
//
// Design notes:
//   * Context comes from the statusline stamp, NOT from parsing transcript_path.
//     Transcripts reach 35MB and their format is internal to Claude Code.
//   * The incoming prompt is `prompt`. The docs say `user_input`; the docs are
//     wrong (verified against binary v2.1.220).
//   * Exits 0 on every path. A hook that breaks a session is worse than none.
//
// Tunables (env): CTX_ARM_TOKENS, CTX_CEILING_TOKENS, CTX_MIN_PROMPT_GAP,
//   CTX_STALE_GAP_ENTRIES, CTX_FLOOR_TOKENS, CTX_MAX_AGE_MS, CTX_STATE_DIR.

import { nextState } from './lib/bands.mjs';
import { readCtx, readState, writeState, gcState } from './lib/state.mjs';
import { countStaleReads } from './lib/stale-reads.mjs';
import { buildDirective } from './lib/directive.mjs';

const GC_DAYS = Number(process.env.CTX_STATE_GC_DAYS || 7);

const readStdin = () =>
  new Promise((resolve) => {
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (b += d));
    process.stdin.on('end', () => resolve(b));
    setTimeout(() => resolve(b), 1500).unref?.();
  });

function main(raw) {
  const d = JSON.parse(raw || '{}');
  const sessionId = d.session_id;
  if (!sessionId) return null;

  const ctx = readCtx(sessionId);
  if (!ctx) return null; // no stamp, or stale: say nothing rather than guess

  const prev = readState(sessionId);
  // Advances on EVERY prompt, including silent ones — MIN_PROMPT_GAP counts
  // prompts elapsed, so tying this to fire events would break the gap.
  const promptIndex = (prev.promptCount ?? 0) + 1;
  const { state, fire } = nextState(prev, ctx.tokens, promptIndex);
  state.promptCount = promptIndex;

  if (!fire) {
    writeState(sessionId, state);
    return null;
  }

  let staleReads = 0;
  if (d.transcript_path) staleReads = countStaleReads(d.transcript_path);

  state.verdicts.push({ ts: Date.now(), tokens: ctx.tokens, mode: fire, prompt: String(d.prompt ?? '').slice(0, 120) });
  writeState(sessionId, state);
  gcState(GC_DAYS);

  const { systemMessage, additionalContext } = buildDirective({
    tokens: ctx.tokens,
    cacheRate: ctx.cacheRate,
    staleReads,
    mode: fire,
  });

  return {
    systemMessage,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
  };
}

try {
  const out = main(await readStdin());
  if (out) process.stdout.write(JSON.stringify(out));
} catch {
  /* never break the session */
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/hooks && node --test test/context-boundary.test.mjs`
Expected: PASS — 9 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test` from the repo root
Expected: PASS — all suites green

- [ ] **Step 6: Commit**

```bash
git add packages/hooks/context-boundary.mjs packages/hooks/test/context-boundary.test.mjs
git commit -m "feat(hooks): UserPromptSubmit session boundary detector"
```

---

### Task 7: Backtest against real transcripts

The thresholds must be falsified against history before they run live.

**Files:**
- Create: `packages/hooks/test/backtest.mjs`

**Interfaces:**
- Consumes: `nextState`, `EMPTY_STATE` from `lib/bands.mjs`
- Produces: a CLI report; exit 1 if acceptance criteria fail

**Acceptance criteria** (from the spec, over 72 real main sessions):

| criterion | target |
|---|---|
| sessions producing a visible nudge | <= 35% |
| nudges per firing session | <= 2.0 |
| sessions with peak >= 500k that fire | 100% (18 of 72) |
| sessions with peak < 100k that fire | 0 |

- [ ] **Step 1: Write the backtest**

```javascript
#!/usr/bin/env node
// Replay real main-session transcripts through the band logic.
//
// POPULATION WARNING: ~/.claude/projects/ holds ~2,579 .jsonl files, but 2,498
// are agent-*.jsonl subagent transcripts and 8 are journals. Only ~73 are main
// user sessions. An earlier analysis over the unfiltered set produced thresholds
// wrong by ~4x. Filter, always.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextState, EMPTY_STATE, ARM_TOKENS, CEILING_TOKENS } from '../lib/bands.mjs';

const root = path.join(os.homedir(), '.claude', 'projects');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl') && !e.name.startsWith('agent-') && !e.name.startsWith('journal')) out.push(p);
  }
  return out;
}

function contextSeries(file) {
  const series = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.isSidechain) continue;
    const raw = ev?.message?.usage;
    if (!raw) continue;
    // usage.iterations[] is currently always length 1, but if it ever grows and
    // the top-level fields aggregate across iterations, reading the top level
    // would overstate context by up to Nx. Prefer the last iteration.
    const u = raw.iterations?.at?.(-1) ?? raw;
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (ctx > 0) series.push(ctx);
  }
  return series;
}

const files = walk(root);
let firing = 0, totalFires = 0, big = 0, bigFired = 0, small = 0, smallFired = 0;

for (const f of files) {
  const series = contextSeries(f);
  if (!series.length) continue;
  const peak = Math.max(...series);
  let state = EMPTY_STATE, fires = 0;
  series.forEach((ctx, i) => {
    const r = nextState(state, ctx, i);
    state = r.state;
    if (r.fire) fires++;
  });
  if (fires) { firing++; totalFires += fires; }
  if (peak >= 500_000) { big++; if (fires) bigFired++; }
  if (peak < 100_000) { small++; if (fires) smallFired++; }
}

const n = files.filter((f) => contextSeries(f).length).length;
const pctFiring = (100 * firing) / n;
const perFiring = firing ? totalFires / firing : 0;

console.log(`ARM=${ARM_TOKENS / 1000}k CEILING=${CEILING_TOKENS / 1000}k over ${n} main sessions`);
console.log(`  sessions firing        ${firing}/${n} (${pctFiring.toFixed(1)}%)   target <= 35%`);
console.log(`  nudges per firing      ${perFiring.toFixed(2)}                target <= 2.0`);
console.log(`  peak>=500k that fire   ${bigFired}/${big}                  target 100%`);
console.log(`  peak<100k that fire    ${smallFired}/${small}                  target 0`);

const failures = [];
if (pctFiring > 35) failures.push(`firing rate ${pctFiring.toFixed(1)}% > 35%`);
if (perFiring > 2.0) failures.push(`nudges per session ${perFiring.toFixed(2)} > 2.0`);
if (big && bigFired < big) failures.push(`missed ${big - bigFired} sessions above 500k`);
if (smallFired > 0) failures.push(`fired on ${smallFired} sessions below 100k`);

if (failures.length) { console.error('\nFAIL:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('\nPASS — thresholds meet acceptance criteria');
```

- [ ] **Step 2: Run the backtest**

Run: `node packages/hooks/test/backtest.mjs`
Expected: a report over ~72 sessions.

If it FAILS, do not weaken the criteria. Tune `CTX_ARM_TOKENS` upward and re-run:

```bash
CTX_ARM_TOKENS=250000 node packages/hooks/test/backtest.mjs
```

Record the chosen value and the resulting numbers in the spec's "Open questions" section, then update the default in `lib/bands.mjs` if it changed.

- [ ] **Step 3: Commit**

```bash
git add packages/hooks/test/backtest.mjs
git commit -m "test(hooks): backtest boundary thresholds against real transcripts"
```

---

### Task 8: Wire it in and verify live

**Files:**
- Modify: `~/.claude/settings.json` (outside the repo — user config)
- Modify: `docs/superpowers/specs/2026-08-03-session-boundary-detector-design.md` (record backtest results)

- [ ] **Step 1: Back up the current settings**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y%m%d)
```

- [ ] **Step 2: Add the hook**

Add a `UserPromptSubmit` entry to the existing `hooks` object in `~/.claude/settings.json`, alongside the current `PreToolUse`, `SessionStart`, and `SessionEnd` entries:

```json
"UserPromptSubmit": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node /home/dynomatic/opencode/projects/token-dashboard/packages/hooks/context-boundary.mjs"
      }
    ]
  }
]
```

- [ ] **Step 3: Verify the JSON is valid before restarting**

Run: `python3 -c "import json;json.load(open('$HOME/.claude/settings.json'));print('valid')"`
Expected: `valid`

- [ ] **Step 4: Smoke-test the hook by hand**

```bash
mkdir -p ~/.claude/.context-boundary
echo '{"tokens":250000,"pct":25,"model":"claude-opus-5","cacheRate":0.5,"ts":'$(date +%s000)'}' \
  > ~/.claude/.context-boundary/manual-smoke.ctx
echo '{"session_id":"manual-smoke","prompt":"lets start on something different"}' \
  | node packages/hooks/context-boundary.mjs
rm ~/.claude/.context-boundary/manual-smoke.*
```

Expected: JSON containing `SESSION BOUNDARY CHECK` and a `systemMessage` reading `⚑ context 250k (+$0.125/turn) — boundary check`.

- [ ] **Step 5: Verify silence on the common path**

```bash
echo '{"tokens":50000,"pct":5,"model":"claude-opus-5","cacheRate":0.5,"ts":'$(date +%s000)'}' \
  > ~/.claude/.context-boundary/quiet-smoke.ctx
echo '{"session_id":"quiet-smoke","prompt":"hello"}' | node packages/hooks/context-boundary.mjs
echo "exit=$?"
rm ~/.claude/.context-boundary/quiet-smoke.*
```

Expected: no output, `exit=0`.

- [ ] **Step 6: Record the backtest outcome in the spec**

Update the spec's "Open questions" item 1 with the final ARM value and the four backtest numbers.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-03-session-boundary-detector-design.md
git commit -m "docs(spec): record backtest results and final ARM threshold"
```

- [ ] **Step 8: Capture the work**

Run `ledger ship` (or invoke `superpowers:ledger-capture`) to write the CHANGELOG entry.

---

## Phase 1 Done Criteria

- `npm test` passes from the repo root
- `node packages/hooks/test/backtest.mjs` exits 0
- The hook is wired in `~/.claude/settings.json` and both smoke tests behave
- A live session crossing 200k produces exactly one nudge

## Deferred to Phase 2

- `packages/hooks/session-restart.mjs` — `SessionStart` (matcher `clear`) emitting `initialUserMessage`, removing the copy/paste step
- `PostCompact` hook clearing `firedBands` with an exact signal instead of the `DROP_RATIO` heuristic
- Optional quiet statusline marker when the detector armed but stayed silent
