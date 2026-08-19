import { useMemo } from 'react';
import { formatCost } from '../lib/format';
import InfoTip from './InfoTip';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_TICKS = [0, 6, 12, 18];

export default function ActivityHeatmap({ sessions, delay = 0 }) {
  const { grid, max } = useMemo(() => {
    // grid[day][hour] = { count, cost }
    const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ count: 0, cost: 0 })));
    let mx = 0;
    for (const s of sessions) {
      if (!s.startedAt) continue;
      const d = new Date(s.startedAt);
      const cell = g[d.getDay()][d.getHours()];
      cell.count += 1;
      cell.cost += s.cost || 0;
      if (cell.count > mx) mx = cell.count;
    }
    return { grid: g, max: mx };
  }, [sessions]);

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 12, border: '1px solid var(--color-border)', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Activity by hour<InfoTip term="Activity by hour" />
          </div>
          <span className="hud-label" style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>sessions · local time</span>
        </div>

        {max === 0 ? (
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
        ) : (
          <div>
            {DAYS.map((day, di) => (
              <div key={day} style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, marginBottom: 3, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{day}</span>
                {grid[di].map((cell, hi) => {
                  const on = cell.count > 0;
                  const t = on ? 0.14 + 0.86 * (cell.count / max) : 0;
                  return (
                    <div
                      key={hi}
                      title={on ? `${day} ${String(hi).padStart(2, '0')}:00 — ${cell.count} session${cell.count !== 1 ? 's' : ''}, ${formatCost(cell.cost)}` : undefined}
                      style={{
                        height: 15,
                        borderRadius: 2,
                        background: on ? `rgba(0, 180, 255, ${t})` : 'rgba(0,180,255,0.03)',
                        boxShadow: on && t > 0.55 ? '0 0 6px rgba(0,180,255,0.6)' : 'none',
                        border: '1px solid rgba(0,180,255,0.05)',
                      }}
                    />
                  );
                })}
              </div>
            ))}
            {/* hour axis */}
            <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, marginTop: 6 }}>
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="mono" style={{ fontSize: 8, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                  {HOUR_TICKS.includes(h) ? String(h).padStart(2, '0') : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
