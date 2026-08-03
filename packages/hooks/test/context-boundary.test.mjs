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

test('promptCount advances on the silent path, not just when firing', () => {
  // Guards against deleting the silent-path writeState: MIN_PROMPT_GAP counts
  // prompts elapsed, so if this stopped persisting, 'does not fire twice in
  // the same band' would still pass while the gap logic silently broke.
  stamp('gapcount', 150_000); // below ARM: every one of these calls is silent
  const N = 4;
  for (let i = 0; i < N; i++) {
    assert.equal(run({ session_id: 'gapcount', prompt: `p${i}` }), null);
  }
  const state = JSON.parse(fs.readFileSync(path.join(tmp, 'gapcount.json'), 'utf8'));
  assert.equal(state.promptCount, N);
});
