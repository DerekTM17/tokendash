import { useState, useMemo } from 'react';
import { useTheme } from './hooks/useTheme';
import { useTokenData } from './hooks/useTokenData';
import SummaryCards from './components/SummaryCards';
import UsageChart from './components/UsageChart';
import ToolBreakdown from './components/ToolBreakdown';
import ProjectBreakdown from './components/ProjectBreakdown';
import SessionsTable from './components/SessionsTable';
import DateFilter, { filterSessions } from './components/DateFilter';
import SlidePanel from './components/SlidePanel';
import SessionDetail from './components/SessionDetail';

export default function App() {
  const { theme, toggle } = useTheme();
  const { data, error } = useTokenData();
  const [dateRange, setDateRange] = useState('all');
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  const filtered = useMemo(() => {
    if (!data?.sessions) return [];
    return filterSessions(data.sessions, dateRange);
  }, [data, dateRange]);

  const filteredTotals = useMemo(() => {
    if (filtered.length === 0) return null;
    return filtered.reduce(
      (acc, s) => ({
        cost: acc.cost + (s.cost || 0),
        tokens: acc.tokens + s.inputTokens + s.outputTokens + (s.cacheReadTokens || 0) + (s.cacheWriteTokens || 0),
        sessions: acc.sessions + 1,
      }),
      { cost: 0, tokens: 0, sessions: 0 }
    );
  }, [filtered]);

  const panelOpen = !!selectedSession || !!selectedGroup;
  const closePanel = () => {
    setSelectedSession(null);
    setSelectedGroup(null);
  };

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div className="animate-in" style={{ textAlign: 'center', maxWidth: 360 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
            No data available
          </h2>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            Run <code style={{ background: 'var(--color-detail-bg)', padding: '2px 8px', borderRadius: 4, fontSize: 13, color: 'var(--color-text)' }}>npm run ingest</code> to generate tokens.json
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-theme={theme} style={{ fontFamily: "'DM Sans', sans-serif", background: 'var(--color-bg)', minHeight: '100vh' }}>
      <header style={{ background: 'var(--color-header)', padding: '36px 24px 0' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 500, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1 }}>
              TokenDash
            </h1>
            <DateFilter onChange={setDateRange} />
          </div>
          <button
            onClick={toggle}
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              color: 'rgba(255,255,255,0.65)',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px 80px' }}>
        <div style={{ marginTop: 32, marginBottom: 24 }}>
          <SummaryCards totals={filteredTotals} delay={0} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <UsageChart sessions={filtered} delay={200} />
            <SessionsTable sessions={filtered} delay={500} onSelect={setSelectedSession} />
          </div>
          <div className="lg:col-span-4 space-y-6">
            <ToolBreakdown sessions={filtered} delay={300} onSelect={(tool) => setSelectedGroup({ type: 'tool', value: tool, sessions: filtered.filter(s => s.tool === tool) })} />
            <ProjectBreakdown sessions={filtered} delay={400} onSelect={(proj) => setSelectedGroup({ type: 'project', value: proj, sessions: filtered.filter(s => s.project === proj) })} />
          </div>
        </div>
      </main>

      <SlidePanel open={panelOpen} onClose={closePanel}>
        {selectedSession && (
          <SessionDetail session={selectedSession} />
        )}
        {selectedGroup && (
          <div>
            <div className="mb-4" style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {selectedGroup.type === 'tool' ? 'Tool' : 'Project'}
            </div>
            <div className="mb-4" style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
              {selectedGroup.value}
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 2 }}>
              {selectedGroup.sessions.length} session{selectedGroup.sessions.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--color-accent)' }}>
              ${(selectedGroup.sessions.reduce((sum, s) => sum + (s.cost || 0), 0)).toFixed(2)}
            </div>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
