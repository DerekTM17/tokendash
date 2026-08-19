import { useMemo } from 'react';
import { formatCost } from '../lib/format';
import { PARTS } from '../lib/costParts';
import InfoTip from './InfoTip';

export default function CostComposition({ sessions, delay = 0 }) {
  const { agg, total } = useMemo(() => {
    const a = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    sessions.forEach(s => {
      const p = s.costParts;
      if (!p) return;
      a.input += p.input; a.output += p.output; a.cacheRead += p.cacheRead; a.cacheWrite += p.cacheWrite;
    });
    return { agg: a, total: a.input + a.output + a.cacheRead + a.cacheWrite };
  }, [sessions]);

  const rows = PARTS.map(p => ({ ...p, value: agg[p.key], pct: total ? (agg[p.key] / total) * 100 : 0 }));

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Where the cost goes<InfoTip term="Where the cost goes" />
          </div>
          <span className="mono" style={{ fontSize: 12, color: 'var(--color-cost)', fontWeight: 600 }}>{formatCost(total)}</span>
        </div>

        {total === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <>
            {/* stacked composition bar */}
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--color-border)', marginBottom: 18 }}>
              {rows.filter(r => r.pct > 0).map(r => (
                <div
                  key={r.key}
                  title={`${r.label}: ${formatCost(r.value)} (${r.pct.toFixed(1)}%)`}
                  style={{ width: `${r.pct}%`, background: r.color, boxShadow: `inset 0 0 10px ${r.color}` }}
                />
              ))}
            </div>

            {/* legend / readout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
              {rows.map(r => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, boxShadow: `0 0 8px ${r.color}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{r.label}<InfoTip term={r.label} /></span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.pct.toFixed(1)}%</span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>{formatCost(r.value)}</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
