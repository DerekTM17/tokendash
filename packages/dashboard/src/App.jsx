import { useState, useMemo, useEffect } from 'react';
import { useTokenData } from './hooks/useTokenData';
import SummaryCards from './components/SummaryCards';
import MetricsStrip from './components/MetricsStrip';
import UsageChart from './components/UsageChart';
import ActivityHeatmap from './components/ActivityHeatmap';
import CostComposition from './components/CostComposition';
import ToolBreakdown from './components/ToolBreakdown';
import ModelBreakdown from './components/ModelBreakdown';
import ModelEfficiency from './components/ModelEfficiency';
import ProjectBreakdown from './components/ProjectBreakdown';
import SessionsTable from './components/SessionsTable';
import ExpensiveSessions from './components/ExpensiveSessions';
import DateFilter, { filterSessions } from './components/DateFilter';
import SlidePanel from './components/SlidePanel';
import SessionDetail from './components/SessionDetail';
import GroupDetail from './components/GroupDetail';

function LiveIndicator({ generated }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = generated ? Math.max(0, Math.round((now - new Date(generated).getTime()) / 1000)) : null;
  const label =
    secs == null ? 'AWAITING SYNC' : secs < 60 ? `SYNC ${secs}S AGO` : `SYNC ${Math.floor(secs / 60)}M AGO`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--mint)', animation: 'livePulse 2s ease-in-out infinite' }} />
      <span className="hud-label" style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
        LIVE · {label}
      </span>
    </div>
  );
}

export default function App() {
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

  const chrome = (
    <>
      <div className="grid-bg" />
      <div className="scanlines" />
      <div className="vignette" />
    </>
  );

  if (error) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        {chrome}
        <div className="animate-in" style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 380 }}>
          <div className="hud-label" style={{ fontSize: 11, color: 'var(--hot)', marginBottom: 14 }}>▸ NO SIGNAL</div>
          <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10, letterSpacing: '0.02em' }}>
            No telemetry found
          </h2>
          <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            Run <code style={{ fontFamily: 'var(--f-mono)', background: 'var(--color-detail-bg)', padding: '2px 8px', borderRadius: 4, fontSize: 13, color: 'var(--cyan)', border: '1px solid var(--color-border)' }}>npm run ingest</code> to generate tokens.json
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', fontFamily: 'var(--f-body)', background: 'var(--color-bg)', minHeight: '100vh' }}>
      {chrome}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <header style={{ borderBottom: '1px solid var(--color-border)', boxShadow: '0 1px 0 rgba(0,180,255,0.08), 0 12px 40px -20px rgba(0,180,255,0.5)', padding: '26px 24px 22px' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 26, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.16em', textShadow: '0 0 18px rgba(0,180,255,0.55)', margin: 0 }}>
                TOKENDASH
              </h1>
              <span className="hud-label" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>▸ usage telemetry</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
              <LiveIndicator generated={data?.generated} />
              <DateFilter onChange={setDateRange} />
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px 80px' }}>
          <div style={{ marginTop: 28, marginBottom: 12 }}>
            <SummaryCards totals={filteredTotals} delay={0} />
          </div>
          <div style={{ marginBottom: 22 }}>
            <MetricsStrip sessions={filtered} delay={80} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <UsageChart sessions={filtered} delay={200} />
              <CostComposition sessions={filtered} delay={250} />
              <ActivityHeatmap sessions={filtered} delay={280} />
              <SessionsTable sessions={filtered} delay={500} onSelect={setSelectedSession} />
            </div>
            <div className="lg:col-span-4" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <ToolBreakdown sessions={filtered} delay={300} onSelect={(tool) => setSelectedGroup({ type: 'tool', value: tool, sessions: filtered.filter(s => s.tool === tool) })} />
              <ModelBreakdown sessions={filtered} delay={350} />
              <ModelEfficiency sessions={filtered} delay={375} />
              <ProjectBreakdown sessions={filtered} delay={400} onSelect={(proj) => setSelectedGroup({ type: 'project', value: proj, sessions: filtered.filter(s => s.project === proj) })} />
              <ExpensiveSessions sessions={filtered} delay={450} onSelect={setSelectedSession} />
            </div>
          </div>
        </main>
      </div>

      <SlidePanel open={panelOpen} onClose={closePanel}>
        {selectedSession && (
          <SessionDetail session={selectedSession} />
        )}
        {selectedGroup && (
          <div>
            <div className="hud-label mb-4" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {selectedGroup.type === 'tool' ? '▸ TOOL' : '▸ PROJECT'}
            </div>
            <div className="mb-4" style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 600, color: 'var(--cyan)', letterSpacing: '0.03em' }}>
              {selectedGroup.value}
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              {selectedGroup.sessions.length} session{selectedGroup.sessions.length !== 1 ? 's' : ''}
            </div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-cost)' }}>
              ${(selectedGroup.sessions.reduce((sum, s) => sum + (s.cost || 0), 0)).toFixed(2)}
            </div>
            <GroupDetail sessions={selectedGroup.sessions} />
          </div>
        )}
      </SlidePanel>
    </div>
  );
}
