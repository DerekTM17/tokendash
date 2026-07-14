import { useMemo, useState } from 'react';
import { formatCost, formatTokens } from '../lib/format';
import MetricToggle from './MetricToggle';

// A small glowing palette cycled across whatever models show up.
const PALETTE = ['#5cc8ff', '#ff8a3d', '#b48cff', '#34e6a4', '#ffd23d', '#ff6ea9', '#6ad0c0', '#9a8cff'];

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

function groupByModel(sessions) {
  const map = {};
  sessions.forEach(s => {
    const m = s.model || 'unknown';
    if (!map[m]) map[m] = { model: m, cost: 0, tokens: 0, sessions: 0 };
    map[m].cost += s.cost || 0;
    map[m].tokens += tokensOf(s);
    map[m].sessions += 1;
  });
  return Object.values(map);
}

export default function ModelBreakdown({ sessions, delay = 0 }) {
  const [metric, setMetric] = useState('cost');
  const data = useMemo(() => groupByModel(sessions), [sessions]);
  const sorted = useMemo(() => [...data].sort((a, b) => b[metric] - a[metric]), [data, metric]);
  const max = sorted.length > 0 ? Math.max(...sorted.map(d => d[metric]), 1) : 1;
  const fmt = metric === 'cost' ? formatCost : formatTokens;
  const valueColor = metric === 'cost' ? 'var(--color-cost)' : 'var(--cyan)';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            By model
          </div>
          <MetricToggle metric={metric} setMetric={setMetric} />
        </div>
        {sorted.length === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sorted.map((d, i) => {
              const c = PALETTE[i % PALETTE.length];
              return (
                <div key={d.model}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.model}</span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{d.sessions}</span>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: valueColor, minWidth: 62, textAlign: 'right' }}>{fmt(d[metric])}</span>
                    </div>
                  </div>
                  <div style={{ height: 2, width: '100%', background: 'rgba(0,180,255,0.07)', borderRadius: 2 }}>
                    <div style={{ height: 2, width: `${Math.max((d[metric] / max) * 100, 2)}%`, background: c, borderRadius: 2, boxShadow: `0 0 7px ${c}`, transition: 'width 0.4s ease-out' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
