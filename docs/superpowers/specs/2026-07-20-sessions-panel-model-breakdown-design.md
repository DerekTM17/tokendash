# Sessions panel scroll + per-project model breakdown

Approved 2026-07-20 (option A of three presented).

## 1. Contained sessions table

`SessionsTable` currently renders every session as one long page-extending table.
Change: the table body scrolls inside the card — `max-height` ≈ 520px (roughly
ten rows), `overflow-y: auto`, `thead` cells `position: sticky; top: 0` with an
opaque card background so rows slide underneath cleanly. Header row and card
title stay fixed; horizontal overflow behavior is unchanged.

## 2. Per-model breakdown in the group slide panel

Clicking a project in "By project" (or a tool in "By tool") already opens the
slide panel with a `selectedGroup`, but it only shows session count + total
cost. Change: add a `GroupDetail` component rendered under that summary that
groups the selected sessions by model and lists, per model: token total, cost,
and session count, with the same thin glow bars used by the other breakdown
panels and the shared `MetricToggle` ($ / tokens — default tokens, since
"which models, how many tokens" is the driving question). Sorted descending by
the active metric. Models named `unknown` render muted, like `other` does in
ProjectBreakdown.

No ingest/schema changes; everything derives from the sessions already passed
to the panel. Testing: extend the SessionsTable component test (scroll
container + sticky header) and add a GroupDetail test (grouping math, sort,
toggle).
