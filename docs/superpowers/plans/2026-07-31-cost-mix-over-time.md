# Cost Mix Over Time — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard panel showing where cost goes *over time* — the four-way input/output/cache-read/cache-write split as a weekly share-of-cost trend — so improvement in context discipline becomes visible instead of being a single scalar.

**Architecture:** All bucketing and percentage arithmetic lives in a pure, fully-tested module (`src/lib/costMix.js`). The React component is a thin recharts renderer. This split exists because recharts is close to unassertable in jsdom — the existing chart tests can only check "a container rendered" — and the arithmetic here (cost-weighting, week boundaries, gap handling) is exactly the kind that can be wrong invisibly.

**Tech Stack:** React 18, recharts 2.15.4, Vite, vitest + @testing-library/react (jsdom).

## Global Constraints

- **No ingest changes.** Phase A reads only `session.costParts` and `session.startedAt`, both already emitted by `packages/ingest/src/normalizer.js`. Do not touch `packages/ingest/`.
- **Component colors are fixed and must match `CostComposition.jsx:5-8` exactly:** cache read `#5cc8ff`, cache write `#b48cff`, output `#ff8a3d`, input `#34e6a4`. The same component must not change color between two panels on the same screen.
- **Stack order matches `CostComposition`:** cacheRead, cacheWrite, output, input.
- `costParts` values are **dollars**, not tokens.
- Session token fields are **flat** (`inputTokens`, `cacheReadTokens`, …), never nested under `.tokens`.
- Run tests from the repo root with `npm test`, or scoped with `cd packages/dashboard && npx vitest run <file>`.
- Spec: `docs/superpowers/specs/2026-07-31-cost-mix-over-time-design.md`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/dashboard/src/lib/costMix.js` | **Create.** Pure bucketing + share arithmetic. No React, no recharts. |
| `packages/dashboard/test/costMix.test.js` | **Create.** The real test coverage for this feature. |
| `packages/dashboard/src/components/ToggleButton.jsx` | **Create.** Extracted from `UsageChart.jsx:69`, where it is module-private. |
| `packages/dashboard/src/components/UsageChart.jsx` | **Modify.** Delete the local `ToggleButton`, import the shared one. Nothing else changes. |
| `packages/dashboard/src/components/CostMixTrend.jsx` | **Create.** Thin recharts renderer. |
| `packages/dashboard/test/CostMixTrend.test.jsx` | **Create.** Smoke test in the existing house style. |
| `packages/dashboard/src/App.jsx` | **Modify.** Import and mount the panel. |

---

### Task 1: `bucketCostMix` — the pure arithmetic

**Files:**
- Create: `packages/dashboard/src/lib/costMix.js`
- Test: `packages/dashboard/test/costMix.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `bucketCostMix(sessions, granularity = 'week', today = <today's date>) => Bucket[]`, where `granularity` is `'week' | 'day'` and `today` is a `YYYY-MM-DD` string.

  A `Bucket` is:
  ```js
  {
    key: '2026-07-26',   // bucket start date, YYYY-MM-DD (Sunday, for weeks)
    input: 12.5, output: 40.1, cacheRead: 660.0, cacheWrite: 90.2,  // dollars, or null for an empty bucket
    total: 802.8,                                                    // dollars, or null
    inputPct: 1.6, outputPct: 5.0, cacheReadPct: 82.2, cacheWritePct: 11.2,  // 0-100, or null
    cachePct: 93.4,      // cacheRead + cacheWrite, or null
    sessionCount: 41,
    partial: false,      // true only for the bucket containing `today`
    isolated: false,     // true when both neighbours are null/absent
  }
  ```
  Empty (gap) buckets carry `null` for every dollar and percentage field. **Null, not zero** — recharts breaks a stacked `Area` on null, which honestly shows a gap, whereas zero would draw the band diving to the floor.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/test/costMix.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { bucketCostMix } from '../src/lib/costMix';

/** Build a session with a cost split, defaulting the parts we don't care about. */
function session(startedAt, parts) {
  return {
    startedAt,
    costParts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...parts },
  };
}

describe('bucketCostMix', () => {
  it('returns an empty array for no sessions', () => {
    expect(bucketCostMix([], 'week', '2026-07-31')).toEqual([]);
  });

  it('skips sessions missing startedAt or costParts', () => {
    const sessions = [
      { startedAt: null, costParts: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { startedAt: '2026-07-26T10:00:00Z', costParts: null },
    ];
    expect(bucketCostMix(sessions, 'week', '2026-07-31')).toEqual([]);
  });

  it('weights share by dollars, not by session count', () => {
    // One $700 session at ~94% cache read, plus 100 tiny sessions at 20%.
    // Averaging per-session percentages would yield ~21%; cost-weighting gives ~93%.
    const sessions = [session('2026-07-26T10:00:00Z', { cacheRead: 660, output: 40 })];
    for (let i = 0; i < 100; i++) {
      sessions.push(session('2026-07-27T10:00:00Z', { cacheRead: 0.02, output: 0.08 }));
    }

    const [week] = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(week.total).toBeCloseTo(710, 5);
    expect(week.cacheRead).toBeCloseTo(662, 5);
    expect(week.cacheReadPct).toBeGreaterThan(90);
    expect(week.sessionCount).toBe(101);
  });

  it('buckets weeks on Sunday boundaries', () => {
    // 2026-07-25 is a Saturday (week of the 19th); 2026-07-26 is a Sunday.
    const sessions = [
      session('2026-07-25T23:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T01:00:00Z', { cacheRead: 20 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-19', '2026-07-26']);
    expect(weeks[0].cacheRead).toBe(10);
    expect(weeks[1].cacheRead).toBe(20);
  });

  it('buckets by day when asked', () => {
    const sessions = [
      session('2026-07-25T23:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T01:00:00Z', { cacheRead: 20 }),
    ];

    const days = bucketCostMix(sessions, 'day', '2026-07-31');

    expect(days.map(d => d.key)).toEqual(['2026-07-25', '2026-07-26']);
  });

  it('fills interior gaps with nulls and does not pad the ends', () => {
    // Weeks of 07-05 and 07-26, with 07-12 and 07-19 empty between them.
    const sessions = [
      session('2026-07-05T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 20 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
    expect(weeks[1].total).toBeNull();
    expect(weeks[1].cacheReadPct).toBeNull();
    expect(weeks[1].sessionCount).toBe(0);
    expect(weeks[0].total).toBe(10);
    expect(weeks[3].total).toBe(20);
  });

  it('percentages within a bucket sum to 100', () => {
    const sessions = [
      session('2026-07-26T10:00:00Z', { input: 1, output: 2, cacheRead: 6, cacheWrite: 1 }),
    ];

    const [week] = bucketCostMix(sessions, 'week', '2026-07-31');

    const sum = week.inputPct + week.outputPct + week.cacheReadPct + week.cacheWritePct;
    expect(sum).toBeCloseTo(100, 6);
    expect(week.cachePct).toBeCloseTo(70, 6);
  });

  it('flags isolated buckets so the renderer can dot them', () => {
    // 07-05 stands alone (07-12 empty); 07-19 and 07-26 are adjacent.
    const sessions = [
      session('2026-07-05T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-19T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 10 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks.map(w => w.key)).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
    expect(weeks[0].isolated).toBe(true);   // empty on the right, nothing on the left
    expect(weeks[2].isolated).toBe(false);  // 07-26 is a live neighbour
    expect(weeks[3].isolated).toBe(false);
  });

  it('treats a lone bucket as isolated', () => {
    const sessions = [session('2026-07-26T10:00:00Z', { cacheRead: 10 })];
    expect(bucketCostMix(sessions, 'week', '2026-07-31')[0].isolated).toBe(true);
  });

  it('marks only the bucket containing today as partial', () => {
    const sessions = [
      session('2026-07-19T10:00:00Z', { cacheRead: 10 }),
      session('2026-07-26T10:00:00Z', { cacheRead: 10 }),
    ];

    const weeks = bucketCostMix(sessions, 'week', '2026-07-31');

    expect(weeks[0].partial).toBe(false);
    expect(weeks[1].partial).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/dashboard && npx vitest run test/costMix.test.js`
Expected: FAIL — cannot resolve `../src/lib/costMix`.

- [ ] **Step 3: Implement the module**

Create `packages/dashboard/src/lib/costMix.js`:

```js
/**
 * Buckets sessions by day or week and works out where the cost went in each.
 *
 * Share is cost-weighted: component dollars are summed across the bucket and
 * divided by the bucket total. Averaging per-session percentages instead would
 * let a $0.08 subagent session count as much as a $700 one, and spend is
 * concentrated enough here (ten sessions are ~57% of it) that the chart would
 * be meaningless.
 */

const COMPONENTS = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** Sunday that starts the week containing `day`. Parsed as UTC so the key
 *  never shifts with the viewer's timezone. */
function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function bucketKey(day, granularity) {
  return granularity === 'week' ? weekStart(day) : day;
}

function advance(key, granularity) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (granularity === 'week' ? 7 : 1));
  return d.toISOString().slice(0, 10);
}

/** A bucket nothing landed in. Nulls rather than zeros: recharts breaks a
 *  stacked Area on null, so the band shows a gap instead of diving to zero. */
function emptyBucket(key) {
  return {
    key,
    input: null, output: null, cacheRead: null, cacheWrite: null,
    total: null,
    inputPct: null, outputPct: null, cacheReadPct: null, cacheWritePct: null,
    cachePct: null,
    sessionCount: 0,
    partial: false,
    isolated: false,
  };
}

function finalize(bucket) {
  const total = COMPONENTS.reduce((sum, c) => sum + bucket[c], 0);
  const pct = value => (total ? (value / total) * 100 : 0);
  return {
    ...bucket,
    total,
    inputPct: pct(bucket.input),
    outputPct: pct(bucket.output),
    cacheReadPct: pct(bucket.cacheRead),
    cacheWritePct: pct(bucket.cacheWrite),
    cachePct: pct(bucket.cacheRead + bucket.cacheWrite),
    partial: false,
    isolated: false,
  };
}

export function bucketCostMix(
  sessions,
  granularity = 'week',
  today = new Date().toISOString().slice(0, 10),
) {
  const byKey = new Map();

  for (const s of sessions) {
    if (!s.startedAt || !s.costParts) continue;
    // Same naive-UTC day convention UsageChart uses, so the two panels agree.
    const key = bucketKey(s.startedAt.slice(0, 10), granularity);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessionCount: 0 };
      byKey.set(key, bucket);
    }
    for (const c of COMPONENTS) bucket[c] += s.costParts[c] || 0;
    bucket.sessionCount += 1;
  }

  const keys = [...byKey.keys()].sort();
  if (keys.length === 0) return [];

  // Walk the whole span so the x-axis stays linear in time. Interior gaps get
  // an empty bucket; the ends are never padded.
  const buckets = [];
  const last = keys[keys.length - 1];
  for (let key = keys[0]; key <= last; key = advance(key, granularity)) {
    const bucket = byKey.get(key);
    buckets.push(bucket ? finalize(bucket) : emptyBucket(key));
  }

  // A bucket with no live neighbour has nothing to draw a line segment to, so
  // its area path encloses nothing and renders invisible. Flag it here — in the
  // tested module — so the renderer can draw a dot for it.
  buckets.forEach((bucket, i) => {
    if (bucket.total === null) return;
    const prev = buckets[i - 1];
    const next = buckets[i + 1];
    bucket.isolated = (!prev || prev.total === null) && (!next || next.total === null);
  });

  const todayKey = bucketKey(today, granularity);
  const current = buckets.find(b => b.key === todayKey);
  if (current) current.partial = true;

  return buckets;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/dashboard && npx vitest run test/costMix.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/costMix.js packages/dashboard/test/costMix.test.js
git commit -m "feat(dashboard): bucket cost mix by day or week

Cost-weighted share per bucket, interior gaps as nulls so the band
breaks rather than diving to zero, and an isolated flag so the renderer
can dot buckets that would otherwise draw an invisible zero-area path."
```

---

### Task 2: Extract `ToggleButton`

Two panels need the identical control, which is the point at which a module-private helper stops being local. `UsageChart.jsx:69` declares `ToggleButton` as a plain function with only the chart exported by default, so it cannot be imported as-is.

**Files:**
- Create: `packages/dashboard/src/components/ToggleButton.jsx`
- Modify: `packages/dashboard/src/components/UsageChart.jsx` (delete lines 69-92, add an import)
- Test: `packages/dashboard/test/ToggleButton.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `default export ToggleButton({ active, onClick, children })`.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/test/ToggleButton.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToggleButton from '../src/components/ToggleButton';

describe('ToggleButton', () => {
  it('renders its label', () => {
    render(<ToggleButton active={false} onClick={() => {}}>Tokens</ToggleButton>);
    expect(screen.getByText('Tokens')).toBeTruthy();
  });

  it('calls onClick when pressed', () => {
    const onClick = vi.fn();
    render(<ToggleButton active={false} onClick={onClick}>Cost</ToggleButton>);
    fireEvent.click(screen.getByText('Cost'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('styles the active state differently from the inactive one', () => {
    const { container: activeC } = render(<ToggleButton active onClick={() => {}}>A</ToggleButton>);
    const { container: idleC } = render(<ToggleButton active={false} onClick={() => {}}>B</ToggleButton>);
    const activeBg = activeC.querySelector('button').style.background;
    const idleBg = idleC.querySelector('button').style.background;
    expect(activeBg).not.toBe(idleBg);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/dashboard && npx vitest run test/ToggleButton.test.jsx`
Expected: FAIL — cannot resolve `../src/components/ToggleButton`.

- [ ] **Step 3: Create the component**

Create `packages/dashboard/src/components/ToggleButton.jsx` with the markup moved verbatim out of `UsageChart.jsx` — the styling must not change:

```jsx
/** Small segmented-control button used by the chart panels' metric toggles. */
export default function ToggleButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        padding: '4px 12px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--void)' : 'var(--color-text-secondary)',
        background: active ? 'var(--cyan)' : 'transparent',
        boxShadow: active ? '0 0 14px rgba(0,180,255,0.5)' : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Point `UsageChart` at it**

In `packages/dashboard/src/components/UsageChart.jsx`, delete the whole local `function ToggleButton({ active, onClick, children }) { … }` block (lines 69-92) and add to the imports at the top:

```jsx
import ToggleButton from './ToggleButton';
```

Change nothing else in that file.

- [ ] **Step 5: Run the full dashboard suite**

Run: `cd packages/dashboard && npx vitest run`
Expected: PASS — the new ToggleButton tests plus the pre-existing 35, with `UsageChart.test.jsx` still green. If `UsageChart` fails, the extraction changed behaviour; revert and redo it verbatim.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/ToggleButton.jsx packages/dashboard/src/components/UsageChart.jsx packages/dashboard/test/ToggleButton.test.jsx
git commit -m "refactor(dashboard): extract ToggleButton for reuse

It was module-private in UsageChart; the cost-mix panel needs the same
control. Markup and styling unchanged."
```

---

### Task 3: The `CostMixTrend` panel

**Files:**
- Create: `packages/dashboard/src/components/CostMixTrend.jsx`
- Test: `packages/dashboard/test/CostMixTrend.test.jsx`

**Interfaces:**
- Consumes: `bucketCostMix(sessions, granularity, today)` from Task 1; `ToggleButton` from Task 2; `formatCost(cost)` from `../lib/format`.
- Produces: `default export CostMixTrend({ sessions, delay })` for Task 4.

**Two rendering details that are easy to get wrong:**

1. **The `<Bar>` must come after the `<Area>`s in JSX order.** In Share mode the stacked areas fill the *entire* chart height, because they sum to 100%. There is no empty space at the bottom for bars to occupy — recharts draws children in order, so a Bar declared first would be painted over and vanish. Declared last, it reads as a solid base rail across the bottom of the band.
2. **The right-hand axis needs an inflated domain.** `[0, maxTotal * 4]` confines the bars to the bottom ~25%. Without it recharts scales them to full height and they compete with the band. Both the `<Bar>` and its `<YAxis yAxisId="right">` are unmounted in Dollars mode — dropping only the Bar leaves an orphan axis reserving width for nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/test/CostMixTrend.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CostMixTrend from '../src/components/CostMixTrend';

// jsdom reports zero size for every element, so recharts' ResponsiveContainer
// renders nothing and any assertion about chart internals passes vacuously.
// Swap it for a fixed-size wrapper so the Bar/Area elements actually mount —
// otherwise the Dollars-mode assertion below proves nothing.
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <div className="recharts-responsive-container">
        {React.cloneElement(children, { width: 800, height: 300 })}
      </div>
    ),
  };
});

const sessions = [
  {
    startedAt: '2026-07-19T10:00:00Z',
    costParts: { input: 1, output: 5, cacheRead: 80, cacheWrite: 14 },
  },
  {
    startedAt: '2026-07-26T10:00:00Z',
    costParts: { input: 1, output: 10, cacheRead: 70, cacheWrite: 19 },
  },
];

describe('CostMixTrend', () => {
  it('renders a chart when there is data', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('renders the empty state', () => {
    const { container } = render(<CostMixTrend sessions={[]} />);
    expect(container.textContent).toContain('No data');
  });

  it('offers both granularity and mode toggles', () => {
    render(<CostMixTrend sessions={sessions} />);
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.getByText('Dollars')).toBeTruthy();
  });

  it('switches granularity without crashing', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    fireEvent.click(screen.getByText('Day'));
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });

  it('shows the total-cost bar row in Share mode and drops it in Dollars mode', () => {
    const { container } = render(<CostMixTrend sessions={sessions} />);
    expect(container.querySelector('.recharts-bar')).toBeTruthy();

    fireEvent.click(screen.getByText('Dollars'));
    expect(container.querySelector('.recharts-bar')).toBeNull();
    // The stacked areas must survive the mode switch.
    expect(container.querySelector('.recharts-area')).toBeTruthy();
  });

  it('draws a dot for an isolated bucket', () => {
    // A lone week with nothing adjacent has no neighbour to form a line
    // segment with, so without the dot it renders as an invisible path.
    const lone = [{
      startedAt: '2026-07-26T10:00:00Z',
      costParts: { input: 1, output: 5, cacheRead: 80, cacheWrite: 14 },
    }];
    const { container } = render(<CostMixTrend sessions={lone} />);
    expect(container.querySelector('.recharts-area-dots circle')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd packages/dashboard && npx vitest run test/CostMixTrend.test.jsx`
Expected: FAIL — cannot resolve `../src/components/CostMixTrend`.

- [ ] **Step 3: Implement the component**

Create `packages/dashboard/src/components/CostMixTrend.jsx`:

```jsx
import { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { bucketCostMix } from '../lib/costMix';
import { formatCost } from '../lib/format';
import ToggleButton from './ToggleButton';

// Same order and colours as CostComposition — the same component changing
// colour between two panels on one screen would read as a bug.
const PARTS = [
  { key: 'cacheRead', label: 'Cache read', color: '#5cc8ff' },
  { key: 'cacheWrite', label: 'Cache write', color: '#b48cff' },
  { key: 'output', label: 'Output', color: '#ff8a3d' },
  { key: 'input', label: 'Input', color: '#34e6a4' },
];

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

function CostMixTooltip({ active, payload, granularity }) {
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
      <div style={{ borderTop: '1px solid var(--color-border-light)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>
          Total · {bucket.sessionCount} session{bucket.sessionCount === 1 ? '' : 's'}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--color-text)', fontWeight: 600 }}>
          {formatCost(bucket.total)}
        </span>
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

export default function CostMixTrend({ sessions, delay = 0 }) {
  const [granularity, setGranularity] = useState('week');
  const [mode, setMode] = useState('share');

  const data = useMemo(() => bucketCostMix(sessions, granularity), [sessions, granularity]);
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
            Cost mix over time
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
                tickFormatter={key => new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
              />
              <YAxis
                yAxisId="left"
                domain={share ? [0, 100] : [0, 'auto']}
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)', fontFamily: 'var(--f-body)' }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={v => (share ? `${v}%` : `$${v >= 10 ? v.toFixed(0) : v.toFixed(1)}`)}
              />
              {/* Inflated domain keeps the bars a row along the bottom rather
                  than a full-height chart competing with the band. */}
              {share && (
                <YAxis yAxisId="right" orientation="right" domain={[0, maxTotal * 4 || 1]} hide />
              )}
              <Tooltip content={<CostMixTooltip granularity={granularity} />} />
              <Legend content={renderLegend} />
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
                  dot={props => <IsolatedDot {...props} color={part.color} />}
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
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd packages/dashboard && npx vitest run test/CostMixTrend.test.jsx`
Expected: PASS, 6 tests.

Two failures are plausible here and mean different things:

- **`.recharts-bar` still present in Dollars mode** — the `{share && <Bar …/>}` guard is wrapping a fragment rather than sitting on the `<Bar>` itself; recharts inspects its direct children.
- **The isolated-dot test finds no circle** — recharts passes the data entry to a `dot` render function as `payload`. Confirm `IsolatedDot` is reading `payload.isolated` and that Task 1's `isolated` flag is actually set (`node -e "…"` against `bucketCostMix` with a single session). Do not "fix" this by always drawing dots; daily mode would then draw ~380 of them.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/CostMixTrend.jsx packages/dashboard/test/CostMixTrend.test.jsx
git commit -m "feat(dashboard): add Cost mix over time panel

Stacked share of cost per week with a Week/Day and Share/Dollars toggle.
Isolated buckets get a dot so they don't render as an invisible zero-area
path, and the total-cost bar row keeps low-volume weeks from reading as
good habits."
```

---

### Task 4: Mount the panel and check it against real data

**Files:**
- Modify: `packages/dashboard/src/App.jsx` (import block at lines 1-17; left column at lines 120-125)

**Interfaces:**
- Consumes: `CostMixTrend({ sessions, delay })` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Add the import**

In `packages/dashboard/src/App.jsx`, directly after the `CostComposition` import:

```jsx
import CostMixTrend from './components/CostMixTrend';
```

- [ ] **Step 2: Mount it in the left column**

In the `lg:col-span-8` column, insert the panel between `CostComposition` and `ActivityHeatmap` so it sits directly under the aggregate it extends:

```jsx
<UsageChart sessions={filtered} delay={200} />
<CostComposition sessions={filtered} delay={250} />
<CostMixTrend sessions={filtered} delay={265} />
<ActivityHeatmap sessions={filtered} delay={280} />
```

- [ ] **Step 3: Run the whole suite**

Run (from the repo root): `npm test`
Expected: PASS — 54 ingest tests plus the dashboard suite (35 pre-existing + 19 new: 10 costMix, 3 ToggleButton, 6 CostMixTrend), 0 failures.

- [ ] **Step 4: Verify the rendered numbers against real data**

Green tests are not proof here — `AGENTS.md` requires a real-data sanity check. Print what the panel should be showing:

```bash
cd ~/opencode/projects/token-dashboard && node -e "
const S=JSON.parse(require('fs').readFileSync('packages/dashboard/public/tokens.json','utf8')).sessions;
const wk={};
for(const s of S){ if(!s.startedAt||!s.costParts) continue;
  const d=new Date(s.startedAt.slice(0,10)+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()-d.getUTCDay());
  const k=d.toISOString().slice(0,10);
  const b=wk[k]||(wk[k]={t:0,c:0,n:0});
  const p=s.costParts;
  b.t+=p.input+p.output+p.cacheRead+p.cacheWrite;
  b.c+=p.cacheRead+p.cacheWrite; b.n++; }
console.log('week        total  cache%  sessions');
for(const [k,v] of Object.entries(wk).sort())
  console.log(k, ('\$'+v.t.toFixed(0)).padStart(7), ((v.c/v.t)*100).toFixed(0).padStart(6)+'%', String(v.n).padStart(6));
"
```

Expected: ten weeks of data, cache% around 82-93% for the substantive weeks, and three weeks at $1-$3. Totals drift upward as ingest runs, so match the shape, not the cents.

- [ ] **Step 5: Confirm it in the browser**

The dashboard is always-on at http://localhost:5199 (Vite dev server, hot reload).

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5199/
```

Expected: `200`. Then open it and confirm, in Share mode: the band fills the full height, weekly numbers match Step 4's table, the two isolated weeks (`2026-04-26`, `2026-05-17`) each show a **dot** rather than a blank gap, and the low-cost weeks sit above hairline bars. Switch to Dollars: the band becomes absolute dollars and the bar row disappears with no leftover gap on the right edge. Switch to Day: ~95 buckets, no crash.

No `./scripts/autostart.sh` run is needed — Phase A does not touch `packages/ingest/src`.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/App.jsx
git commit -m "feat(dashboard): mount Cost mix over time under Where the cost goes"
```

- [ ] **Step 7: Capture the work**

Record the shipped feature in the project changelog:

```bash
ledger ship
```

Follow the prompts, summarising the panel and the isolated-bucket finding.

---

## Out of Scope

Phase B (context-per-call and cost-per-call trends) is deliberately not in this plan. It needs an `apiCalls` count added across all three parsers in `packages/ingest/src/parsers/`, and — for the main-vs-subagent split — a second new ingest field. It gets its own brainstorm and plan. See the Phase B section of the spec.
