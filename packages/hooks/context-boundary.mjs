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
//   * The incoming prompt arrives in the `prompt` field. The published docs name
//     a different field and are wrong — verified against binary v2.1.220.
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
    // The timer alone does not end the wait: an active 'data' listener keeps
    // stdin referenced, so the event loop — and the process — stays alive
    // until EOF even after the promise resolves. destroy() is what actually
    // lets the process exit; without it a parent holding the pipe open blocks
    // the user's prompt until Claude Code's 60s hook timeout.
    const done = () => { process.stdin.destroy(); resolve(b); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (b += d));
    process.stdin.on('end', done);
    process.stdin.on('error', done); // unhandled 'error' on stdin would otherwise throw past the try/catch
    setTimeout(done, 1500).unref?.();
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
