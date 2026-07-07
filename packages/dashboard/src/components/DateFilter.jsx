import { useState } from 'react';

const options = [
  { label: 'All time', value: 'all' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
];

export function filterSessions(sessions, range) {
  if (range === 'all') return sessions;
  const days = parseInt(range);
  const cutoff = new Date(Date.now() - days * 86400000);
  return sessions.filter(s => s.startedAt && new Date(s.startedAt) >= cutoff);
}

export default function DateFilter({ onChange }) {
  const [selected, setSelected] = useState('all');

  const handleChange = (value) => {
    setSelected(value);
    onChange(value);
  };

  return (
    <div className="flex gap-2">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => handleChange(o.value)}
          className="text-xs px-3 py-1 rounded"
          style={{
            backgroundColor: selected === o.value ? 'var(--accent)' : 'var(--bg-card)',
            color: selected === o.value ? 'var(--bg-primary)' : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
