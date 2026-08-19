import { useMemo } from 'react';
import { formatCost, formatTokens, formatDate } from '../lib/format';
import InfoTip from './InfoTip';

const TOOL_COLORS = { claude: '#5cc8ff', opencode: '#b48cff', codex: '#34e6a4' };

export default function ExpensiveSessions({ sessions, delay = 0, limit = 8, onSelect }) {
  const top = useMemo(
    () => [...sessions].sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, limit),
    [sessions, limit]
  );

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 16 }}>
          Top sessions by cost<InfoTip term="Top sessions by cost" />
        </div>
        {top.length === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {top.map((s, i) => {
              const c = TOOL_COLORS[s.tool] || 'var(--color-text-muted)';
              const toks = s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
              return (
                <div
                  key={s.id}
                  className="row-zen"
                  onClick={() => onSelect?.(s)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', margin: '0 -10px', borderRadius: 6, cursor: 'pointer' }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 18, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 7px ${c}`, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.project}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.model} · {formatDate(s.startedAt)}
                    </div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', flexShrink: 0, textAlign: 'right', minWidth: 52 }}>{formatTokens(toks)}</span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-cost)', flexShrink: 0, textAlign: 'right', minWidth: 64 }}>
                    {s.costEstimated ? '~' : ''}{formatCost(s.cost)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
