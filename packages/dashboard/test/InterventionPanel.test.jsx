import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InterventionPanel, { TERMS } from '../src/components/InterventionPanel.jsx';
import { define } from '../src/lib/glossary.js';

const row = (d, calls, tokens, cost, turns) => [d, calls, tokens, 0, 0, 0, cost, 0, 0, 0, turns];
const days = (from, n, fn) => {
  const out = [];
  const t = Date.parse(from + 'T00:00:00Z');
  for (let i = 0; i < n; i++) out.push(fn(new Date(t + i * 86400000).toISOString().slice(0, 10)));
  return out;
};
const sessions = [{ id: 'a', tool: 'claude', daily: [
  ...days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)),
  ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
] }];
const iv = [{ date: '2026-07-15', label: 'MCP to CLI', expect: 'tokensPerRequest', note: '', expectedShift: [] }];

describe('InterventionPanel', () => {
  it('shows the verdict and the declared factor', () => {
    render(<InterventionPanel sessions={sessions} interventions={iv} today="2026-08-20" delay={0} />);
    expect(screen.getByText('MCP to CLI')).toBeTruthy();
    expect(screen.getByText(/supported/i)).toBeTruthy();
  });

  it('explains itself when nothing is declared', () => {
    render(<InterventionPanel sessions={sessions} interventions={[]} today="2026-08-20" delay={0} />);
    expect(screen.getByText(/interventions\.json/i)).toBeTruthy();
  });

  it('shows the refusal reason rather than a number', () => {
    render(<InterventionPanel sessions={sessions} today="2026-08-20" delay={0}
      interventions={[{ ...iv[0], date: '2026-07-03' }]} />);
    expect(screen.getByText(/refused/i)).toBeTruthy();
    expect(screen.getByText(/coverage/i)).toBeTruthy();
  });

  it('still lists a pre-registered confound rather than hiding it', () => {
    // model share moves by more than the 10-point confound threshold between
    // the two windows (all-opus before, all-sonnet after), but the
    // intervention pre-declares both categories via expectedShift, so
    // the verdict must not be dragged down to `confounded` and the shift must
    // still be visible, labelled as pre-registered rather than disappearing.
    const modelSessions = [
      { id: 'a', tool: 'claude', model: 'opus', daily: days('2026-07-01', 14, d => row(d, 10, 20000, 8, 2)) },
      { id: 'b', tool: 'claude', model: 'sonnet', daily: days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)) },
    ];
    const declared = [{ date: '2026-07-15', label: 'Switched to Sonnet', expect: 'tokensPerRequest', note: '', direction: 'down', expectedShift: ['model/opus', 'model/sonnet'] }];
    render(<InterventionPanel sessions={modelSessions} interventions={declared} today="2026-08-20" delay={0} />);
    expect(screen.getByText(/supported/i)).toBeTruthy();
    expect(screen.getAllByText(/pre-registered/i).length).toBeGreaterThan(0);
  });

  it('prefers a frozen result over calling evaluate', () => {
    // This date/sessions pair evaluates live to `refused` (see "shows the
    // refusal reason" above — coverage begins after the before-window). A
    // frozen `supported` result attached to the intervention must win instead
    // of that live recomputation: the whole point of freezing a matured
    // verdict is that it stops changing as history is swept out from under it.
    const frozen = { verdict: 'supported', reasons: ['tokensPerRequest fell from 2000 to 1000.'], frozenAt: '2026-10-01' };
    render(<InterventionPanel sessions={sessions} today="2026-08-20" delay={0}
      interventions={[{ ...iv[0], date: '2026-07-03', result: frozen }]} />);
    expect(screen.getByText(/supported/i)).toBeTruthy();
    expect(screen.queryByText(/refused/i)).toBe(null);
    expect(screen.getByText(/frozen 2026-10-01/i)).toBeTruthy();
  });

  it('renders a partial frozen result (no reasons or confounds) without crashing', () => {
    // interventions.results.json is a hand-written, minimal sidecar — the spec's
    // own fixture only carries { verdict, frozenAt }. result.reasons must not
    // be mapped unguarded or this is `undefined.map` and a hard render failure.
    const frozen = { verdict: 'supported', frozenAt: '2026-10-01' };
    render(<InterventionPanel sessions={sessions} today="2026-08-20" delay={0}
      interventions={[{ ...iv[0], result: frozen }]} />);
    expect(screen.getByText(/supported/i)).toBeTruthy();
    expect(screen.getByText(/frozen 2026-10-01/i)).toBeTruthy();
  });

  it('carries the attribution caveats the decomposition produced', () => {
    // The panel decomposes exactly as DriverDecomposition does but rendered
    // neither caveat, so an order-sensitive split and a sound one looked the
    // same here — as did a skipped oracle and a passed one.
    const violent = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 1, 1000, 0.01, 1)),
      ...days('2026-07-16', 14, d => row(d, 90, 900000, 90, 60)),
    ] }];
    render(<InterventionPanel sessions={violent} interventions={iv} today="2026-08-20" delay={0} />);
    expect(screen.getByText(/differ too much for the attribution order/i)).toBeTruthy();
  });

  it('says when the order-independence check could not run at all', () => {
    const freeBefore = [{ id: 'a', tool: 'claude', daily: [
      ...days('2026-07-01', 14, d => row(d, 10, 20000, 0, 2)),
      ...days('2026-07-16', 14, d => row(d, 10, 10000, 4, 2)),
    ] }];
    render(<InterventionPanel sessions={freeBefore} interventions={iv} today="2026-08-20" delay={0} />);
    expect(screen.getByText(/could not run here/i)).toBeTruthy();
  });

  it('names every dynamic glossary term the panel actually asks for', () => {
    // glossary.test.js only sees literal term="..." strings; TERMS[key] is a
    // dynamic expression it cannot see, so this colocated assertion is the
    // real typo guard for these values (mirrors DriverDecomposition.test.jsx).
    for (const [key, term] of Object.entries(TERMS)) {
      expect(define(term), `TERMS.${key} = "${term}" has no glossary entry`).not.toBeNull();
    }
  });
});
