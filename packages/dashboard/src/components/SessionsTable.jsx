import { useMemo } from 'react';
import { formatCost, formatTokens, formatDate } from '../lib/format';

export default function SessionsTable({ sessions, delay = 0, onSelect }) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0)),
    [sessions]
  );

  const headers = ['Date', 'Tool', 'Project', 'Model', 'Tokens', 'Cost'];

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px' }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
            Recent sessions
          </div>
        </div>
        {sorted.length === 0 ? (
          <div style={{ padding: '24px 20px 32px', textAlign: 'center' }}>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'var(--color-text-muted)' }}>No sessions yet</span>
          </div>
        ) : (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  {headers.map(h => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '10px 20px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <tr
                    key={s.id}
                    className="row-zen"
                    style={{ borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer' }}
                    onClick={() => onSelect?.(s)}
                  >
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {formatDate(s.startedAt)}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                      {s.tool}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                      {s.project}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {s.model}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, color: 'var(--color-text)' }}>
                      {formatTokens(s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0))}
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--color-accent)' }}>
                      {formatCost(s.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
