import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function extractRepoName(cwd) {
  if (!cwd) return null;
  const parts = cwd.split(path.sep);
  return parts[parts.length - 1] || null;
}

export function parseClaudeJSON(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const sessions = [];

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    if (!('lastCost' in value)) continue;

    sessions.push({
      id: key,
      tool: 'claude',
      project: extractRepoName(value.cwd),
      model: value.model || 'unknown',
      startedAt: value.start || null,
      duration: value.duration || null,
      inputTokens: value.lastTotalInputTokens || 0,
      outputTokens: value.lastTotalOutputTokens || 0,
      cacheReadTokens: value.lastTotalCacheReadInputTokens || 0,
      cacheWriteTokens: value.lastTotalCacheCreationInputTokens || 0,
      cost: value.lastCost || 0,
      currency: 'USD',
    });
  }

  return sessions;
}

export function defaultPath() {
  return path.join(os.homedir(), '.claude.json');
}
