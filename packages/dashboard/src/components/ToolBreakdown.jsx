import { useMemo, useState } from 'react';
import { formatCost, formatTokens } from '../lib/format';
import MetricToggle from './MetricToggle';
import InfoTip from './InfoTip';

const TOOL_COLORS = { claude: '#5cc8ff', opencode: '#b48cff', codex: '#34e6a4', other: '#7f9cae' };

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

function groupByTool(sessions) {
  const map = {};
  sessions.forEach(s => {
    if (!map[s.tool]) map[s.tool] = { tool: s.tool, cost: 0, tokens: 0 };
    map[s.tool].cost += s.cost || 0;
    map[s.tool].tokens += tokensOf(s);
  });
  return Object.values(map);
}

export default function ToolBreakdown({ sessions, delay = 0, onSelect }) {
  const [metric, setMetric] = useState('cost');
  const data = useMemo(() => groupByTool(sessions), [sessions]);
  const sorted = useMemo(() => [...data].sort((a, b) => b[metric] - a[metric]), [data, metric]);
  const max = sorted.length > 0 ? Math.max(...sorted.map(d => d[metric]), 1) : 1;
  const fmt = metric === 'cost' ? formatCost : formatTokens;
  const valueColor = metric === 'cost' ? 'var(--color-cost)' : 'var(--cyan)';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            By tool<InfoTip term="By tool" />
          </div>
          <MetricToggle metric={metric} setMetric={setMetric} />
        </div>
        {sorted.length === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
            {sorted.map(d => {
              const c = TOOL_COLORS[d.tool] || TOOL_COLORS.other;
              return (
                <div key={d.tool} onClick={() => onSelect?.(d.tool)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />
                      <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{d.tool}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: valueColor }}>{fmt(d[metric])}</span>
                  </div>
                  <div style={{ height: 3, width: '100%', background: 'rgba(0,180,255,0.08)', borderRadius: 2 }}>
                    <div
                      style={{
                        height: 3,
                        width: `${Math.max((d[metric] / max) * 100, 3)}%`,
                        background: c,
                        borderRadius: 2,
                        boxShadow: `0 0 8px ${c}`,
                        transition: 'width 0.4s ease-out',
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
