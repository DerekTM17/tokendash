// packages/hooks/test/stamp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const statusline = path.resolve(here, '../../statusline/statusline.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-stamp-'));

function run(payload) {
  return execFileSync('node', [statusline], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CTX_STATE_DIR: tmp },
  });
}

test('statusline stamps context to the state dir', () => {
  run({
    session_id: 'stamp-1',
    model: { id: 'claude-opus-5', display_name: 'Opus' },
    context_window: { total_input_tokens: 250_000, context_window_size: 1_000_000, used_percentage: 25 },
    cost: { total_cost_usd: 1.5 },
  });
  const d = JSON.parse(fs.readFileSync(path.join(tmp, 'stamp-1.ctx'), 'utf8'));
  assert.equal(d.tokens, 250_000);
  assert.equal(d.pct, 25);
  assert.equal(d.model, 'claude-opus-5');
  assert.ok(d.cacheRate > 0, 'cache-read rate is resolved for a known model');
  assert.ok(Date.now() - d.ts < 60_000);
});

test('statusline still renders when session_id is absent', () => {
  const out = run({
    model: { id: 'claude-opus-5', display_name: 'Opus' },
    context_window: { total_input_tokens: 1000, context_window_size: 1_000_000, used_percentage: 1 },
  });
  assert.ok(out.includes('Opus'), 'rendering is unaffected by a missing session_id');
});

test('malformed statusline input still exits 0', () => {
  const out = execFileSync('node', [statusline], {
    input: 'not json', encoding: 'utf8', env: { ...process.env, CTX_STATE_DIR: tmp },
  });
  assert.equal(out.trim(), '');
});
