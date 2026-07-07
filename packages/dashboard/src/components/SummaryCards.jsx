import { formatCost, formatTokens } from '../lib/format';

export default function SummaryCards({ totals }) {
  if (!totals) return null;

  return (
    <div className="flex gap-3">
      {[
        { label: 'TOTAL COST', value: formatCost(totals.cost) },
        { label: 'TOKENS', value: formatTokens(totals.tokens) },
        { label: 'SESSIONS', value: String(totals.sessions) },
      ].map(card => (
        <div
          key={card.label}
          className="flex-1 p-4 rounded-lg"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{card.label}</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
