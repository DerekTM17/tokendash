export default function SlidePanel({ open, onClose, children }) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} />
      <div
        className="fixed top-0 right-0 h-full z-50 w-80 p-6 overflow-y-auto"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold" style={{ color: 'var(--accent)' }}>DETAIL</h3>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }} className="text-lg">&times;</button>
        </div>
        {children}
      </div>
    </>
  );
}
