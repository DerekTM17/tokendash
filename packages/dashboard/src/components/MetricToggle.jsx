// Compact $/TOK segmented control shared by the breakdown panels.
export default function MetricToggle({ metric, setMetric }) {
  const opts = [['cost', '$'], ['tokens', 'TOK']];
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, background: 'rgba(0,180,255,0.06)', border: '1px solid var(--color-border)' }}>
      {opts.map(([val, label]) => {
        const on = metric === val;
        return (
          <button
            key={val}
            onClick={() => setMetric(val)}
            style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
              padding: '3px 9px', borderRadius: 4, border: 'none', cursor: 'pointer',
              color: on ? 'var(--void)' : 'var(--color-text-muted)',
              background: on ? 'var(--cyan)' : 'transparent',
              boxShadow: on ? '0 0 10px rgba(0,180,255,0.45)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
