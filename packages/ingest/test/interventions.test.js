// packages/ingest/test/interventions.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInterventions, mergeResults } from '../src/interventions.js';

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

describe('mergeResults', () => {
  it('attaches a persisted result to its intervention', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivr-'));
    const sidecar = path.join(dir, 'interventions.results.json');
    fs.writeFileSync(sidecar, JSON.stringify({
      '2026-09-15::MCP to CLI': { verdict: 'supported', frozenAt: '2026-10-01' },
    }));
    const entries = mergeResults(
      [{ date: '2026-09-15', label: 'MCP to CLI', expect: 'tokensPerRequest' }],
      sidecar
    );
    assert.equal(entries[0].result.verdict, 'supported');
    assert.equal(entries[0].result.frozenAt, '2026-10-01');
  });

  it('leaves entries untouched when no sidecar exists', () => {
    const entries = mergeResults(
      [{ date: '2026-09-15', label: 'x', expect: 'activeDays' }],
      '/nonexistent/interventions.results.json'
    );
    assert.equal(entries[0].result, undefined);
  });

  it('warns and skips a frozen entry that is not an object with a string verdict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivr-bad-'));
    const sidecar = path.join(dir, 'interventions.results.json');
    fs.writeFileSync(sidecar, JSON.stringify({
      '2026-09-15::MCP to CLI': 'supported', // not an object — malformed operator edit
      '2026-09-16::no verdict': { frozenAt: '2026-10-01' }, // object, but no string verdict
    }));
    const entries = mergeResults(
      [
        { date: '2026-09-15', label: 'MCP to CLI', expect: 'tokensPerRequest' },
        { date: '2026-09-16', label: 'no verdict', expect: 'activeDays' },
      ],
      sidecar
    );
    assert.equal(entries[0].result, undefined);
    assert.equal(entries[1].result, undefined);
    assert.equal(entries.warnings.length, 2, 'both malformed entries produce a warning');
  });

  it('warns and returns entries unchanged on malformed sidecar JSON rather than throwing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivr-badjson-'));
    const sidecar = path.join(dir, 'interventions.results.json');
    fs.writeFileSync(sidecar, '{ not json');
    const entries = mergeResults(
      [{ date: '2026-09-15', label: 'x', expect: 'activeDays' }],
      sidecar
    );
    assert.equal(entries[0].result, undefined);
    assert.equal(entries.warnings.length, 1);
  });

  it('warns and returns entries unchanged when the sidecar is not a keyed object', () => {
    // A valid-JSON but wrong-shaped sidecar (an array, or a bare primitive) must
    // not throw: `"key" in frozen` throws a TypeError for a non-object frozen
    // value, which would abort ingest — exactly what this module exists to
    // avoid over a hand-edited file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivr-notobj-'));
    for (const bad of ['[1,2,3]', '"oops"', 'null']) {
      const sidecar = path.join(dir, `${bad.replace(/\W/g, '')}.json`);
      fs.writeFileSync(sidecar, bad);
      const entries = mergeResults(
        [{ date: '2026-09-15', label: 'x', expect: 'activeDays' }],
        sidecar
      );
      assert.equal(entries[0].result, undefined, `bad sidecar: ${bad}`);
      assert.equal(entries.warnings.length, 1, `bad sidecar: ${bad}`);
    }
  });
});
