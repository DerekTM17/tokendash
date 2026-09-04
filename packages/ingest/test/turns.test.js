// packages/ingest/test/turns.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isUserTurn, turnText } from '../src/turns.js';

const user = (content, extra = {}) => ({
  type: 'user',
  message: { role: 'user', content },
  ...extra,
});

describe('isUserTurn', () => {
  it('accepts a plain string prompt', () => {
    assert.equal(isUserTurn(user('fix the parser')), true);
  });

  it('accepts an array with a text part', () => {
    assert.equal(isUserTurn(user([{ type: 'text', text: 'fix it' }])), true);
  });

  it('accepts multi-part content with images', () => {
    assert.equal(isUserTurn(user([
      { type: 'text', text: 'what is this' },
      { type: 'image', source: {} },
    ])), true);
  });

  it('rejects non-user entries', () => {
    assert.equal(isUserTurn({ type: 'assistant', message: { role: 'assistant' } }), false);
    assert.equal(isUserTurn({ type: 'attachment' }), false);
    assert.equal(isUserTurn({ type: 'queue-operation' }), false);
  });

  it('rejects tool results, which Claude Code logs as user entries', () => {
    assert.equal(isUserTurn(user([{ type: 'tool_result', content: 'ok' }])), false);
  });

  it('rejects isMeta, isSidechain and isCompactSummary entries', () => {
    assert.equal(isUserTurn(user('x', { isMeta: true })), false);
    assert.equal(isUserTurn(user('x', { isSidechain: true })), false);
    assert.equal(isUserTurn(user('x', { isCompactSummary: true })), false);
  });

  it('rejects the five non-prompt text shapes', () => {
    assert.equal(isUserTurn(user('<command-name>/clear</command-name>')), false);
    assert.equal(isUserTurn(user('<local-command-stdout>out</local-command-stdout>')), false);
    assert.equal(isUserTurn(user('[Request interrupted by user for tool use]')), false);
    assert.equal(isUserTurn(user('<system-reminder>note</system-reminder>')), false);
    assert.equal(isUserTurn(user([{ type: 'text', text: '<command-name>/model</command-name>' }])), false);
  });

  it('tolerates missing or malformed content', () => {
    assert.equal(isUserTurn({ type: 'user' }), false);
    assert.equal(isUserTurn(user(null)), false);
    assert.equal(isUserTurn(user([])), false);
  });
});

describe('turnText', () => {
  it('reads a string body', () => {
    assert.equal(turnText(user('hello')), 'hello');
  });
  it('reads the first text part of an array body', () => {
    assert.equal(turnText(user([{ type: 'image' }, { type: 'text', text: 'hi' }])), 'hi');
  });
  it('returns empty string when there is no text', () => {
    assert.equal(turnText(user([{ type: 'image' }])), '');
    assert.equal(turnText({ type: 'user' }), '');
  });
});
