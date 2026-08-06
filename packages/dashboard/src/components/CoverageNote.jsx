import { formatCost } from '../lib/format';

const shortDay = day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

/**
 * Accounts for the buckets a trend panel trimmed off its left edge.
 *
 * Two separate facts, and the second is the one that matters: a little early
 * activity is not shown, AND the record before the coverage date is incomplete
 * because Claude Code deleted it. Transcript retention defaulted to 30 days
 * until `cleanupPeriodDays` was raised on 2026-07-27; `history.jsonl` still
 * shows 1,336 prompts across March–May whose cost is unrecoverable. Without this
 * line the chart's left edge reads as "spending started here," which is false.
 */
export default function CoverageNote({ coverage }) {
  if (!coverage) return null;
  const { start, excluded } = coverage;

  return (
    <div style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, color: 'var(--color-text-muted)', lineHeight: 1.5, paddingTop: 2 }}>
      Chart starts {shortDay(start)}, the first day with Claude transcripts.
      {' '}
      {excluded.sessions} earlier {excluded.tools.join(' / ')} session
      {excluded.sessions === 1 ? '' : 's'} ({formatCost(excluded.cost)}) {excluded.sessions === 1 ? 'is' : 'are'} not shown.
      {' '}
      <strong style={{ fontWeight: 600 }}>Earlier Claude usage is missing, not absent</strong> — transcript
      retention defaulted to 30 days until it was raised on Jul 27, so March–May
      transcripts were deleted. Those months hold more prompts than June and July
      combined; their cost is unrecoverable.
    </div>
  );
}
