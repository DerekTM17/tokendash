import { useTheme } from './hooks/useTheme';

export default function App() {
  const { theme, toggle } = useTheme();

  return (
    <div data-theme={theme} className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>TokenDash</h1>
        <button onClick={toggle} className="text-sm px-3 py-1 rounded" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
          {theme === 'dark' ? 'Amber' : 'Dark'}
        </button>
      </header>
    </div>
  );
}
