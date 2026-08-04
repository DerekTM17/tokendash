import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numEnv } from '../lib/env.mjs';

test('numEnv honours a valid numeric override', () => {
  process.env.CTX_TEST_VAR = '123';
  assert.equal(numEnv('CTX_TEST_VAR', 10), 123);
  delete process.env.CTX_TEST_VAR;
});

test('numEnv falls back to the default on a non-numeric override', () => {
  process.env.CTX_TEST_VAR = 'abc';
  assert.equal(numEnv('CTX_TEST_VAR', 10), 10);
  delete process.env.CTX_TEST_VAR;
});

test('numEnv falls back to the default on an empty-string override', () => {
  process.env.CTX_TEST_VAR = '';
  assert.equal(numEnv('CTX_TEST_VAR', 10), 10);
  delete process.env.CTX_TEST_VAR;
});

test('numEnv falls back to the default when the override is absent', () => {
  delete process.env.CTX_TEST_VAR;
  assert.equal(numEnv('CTX_TEST_VAR', 10), 10);
});

test('numEnv rejects NaN and Infinity produced by Number()', () => {
  process.env.CTX_TEST_VAR = 'NaN';
  assert.equal(numEnv('CTX_TEST_VAR', 10), 10);
  process.env.CTX_TEST_VAR = 'Infinity';
  assert.equal(numEnv('CTX_TEST_VAR', 10), 10);
  delete process.env.CTX_TEST_VAR;
});
