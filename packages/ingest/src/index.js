#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverProjects } from './discovery.js';
import { normalize } from './normalizer.js';
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

    const claudeConfig = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeConfig)) sources.push(claudeConfig);
    const claudeHistory = path.join(os.homedir(), '.claude', 'history.jsonl');
    if (fs.existsSync(claudeHistory)) sources.push(claudeHistory);
    const opencodeDb = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    if (fs.existsSync(opencodeDb)) sources.push(opencodeDb);

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
