import { formatCost, formatTokens, formatDate } from '../lib/format';

export default function SessionDetail({ session }) {
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Session
          </div>
          {[['Tool', session.tool], ['Project', session.project], ['Model', session.model], ['Started', formatDate(session.startedAt)]].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Tokens
          </div>
          {[
            ['Input', formatTokens(session.inputTokens)],
            ['Output', formatTokens(session.outputTokens)],
            ['Cache read', formatTokens(session.cacheReadTokens || 0)],
            ['Cache write', formatTokens(session.cacheWriteTokens || 0)],
            ['Cost', formatCost(session.cost)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--color-text-secondary)' }}>{label}</span>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: label === 'Cost' ? 600 : 500, color: label === 'Cost' ? 'var(--color-accent)' : 'var(--color-text)' }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
