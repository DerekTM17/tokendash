import { useMemo } from 'react';
import { formatCost, formatTokens } from '../lib/format';

const PALETTE = ['#5cc8ff', '#ff8a3d', '#b48cff', '#34e6a4', '#ffd23d', '#ff6ea9', '#6ad0c0', '#9a8cff'];

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

export default function ModelEfficiency({ sessions, delay = 0 }) {
  const rows = useMemo(() => {
    const map = {};
    sessions.forEach(s => {
      const m = s.model || 'unknown';
      if (!map[m]) map[m] = { model: m, cost: 0, tokens: 0, sessions: 0 };
      map[m].cost += s.cost || 0;
      map[m].tokens += tokensOf(s);
      map[m].sessions += 1;
    });
    return Object.values(map)
      .map(d => ({
        ...d,
        perSession: d.sessions ? d.cost / d.sessions : 0,
        tokensPerDollar: d.cost ? d.tokens / d.cost : null,
      }))
      .sort((a, b) => b.perSession - a.perSession);
  }, [sessions]);

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 4 }}>
          Model efficiency
        </div>
        <div className="hud-label" style={{ fontSize: 8.5, color: 'var(--color-text-muted)', marginBottom: 14 }}>
          cost per session · tokens per dollar
        </div>
        {rows.length === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 16px', alignItems: 'center' }}>
              <span className="hud-label" style={{ fontSize: 8.5, color: 'var(--color-text-muted)' }}>model</span>
              <span className="hud-label" style={{ fontSize: 8.5, color: 'var(--color-text-muted)', textAlign: 'right' }}>$/sess</span>
              <span className="hud-label" style={{ fontSize: 8.5, color: 'var(--color-text-muted)', textAlign: 'right' }}>tok/$</span>
            </div>
            <div style={{ height: 1, background: 'var(--color-border-light)', margin: '8px 0 4px' }} />
            {rows.map((d, i) => (
              <div key={d.model} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0 16px', alignItems: 'baseline', padding: '7px 0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: PALETTE[i % PALETTE.length], boxShadow: `0 0 7px ${PALETTE[i % PALETTE.length]}`, flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.model}</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-cost)', textAlign: 'right' }}>
                  {formatCost(d.perSession)}
                </span>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--cyan)', textAlign: 'right' }}>
                  {d.tokensPerDollar == null ? '—' : formatTokens(d.tokensPerDollar)}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
