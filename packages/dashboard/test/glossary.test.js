import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GLOSSARY, define } from '../src/lib/glossary';

describe('define', () => {
  it('returns the definition for a known term', () => {
    expect(define('cache read')).toMatch(/\S/);
  });

  it('is case-insensitive, so a label can be passed verbatim', () => {
    expect(define('Cache read')).toBe(define('cache read'));
  });

  it('returns null for an unknown term rather than guessing', () => {
    expect(define('flux capacitor')).toBeNull();
  });
});

describe('GLOSSARY', () => {
  it('gives every term a title and a plain-English body', () => {
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      expect(entry.title, `${term} has no title`).toMatch(/\S/);
      expect(entry.body.length, `${term} body is too short to explain anything`).toBeGreaterThan(40);
    }
  });

  it('covers every term the components actually ask for', () => {
    // The real guard against a typo in a term= prop: a missing entry renders no
    // tooltip at all, which is invisible in a browser and would ship silently.
    const dir = path.join(import.meta.dirname, '../src/components');
    const asked = new Set();
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of src.matchAll(/term="([^"]+)"/g)) asked.add(m[1]);
    }
    expect(asked.size).toBeGreaterThan(0);
    const missing = [...asked].filter(t => define(t) === null);
    expect(missing).toEqual([]);
  });
});
