import { useMemo } from 'react';
import { formatCost, formatTokens, formatDate } from '../lib/format';
import InfoTip from './InfoTip';

const TOOL_COLORS = { claude: '#5cc8ff', opencode: '#b48cff', codex: '#34e6a4' };

export default function SessionsTable({ sessions, delay = 0, onSelect }) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0)),
    [sessions]
  );

  const headers = ['Date', 'Tool', 'Project', 'Model', 'Tokens', 'Cost'];

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 12px' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Recent sessions<InfoTip term="Recent sessions" />
          </div>
        </div>
        {sorted.length === 0 ? (
          <div style={{ padding: '24px 20px 32px', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No sessions yet</span>
          </div>
        ) : (
          <div data-testid="sessions-scroll" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={h}
                      className="hud-label"
                      style={{
                        textAlign: i >= 4 ? 'right' : 'left',
                        padding: '9px 20px',
                        fontSize: 9,
                        color: 'var(--color-text-muted)',
                        // Sticky inside the scroll container; opaque background so
                        // rows slide underneath instead of showing through. The
                        // border moves to box-shadow because table borders don't
                        // travel with sticky cells.
                        position: 'sticky',
                        top: 0,
                        background: 'var(--color-card)',
                        boxShadow: 'inset 0 -1px 0 var(--color-border)',
                        zIndex: 1,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const c = TOOL_COLORS[s.tool] || 'var(--color-text-muted)';
                  return (
                    <tr
                      key={s.id}
                      className="row-zen"
                      style={{ borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer' }}
                      onClick={() => onSelect?.(s)}
                    >
                      <td className="mono" style={{ padding: '11px 20px', fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {formatDate(s.startedAt)}
                      </td>
                      <td style={{ padding: '11px 20px', fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 500 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: c }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, boxShadow: `0 0 6px ${c}` }} />
                          {s.tool}
                        </span>
                      </td>
                      <td style={{ padding: '11px 20px', fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                        {s.projectInferred ? (
                          <span title="Inferred from session content (launched outside a project directory)" style={{ color: 'var(--color-text-secondary)' }}>
                            ~{s.project}
                          </span>
                        ) : s.project}
                      </td>
                      <td className="mono" style={{ padding: '11px 20px', fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                        {s.model}
                      </td>
                      <td className="mono" style={{ padding: '11px 20px', fontSize: 12, fontWeight: 500, color: 'var(--cyan)', textAlign: 'right' }}>
                        {formatTokens(s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0))}
                      </td>
                      <td className="mono" style={{ padding: '11px 20px', fontSize: 13, fontWeight: 600, color: 'var(--color-cost)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span title={s.costEstimated ? 'Estimated from token usage × model pricing' : undefined}>
                          {s.costEstimated ? '~' : ''}{formatCost(s.cost)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
