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
          backgroundColor: 'rgba(1,5,9,0.66)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        className="animate-in"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          zIndex: 50,
          width: 340,
          padding: 24,
          overflowY: 'auto',
          background: 'var(--void-light)',
          borderLeft: '1px solid var(--border-active, rgba(0,180,255,0.4))',
          boxShadow: '-24px 0 60px -20px rgba(0,180,255,0.35)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 className="hud-label" style={{ fontSize: 10, color: 'var(--cyan)' }}>
            ▸ DETAIL
          </h3>
          <button
            onClick={onClose}
            style={{
              fontFamily: "var(--f-body)",
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
