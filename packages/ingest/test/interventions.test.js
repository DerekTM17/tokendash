// packages/ingest/test/interventions.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInterventions } from '../src/interventions.js';

function write(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-'));
  const f = path.join(dir, 'interventions.json');
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

describe('readInterventions', () => {
  it('returns an empty list when the file is absent', () => {
    const { entries, warnings } = readInterventions('/nonexistent/interventions.json');
    assert.deepEqual(entries, []);
    assert.deepEqual(warnings, []);
  });

  it('accepts a valid entry', () => {
    const { entries } = readInterventions(write([
      { date: '2026-09-15', label: 'MCP to CLI', expect: 'tokensPerRequest' },
    ]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].expect, 'tokensPerRequest');
  });

  it('warns and skips an unknown expect key, keeping the rest of the file', () => {
    const { entries, warnings } = readInterventions(write([
      { date: '2026-09-15', label: 'bad', expect: 'cacheHitRate' },
      { date: '2026-09-20', label: 'good', expect: 'requestsPerTurn' },
    ]));
    assert.equal(entries.length, 1, 'the valid entry survives');
    assert.equal(entries[0].label, 'good');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cacheHitRate/);
    assert.match(warnings[0], /tokensPerRequest/, 'lists the valid keys');
  });

  it('warns and skips entries missing a date or label', () => {
    const { entries, warnings } = readInterventions(write([
      { label: 'no date', expect: 'activeDays' },
      { date: 'not-a-date', label: 'bad date', expect: 'activeDays' },
    ]));
    assert.equal(entries.length, 0);
    assert.equal(warnings.length, 2);
  });

  it('warns and returns empty on malformed JSON rather than throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-bad-'));
    const f = path.join(dir, 'interventions.json');
    fs.writeFileSync(f, '{ not json');
    const { entries, warnings } = readInterventions(f);
    assert.deepEqual(entries, []);
    assert.equal(warnings.length, 1);
  });
});
