import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, nextState, EMPTY_STATE } from '../lib/bands.mjs';

test('bandOf returns null below ARM', () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(199_999), null);
});

test('bandOf buckets ARM, mid, CEILING, then every 100k', () => {
  assert.equal(bandOf(200_000), 200);
  assert.equal(bandOf(249_999), 200);
  assert.equal(bandOf(250_000), 250);
  assert.equal(bandOf(299_999), 250);
  assert.equal(bandOf(300_000), 300);
  assert.equal(bandOf(399_999), 300);
  assert.equal(bandOf(400_000), 400);
  assert.equal(bandOf(999_999), 900);
});

test('below ARM never fires', () => {
  const r = nextState(EMPTY_STATE, 150_000, 5);
  assert.equal(r.fire, false);
  assert.equal(r.state.highWater, 150_000);
});

test('first crossing of ARM fires as arm', () => {
  const r = nextState(EMPTY_STATE, 210_000, 20);
  assert.equal(r.fire, 'arm');
  assert.deepEqual(r.state.firedBands, [200]);
  assert.equal(r.state.lastFiredPrompt, 20);
});

test('above CEILING fires as ceiling', () => {
  const r = nextState(EMPTY_STATE, 310_000, 20);
  assert.equal(r.fire, 'ceiling');
});

test('same band does not fire twice', () => {
  const a = nextState(EMPTY_STATE, 210_000, 20);
  const b = nextState(a.state, 240_000, 40);
  assert.equal(b.fire, false);
});

test('min prompt gap suppresses an adjacent band', () => {
  const a = nextState(EMPTY_STATE, 210_000, 20);
  const b = nextState(a.state, 260_000, 25); // new band, only 5 prompts later
  assert.equal(b.fire, false);
  assert.deepEqual(b.state.firedBands, [200], 'unfired band is not recorded');
});

test('bands key off high-water, so a modest dip does not re-fire', () => {
  const a = nextState(EMPTY_STATE, 410_000, 10);   // fires band 400
  const b = nextState(a.state, 300_000, 30);       // dip, but above DROP_RATIO -> no reset
  assert.equal(b.fire, false);
  assert.equal(b.state.highWater, 410_000, 'high-water is retained');
  const c = nextState(b.state, 350_000, 50);       // climbs back
  assert.equal(c.fire, false, 'still band 400, already fired');
});

test('a drop past DROP_RATIO resets fired bands', () => {
  const a = nextState(EMPTY_STATE, 410_000, 10);
  const b = nextState(a.state, 200_000, 30);       // 200k < 410k * 0.6 -> reset
  assert.deepEqual(b.state.firedBands, [200]);
  assert.equal(b.state.highWater, 200_000);
  assert.equal(b.fire, 'arm', 'post-compaction climb can fire again');
});
