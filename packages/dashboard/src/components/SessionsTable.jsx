import { useMemo } from 'react';
import { formatCost, formatTokens, formatDate } from '../lib/format';

export default function SessionsTable({ sessions, onSessionClick }) {
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0)),
    [sessions]
  );

  if (sorted.length === 0) {
    return (
      <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p style={{ color: 'var(--text-muted)' }}>No sessions yet</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>RECENT SESSIONS</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Date', 'Tool', 'Project', 'Model', 'Tokens', 'Cost'].map(h => (
                <th key={h} className="text-left p-2 text-xs" style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr
                key={s.id}
                className="cursor-pointer"
                onClick={() => onSessionClick?.(s)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: i % 2 === 0 ? 'var(--table-stripe)' : 'transparent',
                }}
              >
                <td className="p-2" style={{ color: 'var(--text-muted)' }}>{formatDate(s.startedAt)}</td>
                <td className="p-2" style={{ color: 'var(--text-primary)' }}>{s.tool}</td>
                <td className="p-2" style={{ color: 'var(--text-primary)' }}>{s.project}</td>
                <td className="p-2" style={{ color: 'var(--text-muted)', fontSize: 11 }}>{s.model}</td>
                <td className="p-2" style={{ color: 'var(--text-primary)' }}>{formatTokens(s.inputTokens + s.outputTokens)}</td>
                <td className="p-2 font-bold" style={{ color: 'var(--accent)' }}>{formatCost(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
