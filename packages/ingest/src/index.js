#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverProjects } from './discovery.js';
import { normalize } from './normalizer.js';
import { parseClaudeJSON, defaultPath as claudePath } from './parsers/claude.js';
import { parseOpencodeSessions, defaultPath as opencodePath } from './parsers/opencode.js';
import { parseCodexData, defaultPath as codexPath } from './parsers/codex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1]
  || path.resolve(__dirname, '..', '..', 'dashboard', 'public', 'tokens.json');

function ingest() {
  const projects = discoverProjects();
  const sessions = [];

  const claudeConfigPath = claudePath();
  if (fs.existsSync(claudeConfigPath)) {
    try {
      sessions.push(...parseClaudeJSON(claudeConfigPath));
    } catch (e) {
      console.error('Failed to parse Claude Code config:', e.message);
    }
  }

  const opencodeConfigPath = opencodePath();
  if (fs.existsSync(opencodeConfigPath)) {
    try {
      sessions.push(...parseOpencodeSessions(opencodeConfigPath));
    } catch (e) {
      console.error('Failed to parse opencode sessions:', e.message);
    }
  }

  const codexConfigPath = codexPath();
  if (fs.existsSync(codexConfigPath)) {
    try {
      sessions.push(...parseCodexData(codexConfigPath));
    } catch (e) {
      console.error('Failed to parse Codex data:', e.message);
    }
  }

  const { normalized, totals } = normalize(sessions, projects);

  const output = {
    generated: new Date().toISOString(),
    tools: [...new Set(normalized.map(s => s.tool))],
    sessions: normalized,
    totals,
  };

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ status: 'ok', sessions: normalized.length, output: outputPath }));
  return output;
}

if (watch) {
  (async () => {
    const chokidar = (await import('chokidar')).default;
    const sources = [];

    const cp = claudePath();
    if (fs.existsSync(cp)) sources.push(cp);
    const op = opencodePath();
    if (fs.existsSync(op)) sources.push(op);
    const cx = codexPath();
    const historyPath = path.join(cx, 'history.jsonl');
    if (fs.existsSync(historyPath)) sources.push(historyPath);

    const watcher = chokidar.watch(sources, { persistent: true });
    watcher.on('change', () => {
      console.log('Source changed, re-ingesting...');
      ingest();
    });
    console.log(`Watching ${sources.length} source(s)...`);
    ingest();
  })();
} else {
  ingest();
}
