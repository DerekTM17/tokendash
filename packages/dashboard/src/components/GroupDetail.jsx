import { useMemo, useState } from 'react';
import { formatCost, formatTokens } from '../lib/format';
import MetricToggle from './MetricToggle';

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

function groupByModel(sessions) {
  const map = {};
  sessions.forEach(s => {
    const model = s.model || 'unknown';
    if (!map[model]) map[model] = { model, cost: 0, tokens: 0, sessions: 0 };
    map[model].cost += s.cost || 0;
    map[model].tokens += tokensOf(s);
    map[model].sessions += 1;
  });
  return Object.values(map);
}

// Per-model breakdown for the group slide panel (a project or tool's sessions).
// Defaults to the tokens metric — "which models, how many tokens" is the
// question this panel answers; cost is one toggle away.
export default function GroupDetail({ sessions }) {
  const [metric, setMetric] = useState('tokens');
  const sorted = useMemo(
    () => groupByModel(sessions).sort((a, b) => b[metric] - a[metric]),
    [sessions, metric]
  );
  if (sorted.length === 0) return null;

  const max = Math.max(...sorted.map(d => d[metric]), 1);
  const fmt = metric === 'cost' ? formatCost : formatTokens;
  const subFmt = metric === 'cost' ? formatTokens : formatCost;
  const valueColor = metric === 'cost' ? 'var(--color-cost)' : 'var(--cyan)';

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="hud-label" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          ▸ BY MODEL
        </div>
        <MetricToggle metric={metric} setMetric={setMetric} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sorted.map(d => {
          const unknown = d.model === 'unknown';
          const bar = unknown ? 'var(--color-text-muted)' : 'var(--glow)';
          return (
            <div key={d.model}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10 }}>
                <span
                  data-testid="group-model-name"
                  className="mono"
                  style={{ fontSize: 12, fontWeight: 500, color: unknown ? 'var(--color-text-muted)' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {d.model}
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {d.sessions} · {subFmt(d[metric === 'cost' ? 'tokens' : 'cost'])}
                  </span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: valueColor, minWidth: 62, textAlign: 'right' }}>
                    {fmt(d[metric])}
                  </span>
                </div>
              </div>
              <div style={{ height: 2, width: '100%', background: 'rgba(0,180,255,0.07)', borderRadius: 2 }}>
                <div
                  style={{
                    height: 2,
                    width: `${Math.max((d[metric] / max) * 100, 2)}%`,
                    background: bar,
                    borderRadius: 2,
                    boxShadow: unknown ? 'none' : '0 0 7px rgba(0,180,255,0.7)',
                    transition: 'width 0.4s ease-out',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
