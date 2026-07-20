import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverProjects, matchProject } from '../src/discovery.js';

// Build a hermetic fixture tree so the test doesn't depend on the machine's
// real home directory (which differs between dev and CI).
let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'));
  fs.mkdirSync(path.join(root, 'alpha', '.git'), { recursive: true });      // a git repo
  fs.mkdirSync(path.join(root, 'nested', 'beta', '.git'), { recursive: true }); // nested repo
  fs.mkdirSync(path.join(root, 'plain'), { recursive: true });               // not a repo
  // Tool machinery, not user projects: repos under hidden dirs must not count
  fs.mkdirSync(path.join(root, '.codex', 'superpowers', '.git'), { recursive: true });
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('discoverProjects', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(discoverProjects([root])));
  });

  it('finds git repos, including nested ones, and skips non-repos', () => {
    const names = discoverProjects([root]).map(p => p.name);
    assert.ok(names.includes('alpha'), 'should find a top-level repo');
    assert.ok(names.includes('beta'), 'should find a nested repo');
    assert.ok(!names.includes('plain'), 'should not include a dir without .git');
  });

  it('does not descend into hidden directories (tool config, not projects)', () => {
    const names = discoverProjects([root]).map(p => p.name);
    assert.ok(!names.includes('superpowers'), 'repos under dot-dirs are not user projects');
  });

  it('extracts project name from directory path', () => {
    const alpha = discoverProjects([root]).find(p => p.name === 'alpha');
    assert.ok(alpha);
    assert.ok(alpha.path.endsWith('alpha'));
  });
});

describe('matchProject', () => {
  it('matches by path prefix', () => {
    const projects = [
      { name: 'other-proj', path: '/home/u/other-proj' },
      { name: 'token-dashboard', path: '/home/u/opencode/projects/token-dashboard' },
    ];
    assert.strictEqual(
      matchProject('/home/u/opencode/projects/token-dashboard/packages/ingest', projects),
      'token-dashboard'
    );
  });

  it('requires a path-segment boundary (no partial-prefix match)', () => {
    const projects = [{ name: 'foo', path: '/home/u/foo' }];
    assert.strictEqual(matchProject('/home/u/foobar/src', projects), 'other');
  });

  it('returns "other" for no match', () => {
    assert.strictEqual(matchProject('/some/random/dir', []), 'other');
  });
});
