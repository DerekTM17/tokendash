import { useMemo } from 'react';
import { formatCost, formatTokens } from '../lib/format';

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

export default function MetricsStrip({ sessions, delay = 0 }) {
  const m = useMemo(() => {
    if (!sessions.length) return null;
    let cost = 0, tokens = 0, cacheCost = 0, attributed = 0;
    let minD = Infinity, maxD = -Infinity;
    for (const s of sessions) {
      cost += s.cost || 0;
      tokens += tokensOf(s);
      if (s.costParts) cacheCost += s.costParts.cacheRead + s.costParts.cacheWrite;
      if (s.project && s.project !== 'other') attributed += 1;
      if (s.startedAt) {
        const t = new Date(s.startedAt).getTime();
        if (t < minD) minD = t;
        if (t > maxD) maxD = t;
      }
    }
    const spanDays = maxD > minD ? Math.max(1, Math.round((maxD - minD) / 86400000) + 1) : 1;
    const perDay = cost / spanDays;
    return {
      burn: perDay,
      projected: perDay * 30,
      cachePct: cost ? (cacheCost / cost) * 100 : 0,
      tokensPerDollar: cost ? tokens / cost : 0,
      coverage: (attributed / sessions.length) * 100,
    };
  }, [sessions]);

  if (!m) return null;

  const items = [
    { label: 'burn rate', value: formatCost(m.burn), unit: '/day', color: 'var(--color-cost)' },
    { label: 'projected', value: formatCost(m.projected), unit: '/mo', color: 'var(--color-cost)' },
    { label: 'cache % of cost', value: `${m.cachePct.toFixed(0)}%`, unit: 'read+write', color: 'var(--cyan)' },
    { label: 'tokens / $', value: formatTokens(m.tokensPerDollar), unit: 'per dollar', color: 'var(--cyan)' },
    { label: 'coverage', value: `${m.coverage.toFixed(0)}%`, unit: 'attributed', color: 'var(--mint)' },
  ];

  return (
    <div className="animate-in flex" style={{ gap: 12, animationDelay: `${delay}ms` }}>
      {items.map(it => (
        <div
          key={it.label}
          className="flex-1"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '13px 16px' }}
        >
          <div className="hud-label" style={{ fontSize: 8.5, color: 'var(--color-text-muted)', marginBottom: 8 }}>{it.label}</div>
          <div className="mono" style={{ fontSize: 21, fontWeight: 600, color: it.color, lineHeight: 1 }}>{it.value}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 5, letterSpacing: '0.04em' }}>{it.unit}</div>
        </div>
      ))}
    </div>
  );
}
