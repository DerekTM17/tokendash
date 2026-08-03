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
