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
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 16, letterSpacing: '-0.01em' }}>
          By project
        </div>
        {data.length === 0 ? (
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.map(d => (
              <div key={d.project} onClick={() => onSelect?.(d.project)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{d.project}</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: 'var(--color-text-muted)' }}>{d.sessions}</span>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--color-accent)', minWidth: 56, textAlign: 'right' }}>
                      {formatCost(d.cost)}
                    </span>
                  </div>
                </div>
                <div style={{ height: 1, width: '100%', background: 'var(--color-border-light)' }}>
                  <div
                    style={{
                      height: 1,
                      width: `${Math.max((d.cost / max) * 100, 4)}%`,
                      background: 'var(--color-accent)',
                      transition: 'width 0.5s ease-out',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
