import { useMemo } from 'react';
import { formatCost } from '../lib/format';

function groupByProject(sessions) {
  const map = {};
  sessions.forEach(s => {
    const proj = s.project || 'other';
    if (!map[proj]) map[proj] = { project: proj, cost: 0, tokens: 0, sessions: 0 };
    map[proj].cost += s.cost || 0;
    map[proj].tokens += s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
    map[proj].sessions += 1;
  });
  return Object.values(map).sort((a, b) => b.cost - a.cost);
}

export default function ProjectBreakdown({ sessions }) {
  const data = useMemo(() => groupByProject(sessions), [sessions]);
  const maxCost = data.length > 0 ? Math.max(...data.map(d => d.cost), 1) : 1;

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>BY PROJECT</h3>
      {data.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No data</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {data.map(d => (
            <div key={d.project} className="p-2 rounded" style={{ backgroundColor: 'var(--bg-chart)' }}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{d.project}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{formatCost(d.cost)}</span>
              </div>
              <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
                <div className="h-2 rounded-full" style={{ width: `${(d.cost / maxCost) * 100}%`, backgroundColor: 'var(--accent)', opacity: 0.7 }} />
              </div>
              <div className="flex justify-between mt-1" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                <span>{d.sessions} session{d.sessions !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
