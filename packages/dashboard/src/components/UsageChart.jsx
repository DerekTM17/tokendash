import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { formatTokens, formatCost } from '../lib/format';

function groupByDayAndTool(sessions) {
  const map = {};
  sessions.forEach(s => {
    if (!s.startedAt) return;
    const day = s.startedAt.slice(0, 10);
    if (!map[day]) {
      map[day] = { day, tokens: 0, cost: 0, claude: 0, opencode: 0, codex: 0, claudeCost: 0, opencodeCost: 0, codexCost: 0, count: 0 };
    }
    const tokens = s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
    map[day].tokens += tokens;
    map[day].cost += s.cost || 0;
    map[day].count += 1;
    const tool = s.tool || 'other';
    if (tool in map[day]) map[day][tool] += tokens;
    if (tool + 'Cost' in map[day]) map[day][tool + 'Cost'] += s.cost || 0;
  });
  return Object.values(map).sort((a, b) => a.day.localeCompare(b.day));
}

const toolNames = ['claude', 'opencode', 'codex'];
const toolColors = { claude: '#5cc8ff', opencode: '#b48cff', codex: '#34e6a4' };

const CustomTooltip = ({ active, payload, label, metric }) => {
  if (!active || !payload?.length) return null;
  const day = payload[0]?.payload;
  if (!day) return null;
  const date = new Date(label + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmt = metric === 'cost' ? formatCost : formatTokens;

  return (
    <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 190 }}>
      <div style={{ fontFamily: "var(--f-body)", fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{date}</div>
      {toolNames.map(tool => {
        const value = metric === 'cost' ? day[tool + 'Cost'] : day[tool];
        if (!value) return null;
        return (
          <div key={tool} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: toolColors[tool], flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--f-body)", fontSize: 11, color: 'var(--color-text)', fontWeight: 500 }}>{tool}</span>
            </div>
            <span style={{ fontFamily: "var(--f-body)", fontSize: 11, color: 'var(--color-text)', fontWeight: 500 }}>{fmt(value)}</span>
          </div>
        );
      })}
      <div style={{ borderTop: '1px solid var(--color-border-light)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: "var(--f-body)", fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>Total</span>
        <span style={{ fontFamily: "var(--f-body)", fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>{fmt(metric === 'cost' ? day.cost : day.tokens)}</span>
      </div>
    </div>
  );
};

const renderLegend = ({ payload }) => (
  <div style={{ display: 'flex', justifyContent: 'center', gap: 20, paddingTop: 4 }}>
    {payload.map((entry, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: entry.color }} />
        <span style={{ fontFamily: "var(--f-body)", fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{entry.value}</span>
      </div>
    ))}
  </div>
);

function ToggleButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '4px 12px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--void)' : 'var(--color-text-secondary)',
        background: active ? 'var(--cyan)' : 'transparent',
        boxShadow: active ? '0 0 14px rgba(0,180,255,0.5)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

export default function UsageChart({ sessions, delay = 0 }) {
  const [metric, setMetric] = useState('tokens');
  const data = useMemo(() => groupByDayAndTool(sessions), [sessions]);
  const fmtAxis = metric === 'cost'
    ? (v => `$${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)}`)
    : formatTokens;
  const keySuffix = metric === 'cost' ? 'Cost' : '';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Usage over time
          </div>
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--color-detail-bg)', border: '1px solid var(--color-border)' }}>
            <ToggleButton active={metric === 'tokens'} onClick={() => setMetric('tokens')}>Tokens</ToggleButton>
            <ToggleButton active={metric === 'cost'} onClick={() => setMetric('cost')}>Cost</ToggleButton>
          </div>
        </div>
        {data.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <span style={{ fontFamily: "var(--f-body)", fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                {toolNames.map(tool => (
                  <linearGradient key={tool} id={`grad_${tool}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={toolColors[tool]} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={toolColors[tool]} stopOpacity={0.06} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border-light)" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: "var(--f-body)" }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                minTickGap={40}
                tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: "var(--f-body)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmtAxis}
                width={48}
              />
              <Tooltip content={<CustomTooltip metric={metric} />} />
              <Legend content={renderLegend} />
              {toolNames.map(tool => (
                <Area
                  key={tool}
                  type="monotone"
                  dataKey={tool + keySuffix}
                  name={tool}
                  stroke={toolColors[tool]}
                  fill={`url(#grad_${tool})`}
                  strokeWidth={1.75}
                  dot={false}
                  stackId="1"
                  isAnimationActive={false}
                  activeDot={{ r: 3.5, fill: toolColors[tool], stroke: 'var(--color-card)', strokeWidth: 2 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
