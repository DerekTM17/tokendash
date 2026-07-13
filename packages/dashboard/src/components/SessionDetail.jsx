import { formatCost, formatTokens, formatDate } from '../lib/format';

function Row({ label, value, mono = true, color = 'var(--color-text)', weight = 500 }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7, gap: 12 }}>
      <span style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ fontFamily: mono ? undefined : 'var(--f-body)', fontSize: 12, fontWeight: weight, color, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  );
}

export default function SessionDetail({ session }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 22 }}>
      <div>
        <div className="hud-label" style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 12 }}>▸ SESSION</div>
        <Row label="Tool" value={session.tool} mono={false} />
        <Row label="Project" value={session.project} mono={false} />
        <Row label="Model" value={session.model} />
        <Row label="Started" value={formatDate(session.startedAt)} />
      </div>
      <div>
        <div className="hud-label" style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 12 }}>▸ TOKENS</div>
        <Row label="Input" value={formatTokens(session.inputTokens)} color="var(--cyan)" />
        <Row label="Output" value={formatTokens(session.outputTokens)} color="var(--cyan)" />
        <Row label="Cache read" value={formatTokens(session.cacheReadTokens || 0)} color="var(--cyan)" />
        <Row label="Cache write" value={formatTokens(session.cacheWriteTokens || 0)} color="var(--cyan)" />
        <div style={{ borderTop: '1px solid var(--color-border-light)', marginTop: 8, paddingTop: 10 }}>
          <Row
            label={session.costEstimated ? 'Cost (est.)' : 'Cost'}
            value={`${session.costEstimated ? '~' : ''}${formatCost(session.cost)}`}
            color="var(--color-cost)"
            weight={600}
          />
        </div>
      </div>
    </div>
  );
}
