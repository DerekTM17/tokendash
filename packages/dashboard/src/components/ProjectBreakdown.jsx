import { useMemo } from 'react';
import { formatCost } from '../lib/format';

function groupByProject(sessions) {
  const map = {};
  sessions.forEach(s => {
    const proj = s.project || 'other';
    if (!map[proj]) map[proj] = { project: proj, cost: 0, sessions: 0 };
    map[proj].cost += s.cost || 0;
    map[proj].sessions += 1;
  });
  return Object.values(map).sort((a, b) => b.cost - a.cost);
}

export default function ProjectBreakdown({ sessions, delay = 0, onSelect }) {
  const data = useMemo(() => groupByProject(sessions), [sessions]);
  const max = data.length > 0 ? Math.max(...data.map(d => d.cost), 1) : 1;

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', marginBottom: 18, textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          By project
        </div>
        {data.length === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.map(d => {
              const other = d.project === 'other';
              const c = other ? 'var(--color-text-muted)' : 'var(--glow)';
              return (
                <div key={d.project} onClick={() => onSelect?.(d.project)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10 }}>
                    <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 500, color: other ? 'var(--color-text-muted)' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.project}</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{d.sessions}</span>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-cost)', minWidth: 60, textAlign: 'right' }}>
                        {formatCost(d.cost)}
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 2, width: '100%', background: 'rgba(0,180,255,0.07)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: 2,
                        width: `${Math.max((d.cost / max) * 100, 2)}%`,
                        background: c,
                        borderRadius: 2,
                        boxShadow: other ? 'none' : '0 0 7px rgba(0,180,255,0.7)',
                        transition: 'width 0.5s ease-out',
                      }}
                    />
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
