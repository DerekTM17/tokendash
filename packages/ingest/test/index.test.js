import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '..', 'src', 'index.js');

describe('ingest CLI', () => {
  it('prints status ok', () => {
    const out = execSync(`node "${cliPath}"`, { encoding: 'utf8' });
    const result = JSON.parse(out);
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.watch, false);
  });

  it('accepts --watch flag', () => {
    const out = execSync(`node "${cliPath}" --watch`, { encoding: 'utf8' });
    const result = JSON.parse(out);
    assert.strictEqual(result.watch, true);
  });
});
