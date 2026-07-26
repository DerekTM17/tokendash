import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalize } from '../src/normalizer.js';

const projects = [
  { name: 'attractor', path: '/home/test/projects/attractor' },
  { name: 'ledger', path: '/home/test/projects/ledger' },
  { name: 'netgraph-ai', path: '/home/test/projects/netgraph-ai' },
];

function session(overrides) {
  return {
    id: 'x', tool: 'codex', model: 'gpt-5.6-sol',
    inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
    cost: 1,
    ...overrides,
  };
}

describe('content-based project inference', () => {
  it('attributes a cwd-less session to the dominant referenced project', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: {
        '/home/test/projects/attractor/src/index.astro': 40,
        '/home/test/projects/attractor': 26,
        '/home/test/projects/ledger/README.md': 1,
      },
    })], projects);
    assert.strictEqual(normalized[0].project, 'attractor');
    assert.strictEqual(normalized[0].projectInferred, true);
  });

  it('stays "other" on a tie (no strict majority)', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: {
        '/home/test/projects/attractor/a': 3,
        '/home/test/projects/ledger/b': 3,
      },
    })], projects);
    assert.strictEqual(normalized[0].project, 'other');
    assert.strictEqual(normalized[0].projectInferred, false);
  });

  it('attributes on 3x dominance over the runner-up without a strict majority', () => {
    // The "listed the projects dir once, then worked in one" shape: many
    // singleton mentions dilute the majority but not the dominance.
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: {
        '/home/test/projects/ledger/cli.py': 4,
        '/home/test/projects/attractor': 1,
        '/home/test/projects/netgraph-ai': 1,
      },
    })], projects);
    assert.strictEqual(normalized[0].project, 'ledger');
    assert.strictEqual(normalized[0].projectInferred, true);
  });

  it('stays "other" when the lead has neither a majority nor 3x dominance', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: {
        '/home/test/projects/ledger/a': 4,
        '/home/test/projects/attractor/b': 3,
        '/home/test/projects/netgraph-ai/c': 3,
      },
    })], projects);
    assert.strictEqual(normalized[0].project, 'other');
  });

  it('stays "other" when evidence is too thin (fewer than 3 refs)', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: { '/home/test/projects/ledger/a': 2 },
    })], projects);
    assert.strictEqual(normalized[0].project, 'other');
    assert.strictEqual(normalized[0].projectInferred, false);
  });

  it('ignores paths that resolve to no project', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test',
      contentPathRefs: {
        '/home/test/.claude/settings.json': 50,
        '/home/test/projects/ledger/a': 4,
      },
    })], projects);
    // 4 of 4 project-resolving refs — the 50 non-project refs don't dilute it
    assert.strictEqual(normalized[0].project, 'ledger');
    assert.strictEqual(normalized[0].projectInferred, true);
  });

  it('never overrides a cwd that resolves to a real project', () => {
    const { normalized } = normalize([session({
      cwd: '/home/test/projects/netgraph-ai',
      contentPathRefs: { '/home/test/projects/attractor/a': 99 },
    })], projects);
    assert.strictEqual(normalized[0].project, 'netgraph-ai');
    assert.strictEqual(normalized[0].projectInferred, false);
  });
});

describe('unpriced-model detection', () => {
  it('reports a model that has tokens but no pricing entry', () => {
    const { unpricedModels } = normalize([session({
      model: 'gpt-9-nova', cost: 0,
      inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 300,
    })], projects);
    assert.deepStrictEqual(unpricedModels, { 'gpt-9-nova': { sessions: 1, tokens: 2000 } });
  });

  it('aggregates sessions and tokens per model', () => {
    const { unpricedModels } = normalize([
      session({ id: 'a', model: 'gpt-9-nova', cost: 0, inputTokens: 10, outputTokens: 0 }),
      session({ id: 'b', model: 'gpt-9-nova', cost: 0, inputTokens: 5, outputTokens: 0 }),
    ], projects);
    assert.deepStrictEqual(unpricedModels, { 'gpt-9-nova': { sessions: 2, tokens: 15 } });
  });

  it('stays empty for priced models, zero-token sessions, and unknown', () => {
    const { unpricedModels } = normalize([
      session({ id: 'a', model: 'claude-opus-5', cost: 0 }),
      session({ id: 'b', model: 'gpt-9-nova', cost: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      session({ id: 'c', model: 'unknown', cost: 0 }),
    ], projects);
    assert.deepStrictEqual(unpricedModels, {});
  });
});
