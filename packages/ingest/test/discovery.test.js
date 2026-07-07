import { describe, it } from 'node:test';
import assert from 'node:assert';
import { discoverProjects, matchProject } from '../src/discovery.js';

describe('discoverProjects', () => {
  it('returns an array', () => {
    const projects = discoverProjects(process.env.HOME);
    assert.ok(Array.isArray(projects));
  });

  it('includes known repos from home dir', () => {
    const projects = discoverProjects(process.env.HOME);
    const names = projects.map(p => p.name);
    assert.ok(names.some(n => n === 'docs'));
  });

  it('extracts project name from directory', () => {
    const projects = discoverProjects(process.env.HOME);
    const doc = projects.find(p => p.name === 'docs');
    assert.ok(doc);
    assert.ok(doc.path.endsWith('docs'));
  });
});

describe('matchProject', () => {
  it('matches by path prefix', () => {
    const projects = [
      { name: 'superpowers', path: '/home/dynomatic/.codex/superpowers' },
      { name: 'token-dashboard', path: '/home/dynomatic/opencode/projects/token-dashboard' },
    ];
    assert.strictEqual(
      matchProject('/home/dynomatic/opencode/projects/token-dashboard/packages/ingest', projects),
      'token-dashboard'
    );
  });

  it('returns "other" for no match', () => {
    assert.strictEqual(
      matchProject('/some/random/dir', []),
      'other'
    );
  });
});
