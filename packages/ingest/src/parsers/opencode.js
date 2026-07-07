import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function parseOpencodeSessions(sessionDir) {
  const sessions = [];
  if (!fs.existsSync(sessionDir)) return sessions;

  const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(data) || data.length === 0) continue;

      const id = file.replace('.json', '').replace('ses_', '');
      sessions.push({
        id,
        tool: 'opencode',
        model: 'unknown',
        startedAt: null,
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

export function defaultPath() {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'session_diff');
}
