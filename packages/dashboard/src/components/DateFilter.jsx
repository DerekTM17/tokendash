import { useState } from 'react';

const options = [
  { label: 'All', value: 'all' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
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
    <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 8 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => handleChange(o.value)}
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: selected === o.value ? 500 : 400,
            color: selected === o.value ? '#fff' : 'rgba(255,255,255,0.5)',
            background: selected === o.value ? 'rgba(255,255,255,0.12)' : 'transparent',
            border: 'none',
            borderRadius: 6,
            padding: '5px 12px',
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
