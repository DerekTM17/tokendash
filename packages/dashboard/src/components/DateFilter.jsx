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
    <div style={{ display: 'flex', gap: 3, padding: 3, background: 'rgba(0,180,255,0.06)', border: '1px solid var(--color-border)', borderRadius: 7 }}>
      {options.map(o => {
        const on = selected === o.value;
        return (
          <button
            key={o.value}
            onClick={() => handleChange(o.value)}
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: on ? 'var(--void)' : 'var(--color-text-muted)',
              background: on ? 'var(--cyan)' : 'transparent',
              boxShadow: on ? '0 0 12px rgba(0,180,255,0.45)' : 'none',
              border: 'none',
              borderRadius: 5,
              padding: '5px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
