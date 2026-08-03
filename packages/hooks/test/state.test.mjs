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
