export default function SlidePanel({ open, onClose, children }) {
  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          backgroundColor: 'rgba(0,0,0,0.4)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          zIndex: 50,
          width: 320,
          padding: 24,
          overflowY: 'auto',
          backgroundColor: 'var(--color-card)',
          borderLeft: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            DETAIL
          </h3>
          <button
            onClick={onClose}
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 18,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
