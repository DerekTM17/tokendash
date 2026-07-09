import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '..', 'src', 'index.js');

describe('ingest CLI', () => {
  it('runs once and writes tokens.json to the given --output path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-cli-'));
    const outPath = path.join(tmp, 'tokens.json');
    try {
      const out = execFileSync('node', [cliPath, `--output=${outPath}`], { encoding: 'utf8' });
      const result = JSON.parse(out.trim().split('\n').pop());
      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(typeof result.sessions, 'number');
      assert.ok(fs.existsSync(outPath), 'should write the output file');
      const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.ok(Array.isArray(data.sessions), 'output should contain a sessions array');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('starts a file watcher in --watch mode', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-watch-'));
    const outPath = path.join(tmp, 'tokens.json');
    try {
      // Watch mode runs indefinitely by design; the timeout terminates it.
      const res = spawnSync('node', [cliPath, '--watch', `--output=${outPath}`], { encoding: 'utf8', timeout: 3000 });
      assert.match(res.stdout, /Watching/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
