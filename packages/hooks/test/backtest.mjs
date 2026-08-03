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
