import { useMemo } from 'react';
import { formatCost, formatTokens } from '../lib/format';
import { dataCoverage, coverageWindow } from '../lib/coverage';

function tokensOf(s) {
  return s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0);
}

const shortDay = day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

export default function MetricsStrip({ sessions, delay = 0 }) {
  const m = useMemo(() => {
    if (!sessions.length) return null;
    let cost = 0, tokens = 0, cacheCost = 0, attributed = 0;
    for (const s of sessions) {
      cost += s.cost || 0;
      tokens += tokensOf(s);
      if (s.costParts) cacheCost += s.costParts.cacheRead + s.costParts.cacheWrite;
      if (s.project && s.project !== 'other') attributed += 1;
    }

    // Rates are scoped to the window the record actually covers. Spanning from
    // the earliest session of ANY tool padded the denominator with weeks that
    // hold almost nothing, and counted that stray spend in the numerator as
    // though it belonged to the window — see lib/coverage.js.
    const coverage = dataCoverage(sessions);
    const window = coverageWindow(sessions, coverage);
    const perDay = window ? window.cost / window.days : 0;

    return {
      burn: perDay,
      projected: perDay * 30,
      cachePct: cost ? (cacheCost / cost) * 100 : 0,
      tokensPerDollar: cost ? tokens / cost : 0,
      coverage: (attributed / sessions.length) * 100,
      since: coverage ? window?.start : null,
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
    <div>
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
      {m.since && (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.5, paddingTop: 8 }}>
          Rates cover the record since {shortDay(m.since)}, and the totals above are
          the sum of what survives — not a lifetime figure. Claude Code deleted
          transcripts older than 30 days until retention was raised on Jul 27, so
          spend before that date is unrecoverable, not zero.
        </div>
      )}
    </div>
  );
}
