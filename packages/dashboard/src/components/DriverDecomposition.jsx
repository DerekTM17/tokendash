import { useMemo } from 'react';
import { factorsFor, FACTOR_KEYS } from '../lib/factors.js';
import { decompose } from '../lib/decompose.js';
import { formatCost, formatTokens } from '../lib/format.js';
import InfoTip from './InfoTip.jsx';

const LABELS = {
  activeDays: 'Active days',
  turnsPerActiveDay: 'Turns per active day',
  requestsPerTurn: 'Requests per turn',
  tokensPerRequest: 'Tokens per request',
  pricePerToken: 'Price per token',
};
export const TERMS = {
  activeDays: 'active days',
  turnsPerActiveDay: 'turns per active day',
  requestsPerTurn: 'requests per turn',
  tokensPerRequest: 'tokens per request',
  pricePerToken: 'price per token',
};

/**
 * Renders a factor's Before/After value the way a reader who has never seen a
 * token bill would want to see it — not `toPrecision(4)`, which puts
 * `pricePerToken` (routinely ~1e-6) and `tokensPerRequest` (routinely ~1e5) in
 * exponential notation that communicates nothing.
 *
 * `pricePerToken` is scaled by 1,000,000 and shown as a dollar figure per
 * million tokens — the same idiom `ModelEfficiency` uses for per-token rates —
 * with an explicit "/ 1M" suffix so it is never mistaken for a per-token price.
 */
function formatFactorValue(key, value) {
  switch (key) {
    case 'activeDays': return String(Math.round(value));
    case 'turnsPerActiveDay': return value.toFixed(1);
    case 'requestsPerTurn': return value.toFixed(1);
    case 'tokensPerRequest': return formatTokens(value);
    case 'pricePerToken': return `${formatCost(value * 1e6)} / 1M`;
    default: return String(value);
  }
}

/** Split the covered span in half and compare the halves. */
function halves(sessions) {
  const days = new Set();
  for (const s of sessions) {
    if (!s.daily?.length) continue;
    for (const [day, calls] of s.daily) if (calls > 0) days.add(day);
  }
  const sorted = [...days].sort();
  if (sorted.length < 4) return null;
  const mid = Math.floor(sorted.length / 2);
  return {
    beforeFrom: sorted[0], beforeTo: sorted[mid - 1],
    afterFrom: sorted[mid], afterTo: sorted[sorted.length - 1],
  };
}

const DEGENERATE_MESSAGE = {
  'no-turns': 'One of these two periods has calls and cost recorded but no turns, so it can\'t be split into the five factors. Only Claude Code sessions record turns — try a wider date range.',
  'no-tokens': 'One of these two periods has turns and cost recorded but no tokens, so it can\'t be split into the five factors. Try a different date range.',
};

/**
 * Computes the before/after factors and decomposition for a set of sessions,
 * or a reason the comparison can't be shown.
 *
 * `factorsFor` returning `null` (nothing happened in a half at all) and
 * returning a real object with `degenerate` set (real calls, real cost, but a
 * zero denominator — see factors.js) are both insufficient-data conditions
 * from this panel's point of view, but they are NOT the same condition, so the
 * message shown must say which one it hit rather than collapsing both into
 * one generic string.
 */
function computeResult(sessions) {
  const w = halves(sessions);
  if (!w) return { reason: 'insufficient' };

  const before = factorsFor(sessions, w.beforeFrom, w.beforeTo);
  const after = factorsFor(sessions, w.afterFrom, w.afterTo);
  if (!before || !after) return { reason: 'insufficient' };

  const which = before.degenerate || after.degenerate;
  if (which) return { reason: 'degenerate', which };

  return { reason: 'ok', w, before, after, ...decompose(before, after) };
}

export default function DriverDecomposition({ sessions, delay = 0 }) {
  const result = useMemo(() => computeResult(sessions), [sessions]);

  const message = result.reason === 'degenerate'
    ? DEGENERATE_MESSAGE[result.which]
    : 'Not enough data yet — this needs at least four active days.';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px 20px 16px' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 16 }}>
          Why the bill moved<InfoTip term="driver decomposition" />
        </div>

        {result.reason !== 'ok' ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>{message}</span>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              {result.w.beforeFrom} – {result.w.beforeTo} compared with {result.w.afterFrom} – {result.w.afterTo}.
              Total change {formatCost(result.total)}.
            </div>

            {result.orderSensitive && (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--hot)', background: 'rgba(255,106,0,0.08)', border: '1px solid rgba(255,106,0,0.25)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
                These periods differ too much for the attribution order to be ignored:
                a different factor order would tell a different story. Treat the split
                between factors as indicative, not exact — the total is still right.
              </div>
            )}

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0 8px', borderBottom: '1px solid var(--color-border)' }}>Factor</th>
                  <th style={{ textAlign: 'right', fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0 8px', borderBottom: '1px solid var(--color-border)' }}>Before</th>
                  <th style={{ textAlign: 'right', fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0 8px', borderBottom: '1px solid var(--color-border)' }}>After</th>
                  <th style={{ textAlign: 'right', fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 0 8px', borderBottom: '1px solid var(--color-border)' }}>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {FACTOR_KEYS.map(k => (
                  <tr key={k} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                    <td style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text)', padding: '9px 0' }}>
                      {LABELS[k]}<InfoTip term={TERMS[k]} />
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-text-secondary)', padding: '9px 0' }}>{formatFactorValue(k, result.before[k])}</td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-text-secondary)', padding: '9px 0' }}>{formatFactorValue(k, result.after[k])}</td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: result.contributions[k] >= 0 ? 'var(--color-cost)' : 'var(--mint)', padding: '9px 0' }}>
                      {formatCost(result.contributions[k])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {result.before.excludedCost + result.after.excludedCost > 0 && (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.5, paddingTop: 10 }}>
                {formatCost(result.before.excludedCost + result.after.excludedCost)} excluded:
                only Claude Code records the user turns this breakdown needs.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
