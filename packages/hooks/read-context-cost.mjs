#!/usr/bin/env node
// PreToolUse hook for Read: price a file BEFORE it enters the context window.
//
// Why: measured on ~$7k of local usage, 88% of spend is cache traffic and cost
// tracks (context size x number of API calls). A file read at turn 40 of a
// 3,500-call session is re-read by every remaining call — one careless whole-
// file Read can cost more than a thousand Haiku subagents. The decision is
// made mid-session, which is exactly when no dashboard is being looked at.
//
// Design notes:
//   * It does NOT gate on approval. Returning permissionDecision "ask" would
//     stall the long autonomous sessions this is meant to protect. It injects
//     the number into the model's context and lets the model choose — the
//     model is the one deciding, so that is where the number belongs.
//   * Silent for targeted reads (offset/limit present) and small files, so it
//     stays rare enough to still carry signal. A hook that fires constantly
//     gets approved reflexively and stops working.
//
// Tunables (env):
//   READ_WARN_TOKENS  threshold in estimated tokens (default 15000)
//   READ_CACHE_RATE   USD per million cache-read tokens (default 0.5, Opus tier)
//
// Input/output: hook JSON on stdin, JSON on stdout.
// Exits 0 always — a hook must never break the session.

import fs from 'node:fs';

const WARN_TOKENS = Number(process.env.READ_WARN_TOKENS || 15000);
const CACHE_RATE = Number(process.env.READ_CACHE_RATE || 0.5);

// Text averages ~4 bytes/token; code trends denser, so this under-estimates
// slightly. Fine — we want a floor on the cost, not a precise count.
const BYTES_PER_TOKEN = 4;

const read = () =>
  new Promise(resolve => {
    let b = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => (b += d));
    process.stdin.on('end', () => resolve(b));
    setTimeout(() => resolve(b), 1500).unref?.();
  });

function main(raw) {
  const d = JSON.parse(raw || '{}');
  const input = d.tool_input || {};
  const file = input.file_path;
  if (!file) return null;

  // Already scoped — this is the behaviour we want, say nothing.
  if (input.offset != null || input.limit != null) return null;

  let bytes;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    bytes = st.size;
  } catch {
    return null; // missing/unreadable: let the Read tool report it
  }

  // The Read tool caps at 2000 lines, so a huge file won't fully land. Estimate
  // what actually gets read rather than the whole file, or we cry wolf on big
  // files that arrive truncated anyway.
  let effective = bytes;
  try {
    const head = fs.readFileSync(file, { encoding: 'utf8', flag: 'r' }).slice(0, 200_000);
    const sampleLines = head.split('\n');
    if (sampleLines.length > 1) {
      const avgLine = head.length / sampleLines.length;
      effective = Math.min(bytes, Math.round(avgLine * 2000));
    }
  } catch {
    /* fall back to full size */
  }

  const tokens = Math.round(effective / BYTES_PER_TOKEN);
  if (tokens < WARN_TOKENS) return null;

  const perTurn = (tokens * CACHE_RATE) / 1_000_000;
  const per500 = perTurn * 500;

  const msg =
    `This read adds ~${(tokens / 1000).toFixed(0)}k tokens to the context window. ` +
    `Every later API call in this session re-reads them: +$${perTurn.toFixed(3)}/turn ` +
    `(~$${per500.toFixed(2)} over another 500 turns). ` +
    `If you only need part of it, use offset/limit or Grep; if you are surveying ` +
    `rather than editing, delegate to a subagent so the bulk stays out of this context. ` +
    `If you do need the whole file, proceed — this is a cost note, not a blocker.`;

  return {
    systemMessage: `⚠ Read: ~${(tokens / 1000).toFixed(0)}k tokens (+$${perTurn.toFixed(3)}/turn)`,
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
  };
}

try {
  const out = main(await read());
  if (out) process.stdout.write(JSON.stringify(out));
} catch {
  /* never break the session */
}
