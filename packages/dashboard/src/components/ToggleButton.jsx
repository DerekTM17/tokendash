/** Small segmented-control button used by the chart panels' metric toggles. */
export default function ToggleButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '4px 12px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--void)' : 'var(--color-text-secondary)',
        background: active ? 'var(--cyan)' : 'transparent',
        boxShadow: active ? '0 0 14px rgba(0,180,255,0.5)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}
