import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

function groupByDay(sessions) {
  const map = {};
  sessions.forEach(s => {
    if (!s.startedAt) return;
    const day = s.startedAt.slice(0, 10);
    if (!map[day]) map[day] = { day, tokens: 0, cost: 0 };
    map[day].tokens += s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
    map[day].cost += s.cost || 0;
  });
  return Object.values(map).sort((a, b) => a.day.localeCompare(b.day));
}

export default function UsageChart({ sessions }) {
  const data = useMemo(() => groupByDay(sessions), [sessions]);

  if (data.length === 0) {
    return (
      <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p style={{ color: 'var(--text-muted)' }}>No data</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>USAGE OVER TIME</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
          <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }} />
          <Area type="monotone" dataKey="tokens" stroke="var(--accent)" fill="url(#tokenGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
