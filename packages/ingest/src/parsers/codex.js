import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseHistoryJSONL(filePath) {
  const sessions = [];
  if (!fs.existsSync(filePath)) return sessions;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      sessions.push({
        id: entry.session_id || String(Date.now()),
        tool: 'codex',
        model: 'unknown',
        startedAt: entry.ts ? new Date(Number(entry.ts) * 1000).toISOString() : null,
        duration: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        currency: 'USD',
      });
    } catch {}
  }

  return sessions;
}

export function parseCodexData(codexDir) {
  const historyPath = path.join(codexDir, 'history.jsonl');
  return parseHistoryJSONL(historyPath);
}

export function defaultPath() {
  return path.join(os.homedir(), '.codex');
}
