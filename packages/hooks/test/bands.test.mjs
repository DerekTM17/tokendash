import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, nextState, EMPTY_STATE } from '../lib/bands.mjs';

test('bandOf returns null below ARM', () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(324_999), null);
});

test('bandOf buckets into exactly two bands, and the ceiling band is terminal', () => {
  assert.equal(bandOf(325_000), 325);
  assert.equal(bandOf(449_999), 325);
  assert.equal(bandOf(450_000), 450);
  // Everything above CEILING collapses into the one ceiling band: no matter how
  // far context grows, it can never earn a third nudge.
  assert.equal(bandOf(600_000), 450);
  assert.equal(bandOf(999_999), 450);
});

test('below ARM never fires', () => {
  const r = nextState(EMPTY_STATE, 150_000, 5);
  assert.equal(r.fire, false);
  assert.equal(r.state.highWater, 150_000);
});

test('first crossing of ARM fires as arm', () => {
  const r = nextState(EMPTY_STATE, 330_000, 20);
  assert.equal(r.fire, 'arm');
  assert.deepEqual(r.state.firedBands, [325]);
  assert.equal(r.state.lastFiredPrompt, 20);
});

test('above CEILING fires as ceiling', () => {
  const r = nextState(EMPTY_STATE, 460_000, 20);
  assert.equal(r.fire, 'ceiling');
});

test('same band does not fire twice', () => {
  const a = nextState(EMPTY_STATE, 330_000, 20);
  const b = nextState(a.state, 340_000, 40); // still band 325
  assert.equal(b.fire, false);
});

test('min prompt gap suppresses an adjacent band', () => {
  const a = nextState(EMPTY_STATE, 330_000, 20);
  const b = nextState(a.state, 460_000, 25); // band 450, only 5 prompts later
  assert.equal(b.fire, false);
  assert.deepEqual(b.state.firedBands, [325], 'unfired band is not recorded');
});

test('bands key off high-water, so a modest dip does not re-fire', () => {
  const a = nextState(EMPTY_STATE, 460_000, 10);   // fires band 450
  const b = nextState(a.state, 350_000, 30);       // dip, but above DROP_RATIO -> no reset
  assert.equal(b.fire, false);
  assert.equal(b.state.highWater, 460_000, 'high-water is retained');
  const c = nextState(b.state, 400_000, 50);       // climbs back
  assert.equal(c.fire, false, 'still band 450, already fired');
});

test('a drop past DROP_RATIO resets high-water but does NOT re-arm fired bands', () => {
  const a = nextState(EMPTY_STATE, 330_000, 10);   // fires band 325
  assert.equal(a.fire, 'arm');
  assert.deepEqual(a.state.firedBands, [325]);

  const b = nextState(a.state, 460_000, 25);       // above 330k * 0.6 -> no reset
  assert.equal(b.fire, 'ceiling');
  assert.deepEqual(b.state.firedBands, [325, 450]);

  const c = nextState(b.state, 150_000, 45);       // 150k < 460k * 0.6 -> reset
  assert.equal(c.state.highWater, 150_000, 'high-water follows the live context down');
  assert.deepEqual(c.state.firedBands, [325, 450], 'fired bands survive the reset');
  assert.equal(c.fire, false, 'below ARM, nothing to fire');

  // The ruling this pins: a band fires at most once per session, not once per
  // compaction epoch. Clearing firedBands here cost 2.88 nudges per firing
  // session against a 2.0 budget.
  const d = nextState(c.state, 330_000, 60);       // climbs back into the arm band
  assert.equal(d.fire, false, 'band 325 already fired; a post-compaction climb does NOT re-fire');
  assert.deepEqual(d.state.firedBands, [325, 450]);
});
