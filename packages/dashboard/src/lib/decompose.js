/**
 * Attribute a change in cost to the factor that caused it.
 *
 * Sequential (chained) attribution, the same decomposition Uber published: for
 * factor i, hold the factors to its left at their new values and the factors to
 * its right at their old ones. Contributions sum exactly to the change.
 *
 * That method is order-dependent, which is a real weakness. LMDI (log-mean
 * Divisia) is exact AND order-independent, so it is computed alongside as an
 * ORACLE — not displayed. When the two disagree, the change is too large for
 * order-dependence to be ignored and the panel must say so rather than quietly
 * presenting whichever result it computed first.
 *
 * Sequential is what gets shown: "holding everything else constant, adoption
 * added $340" survives contact with a stakeholder and "log-mean Divisia index"
 * does not.
 */
import { FACTOR_KEYS } from './factors.js';

/**
 * Disagreement threshold, as a share of the largest contribution actually
 * shown to a reader for this call. Two scales were tried and rejected first:
 *   - the total change (|after.cost - before.cost|) collapses toward zero
 *     when the five factors swing in opposite directions and mostly cancel,
 *     so a genuinely ordinary change gets divided by a near-zero number and
 *     falsely flagged as order-sensitive.
 *   - spend level (max of before.cost/after.cost) dilutes the other way: it
 *     normalizes by how much money is in play rather than by how large the
 *     factor swings are, so a real order-dependence problem inside a
 *     big-spend period reads as a small percentage and stays quiet — a false
 *     negative on a flag whose only job is to say "don't trust this split."
 * max|contribution| is the size of the numbers actually placed in front of a
 * reader, which is what "is this split trustworthy" is really asking about.
 */
const DISAGREEMENT = 0.10;

function sequential(before, after) {
  const out = {};
  for (let i = 0; i < FACTOR_KEYS.length; i++) {
    let term = after[FACTOR_KEYS[i]] - before[FACTOR_KEYS[i]];
    for (let j = 0; j < i; j++) term *= after[FACTOR_KEYS[j]];
    for (let j = i + 1; j < FACTOR_KEYS.length; j++) term *= before[FACTOR_KEYS[j]];
    out[FACTOR_KEYS[i]] = term;
  }
  return out;
}

/** Logarithmic mean. L(a,a) = a; undefined if either side is <= 0. */
function logMean(a, b) {
  if (a === b) return a;
  return (a - b) / (Math.log(a) - Math.log(b));
}

function lmdi(before, after) {
  const L = logMean(after.cost, before.cost);
  const out = {};
  for (const k of FACTOR_KEYS) out[k] = L * Math.log(after[k] / before[k]);
  return out;
}

export function decompose(before, after) {
  const contributions = sequential(before, after);
  const total = after.cost - before.cost;

  // LMDI needs every factor and both costs strictly positive.
  const positive = v => Number.isFinite(v) && v > 0;
  const oracleSkipped = !positive(before.cost) || !positive(after.cost)
    || FACTOR_KEYS.some(k => !positive(before[k]) || !positive(after[k]));

  let orderSensitive = false;
  if (!oracleSkipped) {
    const other = lmdi(before, after);
    // See the DISAGREEMENT comment above for why max|contribution| — not
    // |total| and not spend level — is the right scale here.
    const scale = Math.max(...FACTOR_KEYS.map(k => Math.abs(contributions[k])), 1e-9);
    orderSensitive = FACTOR_KEYS.some(k => {
      const gap = Math.abs(contributions[k] - other[k]) / scale;
      const signFlip = Math.sign(contributions[k]) !== Math.sign(other[k])
        && contributions[k] !== 0 && other[k] !== 0;
      return gap > DISAGREEMENT || signFlip;
    });
  }

  return { contributions, total, orderSensitive, oracleSkipped };
}
