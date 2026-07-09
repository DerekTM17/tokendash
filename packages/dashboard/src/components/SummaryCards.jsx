import { formatCost, formatTokens } from '../lib/format';

export default function SummaryCards({ totals, delay = 0 }) {
  if (!totals) return null;

  const cards = [
    { label: 'Total cost', value: formatCost(totals.cost) },
    { label: 'Tokens', value: formatTokens(totals.tokens) },
    { label: 'Sessions', value: String(totals.sessions) },
  ];

  return (
    <div className="flex gap-4" style={{ animationDelay: `${delay}ms` }}>
      {cards.map(card => (
        <div key={card.label} className="flex-1 animate-in">
          <div
            style={{
              background: 'var(--color-card)',
              borderRadius: 14,
              border: '1px solid var(--color-border)',
              padding: '20px 24px',
            }}
          >
            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 36,
                fontWeight: 600,
                color: 'var(--color-text)',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
              }}
            >
              {card.value}
            </div>
            <div
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--color-border-light)',
              }}
            >
              {card.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
