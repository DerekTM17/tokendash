// packages/hooks/test/stale-reads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countStaleReads } from '../lib/stale-reads.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxb-stale-'));

function transcript(name, entries) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n'));
  return f;
}
const read = (p) => ({ message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: p } }] } });
const edit = (p) => ({ message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: p } }] } });
const filler = () => ({ message: { content: [{ type: 'text', text: 'x' }] } });

test('returns 0 for a missing file', () => {
  assert.equal(countStaleReads(path.join(tmp, 'nope.jsonl')), 0);
});

test('read-then-immediate-edit is NOT stale', () => {
  const f = transcript('a.jsonl', [read('/x.js'), edit('/x.js')]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('read then edit far later IS stale', () => {
  const f = transcript('b.jsonl', [read('/x.js'), ...Array(60).fill(0).map(filler), edit('/x.js')]);
  assert.equal(countStaleReads(f, 50), 1);
});

test('a read never edited is not stale', () => {
  const f = transcript('c.jsonl', [read('/x.js'), ...Array(60).fill(0).map(filler)]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('an edit BEFORE the read does not count', () => {
  const f = transcript('d.jsonl', [edit('/x.js'), ...Array(60).fill(0).map(filler), read('/x.js')]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('sidechain entries are ignored', () => {
  const f = transcript('e.jsonl', [
    { isSidechain: true, ...read('/x.js') },
    ...Array(60).fill(0).map(filler),
    edit('/x.js'),
  ]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('malformed lines are skipped, not fatal', () => {
  const f = path.join(tmp, 'f.jsonl');
  fs.writeFileSync(f, ['{bad', JSON.stringify(read('/x.js')),
    ...Array(60).fill(0).map(() => JSON.stringify(filler())),
    JSON.stringify(edit('/x.js'))].join('\n'));
  assert.equal(countStaleReads(f, 50), 1);
});

test('a fresh re-read after an early edit is still paired with the NEXT edit (undercount fix)', () => {
  // Read(0) -> Edit(1) -> Read(2) -> 60 fillers -> Edit(63): the read at index 2
  // is superseded 61 entries later, even though the *first-ever* edit (index 1)
  // sits right next to the *first-ever* read (index 0).
  const f = transcript('g.jsonl', [
    read('/x.js'),
    edit('/x.js'),
    read('/x.js'),
    ...Array(60).fill(0).map(filler),
    edit('/x.js'),
  ]);
  assert.equal(countStaleReads(f, 50), 1);
});

test('a re-read shortly before an edit is not stale, even though the first-ever read was long ago (overcount fix)', () => {
  // Read(0) -> 60 fillers -> Read(61) -> Edit(62): the copy in context was
  // refreshed at index 61 and edited just 1 entry later, so it never went stale
  // — even though the *first-ever* read (index 0) is 62 entries before the edit.
  const f = transcript('h.jsonl', [
    read('/x.js'),
    ...Array(60).fill(0).map(filler),
    read('/x.js'),
    edit('/x.js'),
  ]);
  assert.equal(countStaleReads(f, 50), 0);
});

test('a path with two separate qualifying stale cycles still counts once', () => {
  const f = transcript('i.jsonl', [
    read('/x.js'),
    ...Array(60).fill(0).map(filler),
    edit('/x.js'),
    read('/x.js'),
    ...Array(60).fill(0).map(filler),
    edit('/x.js'),
  ]);
  assert.equal(countStaleReads(f, 50), 1);
});
