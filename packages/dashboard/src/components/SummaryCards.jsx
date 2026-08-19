import { formatCost, formatTokens } from '../lib/format';
import InfoTip from './InfoTip';

export default function SummaryCards({ totals, delay = 0 }) {
  if (!totals) return null;

  const cards = [
    { key: 'COST', label: 'total cost', value: formatCost(totals.cost), color: 'var(--color-cost)', glow: 'rgba(255,138,61,0.5)' },
    { key: 'TOK', label: 'tokens', value: formatTokens(totals.tokens), color: 'var(--cyan)', glow: 'rgba(0,180,255,0.5)' },
    { key: 'SESS', label: 'sessions', value: String(totals.sessions), color: 'var(--color-text)', glow: 'rgba(0,180,255,0.35)' },
  ];

  return (
    <div className="flex gap-4" style={{ animationDelay: `${delay}ms` }}>
      {cards.map(card => (
        <div key={card.label} className="flex-1 animate-in">
          <div
            className="bracket"
            style={{
              background: 'var(--color-card)',
              borderRadius: 12,
              border: '1px solid var(--color-border)',
              padding: '22px 24px 20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div className="hud-label" style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              {card.key}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 38,
                fontWeight: 600,
                color: card.color,
                lineHeight: 1,
                letterSpacing: '-0.01em',
                textShadow: `0 0 22px ${card.glow}`,
              }}
            >
              {card.value}
            </div>
            <div
              className="hud-label"
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--color-border-light)',
              }}
            >
              {card.label}
              <InfoTip term={card.label} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
