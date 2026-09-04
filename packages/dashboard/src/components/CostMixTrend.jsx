import { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { bucketCostMix, bucketKey } from '../lib/costMix';
import { dataCoverage, trimToCoverage } from '../lib/coverage';
import { formatCost, formatAxisDollars } from '../lib/format';
import { PARTS } from '../lib/costParts';
import ToggleButton from './ToggleButton';
import CoverageNote from './CoverageNote';
import InfoTip from './InfoTip';

function bucketLabel(key, granularity) {
  const date = new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return granularity === 'week' ? `Week of ${date}` : date;
}

/** Draws a dot only for buckets with no live neighbour. Those have nothing to
 *  form a line segment with, so their area path encloses nothing and would
 *  otherwise be invisible. */
function IsolatedDot({ cx, cy, payload, color }) {
  if (!payload?.isolated || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={2.5} fill={color} stroke="var(--color-card)" strokeWidth={1} />;
}

export function CostMixTooltip({ active, payload, granularity }) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!bucket || bucket.total === null) return null;

  return (
    <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 210 }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        {bucketLabel(bucket.key, granularity)}
        {bucket.partial && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 500 }}> · in progress</span>
        )}
      </div>
      {PARTS.map(part => (
        <div key={part.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: part.color, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text)' }}>{part.label}</span>
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
              {bucket[part.key + 'Pct'].toFixed(1)}%
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 500 }}>
              {formatCost(bucket[part.key])}
            </span>
          </span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid var(--color-border-light)', marginTop: 8, paddingTop: 8 }}>
        {/* Combined cacheRead + cacheWrite share — the single figure this
            panel exists to show. MetricsStrip headlines it as "cache % of
            cost"; without this row a reader has to add the two bands above
            by hand. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 16 }}>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            Cache
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
              {bucket.cachePct.toFixed(1)}%
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 500 }}>
              {formatCost(bucket.cacheRead + bucket.cacheWrite)}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>
            Total · {bucket.sessionCount} session{bucket.sessionCount === 1 ? '' : 's'}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>
            {formatCost(bucket.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

const renderLegend = ({ payload }) => (
  <div style={{ display: 'flex', justifyContent: 'center', gap: 20, paddingTop: 4, flexWrap: 'wrap' }}>
    {payload.map((entry, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: entry.color }} />
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{entry.value}</span>
      </div>
    ))}
  </div>
);

export default function CostMixTrend({ sessions, delay = 0, interventions = [] }) {
  const [granularity, setGranularity] = useState('week');
  const [mode, setMode] = useState('share');

  const coverage = useMemo(() => dataCoverage(sessions), [sessions]);
  const data = useMemo(
    () => trimToCoverage(bucketCostMix(sessions, granularity), coverage, granularity),
    [sessions, granularity, coverage],
  );
  const maxTotal = useMemo(
    () => data.reduce((max, b) => Math.max(max, b.total || 0), 0),
    [data],
  );

  const share = mode === 'share';
  const suffix = share ? 'Pct' : '';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Cost mix over time<InfoTip term="Cost mix over time" />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--color-detail-bg)', border: '1px solid var(--color-border)' }}>
              <ToggleButton active={granularity === 'week'} onClick={() => setGranularity('week')}>Week</ToggleButton>
              <ToggleButton active={granularity === 'day'} onClick={() => setGranularity('day')}>Day</ToggleButton>
            </div>
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--color-detail-bg)', border: '1px solid var(--color-border)' }}>
              <ToggleButton active={share} onClick={() => setMode('share')}>Share</ToggleButton>
              <ToggleButton active={!share} onClick={() => setMode('dollars')}>Dollars</ToggleButton>
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                {PARTS.map(part => (
                  <linearGradient key={part.key} id={`mix_${part.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={part.color} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={part.color} stopOpacity={0.06} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border-light)" />
              <XAxis
                dataKey="key"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--f-body)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                minTickGap={40}
                tickFormatter={key => bucketLabel(key, 'day')}
              />
              <YAxis
                yAxisId="left"
                domain={share ? [0, 100] : [0, 'auto']}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--f-body)' }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={v => (share ? `${v.toFixed(0)}%` : formatAxisDollars(v))}
              />
              {/* Inflated domain keeps the bars a row along the bottom rather
                  than a full-height chart competing with the band. */}
              {share && (
                <YAxis yAxisId="right" orientation="right" domain={[0, maxTotal * 4 || 1]} hide />
              )}
              <Tooltip content={<CostMixTooltip granularity={granularity} />} />
              <Legend content={renderLegend} />
              {interventions.map(iv => (
                // ifOverflow defaults to "discard": recharts drops a line whose x
                // falls outside the category axis domain rather than mis-plotting
                // it, so a date outside the trimmed coverage window is silently
                // absent instead of drawing a stray or misplaced line.
                <ReferenceLine
                  key={iv.date + iv.label}
                  // This chart has no yAxisId="0" — Areas and the Bar use
                  // "left" (and "right"). ReferenceLine's default yAxisId is 0,
                  // which would throw looking up a y-axis that doesn't exist.
                  yAxisId="left"
                  x={bucketKey(iv.date, granularity)}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  label={{ value: iv.label, position: 'insideTopRight', fontSize: 11 }}
                />
              ))}
              {PARTS.map(part => (
                <Area
                  key={part.key}
                  yAxisId="left"
                  type="monotone"
                  dataKey={part.key + suffix}
                  name={part.label}
                  stroke={part.color}
                  fill={`url(#mix_${part.key})`}
                  strokeWidth={1.75}
                  stackId="mix"
                  dot={({ key, ...rest }) => <IsolatedDot key={key} {...rest} color={part.color} />}
                  activeDot={{ r: 3.5, fill: part.color, stroke: 'var(--color-card)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ))}
              {/* Declared last on purpose: in Share mode the stacked areas fill
                  the full height, so a Bar declared earlier would be painted
                  over. Last, it reads as a base rail. */}
              {share && (
                <Bar
                  yAxisId="right"
                  dataKey="total"
                  name="Total cost"
                  fill="var(--color-text-muted)"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {data.length > 0 && <CoverageNote coverage={coverage} />}
      </div>
    </div>
  );
}
