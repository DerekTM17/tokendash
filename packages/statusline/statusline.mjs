#!/usr/bin/env node
// Claude Code status line: makes the cost of the NEXT turn visible.
//
// Why this exists: analysis of ~$7k of local usage showed 62% of all spend
// concentrated in ten long sessions, and 88% of cost sitting in cache traffic
// rather than generated output. Cost tracks (context size x number of API
// calls) — so the expensive decision is what you let into the context, and the
// feedback for that decision currently arrives days later in a dashboard.
//
// The load-bearing number here is "+$X/turn": current context re-read at the
// model's cache-read rate. That is what every further tool call costs before
// Claude does anything. A careless full-file read early in a long session gets
// re-read by every subsequent call, which is how a single Read ends up costing
// more than a thousand Haiku subagents.
//
// Wire up in ~/.claude/settings.json:
//   "statusLine": { "type": "command",
//                   "command": "node /path/to/packages/statusline/statusline.mjs" }
//
// Reads JSON on stdin (schema: code.claude.com/docs/en/statusline), prints one
// line. Never throws: a broken status line must not disrupt the session.

import { priceForModel } from '../ingest/src/pricing.js';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};

const readStdin = () =>
  new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => (buf += d));
    process.stdin.on('end', () => resolve(buf));
    // If nothing is piped in, don't hang the UI.
    setTimeout(() => resolve(buf), 900).unref?.();
  });

const fmtTokens = n =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

// $0.059 reads as a decision; $0.0594 reads as noise.
const fmtMoney = n => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

function bar(pct, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▕' + '█'.repeat(filled) + '░'.repeat(width - filled) + '▏';
}

function main(raw) {
  let d = {};
  try {
    d = JSON.parse(raw || '{}');
  } catch {
    return ''; // malformed input: print nothing rather than garbage
  }

  const parts = [];
  const model = d.model?.display_name || d.model?.id || 'claude';
  parts.push(`${C.cyan}${model}${C.reset}`);

  const cw = d.context_window || {};
  const used = cw.total_input_tokens ?? 0;
  const size = cw.context_window_size ?? 0;
  const pct = cw.used_percentage ?? (size ? (used / size) * 100 : 0);

  if (size) {
    const color = pct >= 75 ? C.red : pct >= 50 ? C.yellow : C.green;
    parts.push(`${color}${bar(pct)}${C.reset} ${fmtTokens(used)}/${fmtTokens(size)}`);
  }

  // Session cost as reported by Claude Code itself — authoritative, no estimate.
  if (typeof d.cost?.total_cost_usd === 'number') {
    parts.push(`${fmtMoney(d.cost.total_cost_usd)}`);
  }

  // The behavioural lever: what the next API call costs just to re-read context.
  const rate = priceForModel(d.model?.id);
  if (rate && used > 0) {
    const perTurn = (used * rate.cacheRead) / 1_000_000;
    // Thresholds are per-turn cache-read cost, not context %: a big context on a
    // cheap model is far less urgent than the same context on Fable.
    const color = perTurn >= 0.08 ? C.red : perTurn >= 0.04 ? C.yellow : C.dim;
    parts.push(`${color}+${fmtMoney(perTurn)}/turn${C.reset}`);
  }

  const five = d.rate_limits?.five_hour;
  if (typeof five?.used_percentage === 'number') {
    const p = Math.round(five.used_percentage);
    const color = p >= 80 ? C.red : p >= 60 ? C.yellow : C.dim;
    parts.push(`${color}5h ${p}%${C.reset}`);
  }

  return parts.join(`${C.dim} · ${C.reset}`);
}

try {
  const line = main(await readStdin());
  if (line) process.stdout.write(line + '\n');
} catch {
  // Swallow everything — a status line is never worth breaking the session for.
}
