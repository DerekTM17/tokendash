import { useState, useMemo } from 'react';
import { useTheme } from './hooks/useTheme';
import { useTokenData } from './hooks/useTokenData';
import SummaryCards from './components/SummaryCards';
import UsageChart from './components/UsageChart';
import ToolBreakdown from './components/ToolBreakdown';
import ProjectBreakdown from './components/ProjectBreakdown';
import SessionsTable from './components/SessionsTable';
import SlidePanel from './components/SlidePanel';
import DateFilter, { filterSessions } from './components/DateFilter';
import { formatCost, formatTokens, formatDate } from './lib/format';

export default function App() {
  const { theme, toggle } = useTheme();
  const { data, error } = useTokenData();
  const [dateRange, setDateRange] = useState('all');
  const [panelSession, setPanelSession] = useState(null);

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

  if (error) {
    return (
      <div data-theme={theme} className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div className="text-center p-8 rounded-lg" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--accent)' }}>No Data Available</h2>
          <p style={{ color: 'var(--text-muted)' }}>Run <code>npm run ingest</code> to generate tokens.json</p>
        </div>
      </div>
    );
  }

  return (
    <div data-theme={theme} className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <header className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>TokenDash</h1>
          <DateFilter onChange={setDateRange} />
        </div>
        <button
          onClick={toggle}
          className="text-sm px-3 py-1 rounded cursor-pointer"
          style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}
        >
          {theme === 'dark' ? 'Amber' : 'Dark'}
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-4">
        <SummaryCards totals={filteredTotals} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <UsageChart sessions={filtered} />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <ToolBreakdown sessions={filtered} />
            <ProjectBreakdown sessions={filtered} />
          </div>
        </div>

        <SessionsTable sessions={filtered} onSessionClick={setPanelSession} />
      </main>

      <SlidePanel open={!!panelSession} onClose={() => setPanelSession(null)}>
        {panelSession && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              {[['Tool', panelSession.tool], ['Project', panelSession.project], ['Model', panelSession.model]].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)' }}>{value}</div>
                </div>
              ))}
            </div>
            <hr style={{ borderColor: 'var(--border)' }} />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Input', formatTokens(panelSession.inputTokens)],
                ['Output', formatTokens(panelSession.outputTokens)],
                ['Cache Read', formatTokens(panelSession.cacheReadTokens || 0)],
                ['Cache Write', formatTokens(panelSession.cacheWriteTokens || 0)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)' }}>{value}</div>
                </div>
              ))}
            </div>
            <hr style={{ borderColor: 'var(--border)' }} />
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Cost', formatCost(panelSession.cost)],
                ['Started', formatDate(panelSession.startedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ color: 'var(--text-primary)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
