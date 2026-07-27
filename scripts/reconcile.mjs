#!/usr/bin/env node
// Cross-check tokens.json against ccusage, an independent implementation that
// reads the same local logs.
//
// Why this exists: every Claude dollar in this dashboard is ESTIMATED
// (tokens x our pricing table). Nothing else grounds it, so a wrong or missing
// rate moves the headline number with no visible symptom — that is how Opus 5
// read $0 and Sonnet 5 sat 50% high. A second implementation is the cheapest
// available oracle.
//
// The report separates two very different failure modes:
//   TOKEN drift  -> our PARSER disagrees (missed/duplicated/misattributed logs)
//   COST drift   -> parsing agrees, our PRICING disagrees
// Cost-only drift is a pricing-table fix; token drift is a parser bug.
//
// Usage:
//   node scripts/reconcile.mjs                       # runs ccusage via npx
//   node scripts/reconcile.mjs --ccusage-json=FILE   # reuse a saved run
//   node scripts/reconcile.mjs --threshold=5         # % drift tolerated (default 2)
//
// Exits 1 if any model drifts beyond the threshold, so it can gate CI or cron.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const TOKENS = path.resolve(__dirname, '..', 'packages', 'dashboard', 'public', 'tokens.json');
const THRESHOLD = Number(arg('threshold') ?? 2);

function loadCcusage() {
  const file = arg('ccusage-json');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stderr.write('Running ccusage (npx, may take a minute)...\n');
  const out = execFileSync('npx', ['-y', 'ccusage@latest', '--json'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

const tokensTotal = s => s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;

// ccusage reports per-day rows, each carrying a per-model breakdown; fold to
// one row per model so both sides are shaped the same.
function foldCcusage(cc) {
  const by = {};
  for (const day of cc.daily || []) {
    for (const b of day.modelBreakdowns || []) {
      const e = (by[b.modelName] ||= { cost: 0, tokens: 0 });
      e.cost += b.cost || 0;
      e.tokens += (b.inputTokens || 0) + (b.outputTokens || 0)
        + (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
    }
  }
  return by;
}

function foldOurs(data) {
  const by = {};
  for (const s of data.sessions) {
    const e = (by[s.model] ||= { cost: 0, tokens: 0 });
    e.cost += s.cost || 0;
    e.tokens += tokensTotal(s);
  }
  return by;
}

const pct = (a, b) => (b === 0 ? (a === 0 ? 0 : 100) : ((a - b) / b) * 100);
const money = n => `$${n.toFixed(2)}`;

const ours = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
const cc = loadCcusage();
const mine = foldOurs(ours);
const theirs = foldCcusage(cc);

const models = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])]
  .sort((a, b) => (mine[b]?.cost || 0) - (mine[a]?.cost || 0));

console.log(
  `\n${'model'.padEnd(28)}${'ccusage $'.padStart(12)}${'ours $'.padStart(12)}` +
  `${'Δ$'.padStart(11)}${'Δtokens'.padStart(13)}  verdict`
);
console.log('-'.repeat(94));

const problems = [];
for (const m of models) {
  const a = mine[m] || { cost: 0, tokens: 0 };
  const b = theirs[m] || { cost: 0, tokens: 0 };
  const costPct = pct(a.cost, b.cost);
  const tokPct = pct(a.tokens, b.tokens);

  let verdict = 'ok';
  if (Math.abs(tokPct) > THRESHOLD) {
    verdict = `PARSER drift ${tokPct > 0 ? '+' : ''}${tokPct.toFixed(1)}% tokens`;
    problems.push({ model: m, kind: 'parser', tokPct, costPct });
  } else if (Math.abs(costPct) > THRESHOLD) {
    verdict = `PRICING drift ${costPct > 0 ? '+' : ''}${costPct.toFixed(1)}%`;
    problems.push({ model: m, kind: 'pricing', tokPct, costPct });
  }

  const dTok = a.tokens - b.tokens;
  console.log(
    m.padEnd(28) + money(b.cost).padStart(12) + money(a.cost).padStart(12) +
    money(a.cost - b.cost).padStart(11) +
    `${(dTok / 1e6).toFixed(1)}M`.padStart(13) + '  ' + verdict
  );
}

const ourTotal = ours.totals.cost;
const theirTotal = cc.totals?.totalCost ?? 0;
console.log('-'.repeat(94));
console.log(
  'TOTAL'.padEnd(28) + money(theirTotal).padStart(12) + money(ourTotal).padStart(12) +
  money(ourTotal - theirTotal).padStart(11) +
  ''.padStart(13) + `  ${pct(ourTotal, theirTotal).toFixed(1)}%`
);

if (problems.length === 0) {
  console.log(`\nAll models agree within ${THRESHOLD}%.\n`);
  process.exit(0);
}

console.log(`\n${problems.length} model(s) beyond ${THRESHOLD}%:`);
for (const p of problems) {
  console.log(
    p.kind === 'parser'
      ? `  ${p.model}: token counts disagree — investigate the PARSER, not pricing.`
      : `  ${p.model}: tokens agree, cost does not — check the rate in pricing-data.json.`
  );
}
console.log('\nccusage is a second opinion, not ground truth — investigate, do not blindly match.\n');
process.exit(1);
