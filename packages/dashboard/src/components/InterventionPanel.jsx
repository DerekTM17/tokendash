import { useMemo } from 'react';
import { evaluate } from '../lib/intervention.js';
import { TERMS } from './DriverDecomposition.jsx';
import InfoTip from './InfoTip.jsx';

// Re-exported so `test/InterventionPanel.test.jsx` can assert every value this
// panel dynamically hands to InfoTip (`term={TERMS[iv.expect]}` below) resolves
// in the glossary. `glossary.test.js`'s repo-wide scan only sees a literal
// term prop written as a quoted string, so a dynamic lookup like this one is
// invisible to it — see DriverDecomposition.jsx, which defines this same map
// for the same reason.
export { TERMS };

/** Human label for a declared factor. Falls back to the raw key so a factor
 *  name this panel doesn't recognise still shows up rather than vanishing. */
const FACTOR_LABELS = {
  activeDays: 'active days',
  turnsPerActiveDay: 'turns per active day',
  requestsPerTurn: 'requests per turn',
  tokensPerRequest: 'tokens per request',
  pricePerToken: 'price per token',
};

const VERDICT_LABEL = {
  supported: 'Supported',
  'not-supported': 'Not supported',
  provisional: 'Provisional',
  underpowered: 'Underpowered',
  pending: 'Pending',
  confounded: 'Confounded',
  refused: 'Refused',
};

// good / muted / warn, expressed as the house custom properties rather than
// the class names of the same name in the task sketch — those classes don't
// exist in index.css and must not be introduced.
const TONE = {
  supported: 'var(--mint)',
  'not-supported': 'var(--color-text-muted)',
  provisional: 'var(--color-text-muted)',
  underpowered: 'var(--color-text-muted)',
  pending: 'var(--color-text-muted)',
  confounded: 'var(--hot)',
  refused: 'var(--hot)',
};

/**
 * "Did that change work?" for interventions declared in advance.
 *
 * The panel never invents a headline number for a verdict `evaluate()`
 * couldn't defend: `refused` and `confounded` render as the reasons that
 * blocked the comparison, not as a number with an asterisk. Those verdicts are
 * the tool working, not a failure to report around — the copy here is written
 * to make that legible to someone who has never run this analysis before.
 */
export default function InterventionPanel({ sessions, interventions = [], today, delay = 0 }) {
  const results = useMemo(
    () => interventions.map(iv => ({
      iv,
      // A frozen result (see mergeResults in packages/ingest/src/interventions.js)
      // is a record of what was true before the before-window aged out of
      // retention — prefer it over re-deriving a now-unrecoverable number.
      result: iv.result || evaluate(sessions, iv, { today, others: interventions }),
    })),
    [sessions, interventions, today],
  );

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px 20px 16px' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 16 }}>
          Did it work?<InfoTip term="intervention" />
        </div>

        {results.length === 0 ? (
          <div style={{ padding: '8px 0 28px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, margin: '0 auto', maxWidth: 460 }}>
              Nothing declared yet. Copy <code style={{ fontFamily: 'var(--f-mono)' }}>interventions.example.json</code> to{' '}
              <code style={{ fontFamily: 'var(--f-mono)' }}>interventions.json</code>, name the change you made,
              the date it took effect, and the one factor you expect it to move — then re-run ingest.
              Writing the prediction down before you look at the result is the whole point: with five
              factors and two directions there are ten ways to find a flattering story after the fact,
              so a factor picked afterwards would prove nothing.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {results.map(({ iv, result }) => (
              <article key={iv.date + iv.label} style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
                  <h3 style={{ fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                    {iv.label}
                  </h3>
                  <span style={{ fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 700, color: TONE[result.verdict] || 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center' }}>
                    {VERDICT_LABEL[result.verdict] || result.verdict}
                    <InfoTip term="verdict" />
                  </span>
                </div>

                <p style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
                  {iv.date} — predicted to move {FACTOR_LABELS[iv.expect] || iv.expect}
                  <InfoTip term={TERMS[iv.expect]} />
                </p>

                {iv.result && (
                  <p style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic', margin: '0 0 8px' }}>
                    Frozen {iv.result.frozenAt} — a record of what was true before older
                    sessions aged out, not a live number.
                  </p>
                )}

                <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  {(result.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>

                {result.confounds?.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    {result.confounds.map((c, i) => (
                      <li key={i}>
                        {c.dimension} / {c.category}
                        {typeof c.delta === 'number' && c.delta !== 0
                          ? ` shifted ${Math.abs(c.delta * 100).toFixed(1)} points`
                          : ' overlaps this window'}
                        {c.expected ? ' — pre-registered, not counted against the result' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
