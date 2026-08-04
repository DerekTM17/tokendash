import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { bucketPerCall, toChartRows, SERIES } from '../lib/perCall';
import { formatTokens, formatAxisDollars } from '../lib/format';
import ToggleButton from './ToggleButton';

// One hue per tool, weaker for subagent, so the eye reads tool first and kind
// second. Claude keeps the cyan it carries elsewhere on the page; Codex takes
// the orange from the cost-composition palette.
const COLORS = {
  claudeMain: '#5cc8ff',
  claudeSub: '#9fdcff',
  codexMain: '#ff8a3d',
  codexSub: '#ffbc8f',
};

function bucketLabel(key, granularity) {
  const date = new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return granularity === 'week' ? `Week of ${date}` : date;
}

const formatValue = (v, metric) => (metric === 'cost' ? `$${v.toFixed(4)}` : formatTokens(v));

/** Draws a dot only where a series has no live neighbour. Such a point has
 *  nothing to form a line segment with and would otherwise be invisible — which
 *  is most of both Codex series, since Codex main sessions exist on six
 *  distinct days in all of history. */
function IsolatedDot({ cx, cy, payload, seriesKey, color }) {
  if (!payload?.[`${seriesKey}__isolated`] || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={2.75} fill={color} stroke="var(--color-card)" strokeWidth={1} />;
}

export function PerCallTooltip({ active, payload, granularity, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const live = SERIES.filter(s => row[s.key] != null);
  if (!live.length) return null;

  return (
    <div style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 230 }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        {bucketLabel(row.key, granularity)}
        {row.partial && (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 500 }}> · in progress</span>
        )}
      </div>
      {live.map(s => (
        <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: COLORS[s.key], flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text)' }}>{s.label}</span>
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            {/* The denominator, shown because a mean over three calls and a mean
                over three thousand deserve different amounts of trust. */}
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
              {row[`${s.key}__calls`].toLocaleString()} calls
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 500 }}>
              {formatValue(row[s.key], metric)}
            </span>
          </span>
        </div>
      ))}
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

export default function PerCallTrend({ sessions, delay = 0 }) {
  const [granularity, setGranularity] = useState('week');
  const [metric, setMetric] = useState('context');

  const buckets = useMemo(() => bucketPerCall(sessions, granularity), [sessions, granularity]);
  const data = useMemo(() => toChartRows(buckets, metric), [buckets, metric]);

  const context = metric === 'context';

  return (
    <div className="animate-in" style={{ animationDelay: `${delay}ms` }}>
      <div style={{ background: 'var(--color-card)', borderRadius: 14, border: '1px solid var(--color-border)', padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
            Per API call
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--color-detail-bg)', border: '1px solid var(--color-border)' }}>
              <ToggleButton active={granularity === 'week'} onClick={() => setGranularity('week')}>Week</ToggleButton>
              <ToggleButton active={granularity === 'day'} onClick={() => setGranularity('day')}>Day</ToggleButton>
            </div>
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--color-detail-bg)', border: '1px solid var(--color-border)' }}>
              <ToggleButton active={context} onClick={() => setMetric('context')}>Context</ToggleButton>
              <ToggleButton active={!context} onClick={() => setMetric('cost')}>Cost</ToggleButton>
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--color-text-muted)' }}>No data</span>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
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
                  domain={[0, 'auto']}
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--f-body)' }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={v => (context ? formatTokens(v) : formatAxisDollars(v))}
                />
                <Tooltip content={<PerCallTooltip granularity={granularity} metric={metric} />} />
                <Legend content={renderLegend} />
                {SERIES.map(s => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={COLORS[s.key]}
                    strokeWidth={1.75}
                    dot={({ key, ...rest }) => (
                      <IsolatedDot key={key} {...rest} seriesKey={s.key} color={COLORS[s.key]} />
                    )}
                    activeDot={{ r: 3.5, fill: COLORS[s.key], stroke: 'var(--color-card)', strokeWidth: 2 }}
                    isAnimationActive={false}
                    // Gaps stay gaps. A series with no calls in a bucket carries
                    // null, and joining across it would invent a trend.
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.5, paddingTop: 4 }}>
              {context
                ? 'Input + cache read + cache write per call, weighted by calls. Main and subagent are kept apart: delegating more lowers a blended average without context discipline changing.'
                : 'Cost per call is context per call times the blended rate of whichever models ran, and those rates span about 4x. A fall here can mean leaner context or a cheaper model — read it alongside Context.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
