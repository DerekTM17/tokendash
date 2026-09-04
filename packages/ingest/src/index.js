#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverProjects } from './discovery.js';
import { normalize } from './normalizer.js';
import { readInterventions, mergeResults } from './interventions.js';
import { parseClaudeJSON } from './parsers/claude.js';
import { parseOpencodeSessions } from './parsers/opencode.js';
import { parseCodexData, defaultPath as codexPath } from './parsers/codex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1]
  || path.resolve(__dirname, '..', '..', 'dashboard', 'public', 'tokens.json');

function ingest() {
  const projects = discoverProjects();
  const sessions = [];

  try {
    sessions.push(...parseClaudeJSON());
  } catch (e) {
    console.error('Failed to parse Claude Code sessions:', e.message);
  }

  try {
    sessions.push(...parseOpencodeSessions());
  } catch (e) {
    console.error('Failed to parse opencode sessions:', e.message);
  }

  const codexConfigPath = codexPath();
  if (fs.existsSync(codexConfigPath)) {
    try {
      sessions.push(...parseCodexData(codexConfigPath));
    } catch (e) {
      console.error('Failed to parse Codex data:', e.message);
    }
  }

  const { normalized, totals, unpricedModels, unknownModelSessions, overWindowSessions, callsByTool } =
    normalize(sessions, projects);

  const { entries: interventions, warnings: interventionWarnings } =
    readInterventions(path.resolve(__dirname, '..', '..', '..', 'interventions.json'));
  for (const w of interventionWarnings) console.error(`WARNING: ${w}`);

  // A supported verdict becomes refused once its before-window is swept by the
  // 30-day retention job — the number changes because history was deleted, not
  // because the work changed. A matured intervention's result is frozen by the
  // dashboard operator into this sidecar; merge it in so tokens.json carries
  // the frozen figure instead of re-deriving a now-unrecoverable one.
  const interventionsWithResults = mergeResults(
    interventions,
    path.resolve(__dirname, '..', '..', '..', 'interventions.results.json')
  );
  for (const w of interventionsWithResults.warnings || []) console.error(`WARNING: ${w}`);

  for (const [model, { sessions: n, tokens }] of Object.entries(unpricedModels)) {
    console.error(
      `WARNING: no pricing entry for "${model}" — ${n} session(s), ` +
        `${tokens.toLocaleString()} tokens counted as $0. Add it to pricing.js.`
    );
  }

  if (unknownModelSessions.sessions) {
    console.error(
      `WARNING: ${unknownModelSessions.sessions} session(s) with an unidentified model — ` +
        `${unknownModelSessions.tokens.toLocaleString()} tokens attributed to "unknown". ` +
        `This is a parser gap, not a missing rate: check the model field for that tool.`
    );
  }

  if (overWindowSessions.sessions) {
    console.error(
      `WARNING: ${overWindowSessions.sessions} session(s) report more context per API call than ` +
        `the model's context window (worst: ${overWindowSessions.worst.toLocaleString()} tokens ` +
        `on "${overWindowSessions.model}"). That is arithmetically impossible — the per-call ` +
        `accounting has drifted, not the pricing.`
    );
  }

  const callSummary = Object.entries(callsByTool)
    .map(([tool, n]) => `${tool} ${n.toLocaleString()}`)
    .join(', ');
  console.error(`API calls counted: ${callSummary || 'none'}`);

  const output = {
    generated: new Date().toISOString(),
    tools: [...new Set(normalized.map(s => s.tool))],
    sessions: normalized,
    totals,
    interventions: interventionsWithResults,
  };

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  // Compact, not indented. This file is a gitignored build artifact served to
  // the browser, never read by a human in place — and indentation was 60% of
  // its bytes (2.24MB pretty vs 1.40MB compact), which the per-day `daily`
  // arrays made far worse since each row would otherwise cost 10 indented
  // lines. Pipe it through `jq` if you need to read it.
  fs.writeFileSync(outputPath, JSON.stringify(output));
  console.log(JSON.stringify({ status: 'ok', sessions: normalized.length, output: outputPath }));
  return output;
}

// Re-ingest is debounced: transcripts are appended on every assistant message,
// so raw events arrive in long bursts, and a full ingest walks thousands of
// files (~2.6s). Coalesce a burst into one run at the end of it.
const DEBOUNCE_MS = 4000;

if (watch) {
  (async () => {
    const chokidar = (await import('chokidar')).default;
    const sources = [];

    // Watch what the parsers actually READ. Earlier this watched ~/.claude.json
    // and ~/.claude/history.jsonl — neither is a data source (the transcripts
    // under projects/ are), so refreshes only happened incidentally, when those
    // proxy files happened to churn, and Codex was never watched at all.
    const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeProjects)) sources.push(claudeProjects);
    const codexSessions = path.join(os.homedir(), '.codex', 'sessions');
    if (fs.existsSync(codexSessions)) sources.push(codexSessions);
    const opencodeDb = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    if (fs.existsSync(opencodeDb)) sources.push(opencodeDb);

    let timer = null;
    const schedule = filePath => {
      // Directory trees emit for every file; only our data files matter.
      if (filePath && !/\.(jsonl|db)$/.test(filePath)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log('Source changed, re-ingesting...');
        try {
          ingest();
        } catch (e) {
          // A transient read error (file rotated mid-walk) must not kill the
          // long-lived watcher — the next event re-runs it.
          console.error('Ingest failed:', e.message);
        }
      }, DEBOUNCE_MS);
    };

    const watcher = chokidar.watch(sources, { persistent: true, ignoreInitial: true });
    watcher.on('add', schedule);
    watcher.on('change', schedule);
    console.log(`Watching ${sources.length} source(s)...`);
    ingest();
  })();
} else {
  ingest();
}
