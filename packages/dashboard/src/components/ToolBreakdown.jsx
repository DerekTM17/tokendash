import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCost } from '../lib/format';

const TOOL_COLORS = { claude: '#22d3ee', opencode: '#a78bfa', codex: '#34d399' };

function groupByTool(sessions) {
  const map = {};
  sessions.forEach(s => {
    if (!map[s.tool]) map[s.tool] = { tool: s.tool, cost: 0, tokens: 0 };
    map[s.tool].cost += s.cost || 0;
    map[s.tool].tokens += s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
  });
  return Object.values(map).sort((a, b) => b.cost - a.cost);
}

export default function ToolBreakdown({ sessions }) {
  const data = useMemo(() => groupByTool(sessions), [sessions]);

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>BY TOOL</h3>
      <div className="grid grid-cols-1 gap-2 mb-3">
        {data.map(d => (
          <div key={d.tool} className="flex justify-between items-center p-2 rounded" style={{ backgroundColor: 'var(--bg-chart)' }}>
            <span className="text-sm" style={{ color: TOOL_COLORS[d.tool] || 'var(--text-primary)' }}>{d.tool}</span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCost(d.cost)}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="tool" hide />
          <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
            {data.map(d => (<Cell key={d.tool} fill={TOOL_COLORS[d.tool] || 'var(--accent)'} />))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
