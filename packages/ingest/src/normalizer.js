import { discoverProjects, matchProject } from './discovery.js';
import { estimateCost, costBreakdown } from './pricing.js';
import { DAILY_COLUMNS } from './daily.js';

/** Tools whose transcripts let us identify a human turn. Claude Code is the
 *  only one today. Adding another parser's support is a one-line change here.
 *
 *  This is a FILTER, not a caption: the decomposition is computed over these
 *  tools only. 11 of 81 active days in the corpus mix tools, and on three of
 *  them Codex is ~70% of the day's calls — summing those requests against
 *  Claude-only turns would inflate Requests/Turn by up to 3x on exactly the
 *  days a comparison might land. */
export const TURN_CAPABLE_TOOLS = new Set(['claude']);

// Per-model context windows, used only to flag impossible per-call context —
// a delta-accounting regression shows up here immediately. Prefix-matched, and
// a model matching nothing is SKIPPED rather than guessed: a wrong window would
// manufacture false alarms, which is worse than a missing check.
const CONTEXT_WINDOWS = [
  // Claude Code runs the 1M-context beta; max observed per call is 999,722.
  ['claude-', 1_000_000],
  // Codex rollouts self-report model_context_window 258,400; max observed 236,013.
  ['gpt-', 300_000],
];

function contextWindowFor(model) {
  for (const [prefix, window] of CONTEXT_WINDOWS) {
    if (model.startsWith(prefix)) return window;
  }
  return null;
}

function isZeroToken(s) {
  return !(s.inputTokens || s.outputTokens || s.cacheReadTokens || s.cacheWriteTokens);
}

// Split a source-reported total cost across the four token buckets. We don't
// know the tool's own rates, so weight by the standard Claude-style multipliers
// (output is pricier per token, cache reads far cheaper) as a reasonable proxy.
const SPLIT_WEIGHTS = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
function splitCost(cost, s) {
  const w = {
    input: (s.inputTokens || 0) * SPLIT_WEIGHTS.input,
    output: (s.outputTokens || 0) * SPLIT_WEIGHTS.output,
    cacheRead: (s.cacheReadTokens || 0) * SPLIT_WEIGHTS.cacheRead,
    cacheWrite: (s.cacheWriteTokens || 0) * SPLIT_WEIGHTS.cacheWrite,
  };
  const total = w.input + w.output + w.cacheRead + w.cacheWrite;
  if (!total) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    input: (cost * w.input) / total,
    output: (cost * w.output) / total,
    cacheRead: (cost * w.cacheRead) / total,
    cacheWrite: (cost * w.cacheWrite) / total,
  };
}

function weightOf(t) {
  return (t.input || 0) * SPLIT_WEIGHTS.input
    + (t.output || 0) * SPLIT_WEIGHTS.output
    + (t.cacheRead || 0) * SPLIT_WEIGHTS.cacheRead
    + (t.cacheWrite || 0) * SPLIT_WEIGHTS.cacheWrite;
}

// Costs are rounded to 8dp purely to keep tokens.json compact — a session's
// day rows are emitted ~2,629 times across the corpus. The rounding is well
// inside the epsilon the sum invariants are asserted at.
const round8 = n => Math.round(n * 1e8) / 1e8;

/**
 * Turn a parser's per-day token slices into the emitted `daily` rows, pricing
 * each day the same way the session total was priced so the days sum back to
 * `costParts`.
 *
 * Estimated cost is linear in tokens, so per-day `costBreakdown` sums exactly.
 * A source-reported cost has no per-day equivalent, so it is allocated across
 * days by the same weights `splitCost` uses and then split within each day —
 * which reduces to exactly `costParts` in the single-slice case, the only case
 * that occurs today (opencode).
 */
function buildDaily(s, model, costEstimated, cost) {
  const slices = s.dailyTokens || [];
  if (!slices.length) return [];

  const totalWeight = costEstimated ? 0 : slices.reduce((sum, d) => sum + weightOf(d), 0);

  const rows = slices.map(d => {
    const asSession = {
      model,
      inputTokens: d.input || 0,
      outputTokens: d.output || 0,
      cacheReadTokens: d.cacheRead || 0,
      cacheWriteTokens: d.cacheWrite || 0,
      cacheWrite1hTokens: d.cacheWrite1h || 0,
    };
    let parts = costEstimated ? costBreakdown(asSession) : null;
    if (!parts) {
      const share = totalWeight ? (cost * weightOf(d)) / totalWeight : 0;
      parts = splitCost(share, asSession);
    }
    return [
      d.day,
      d.calls || 0,
      asSession.inputTokens,
      asSession.outputTokens,
      asSession.cacheReadTokens,
      asSession.cacheWriteTokens,
      round8(parts.input),
      round8(parts.output),
      round8(parts.cacheRead),
      round8(parts.cacheWrite),
      d.turns || 0,
    ];
  });

  // DAILY_COLUMNS enforced nothing until now: buildDaily hand-builds this row
  // and addDay hand-writes the zeroed slice, which is how cacheWrite1h ended
  // up accumulated and priced but absent from the emitted row. Assert the
  // length so a third column-ordering bug cannot hide here.
  for (const row of rows) {
    if (row.length !== DAILY_COLUMNS.length) {
      throw new Error(
        `daily row has ${row.length} columns, DAILY_COLUMNS declares ${DAILY_COLUMNS.length}`
      );
    }
  }
  return rows;
}

export function normalize(sessions, projects) {
  const normalized = sessions
    .filter(s => !isZeroToken(s))
    .map(s => {
      let project = matchProject(s.cwd || s.projectPath || s.project, projects);
      if (project === 'other' && s.project && s.project !== 'other') {
        project = s.project;
      }

      // Content-dominance fallback: a session launched outside any project
      // (Codex from $HOME) can still be attributed from the paths it touched —
      // but only on strong evidence: the winner needs at least 3 references
      // and either a strict majority of all project-resolving references or
      // 3x the runner-up (the latter covers "listed every project once, then
      // worked in one"). Ties and thin evidence honestly stay "other".
      // Inferred labels are flagged so the UI never presents them as recorded
      // fact.
      let projectInferred = false;
      if (project === 'other' && s.contentPathRefs) {
        const tally = {};
        let total = 0;
        for (const [ref, count] of Object.entries(s.contentPathRefs)) {
          const name = matchProject(ref, projects);
          if (name === 'other') continue;
          tally[name] = (tally[name] || 0) + count;
          total += count;
        }
        const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        if (ranked.length > 0) {
          const [winner, count] = ranked[0];
          const runnerUp = ranked[1]?.[1] || 0;
          if (count >= 3 && (count > total / 2 || count >= 3 * runnerUp)) {
            project = winner;
            projectInferred = true;
          }
        }
      }

      // Tools that report tokens but no cost (Claude transcripts) get a cost
      // derived from token usage x model pricing; source-reported cost wins.
      let cost = s.cost || 0;
      let costEstimated = false;
      let costParts;
      if (!cost) {
        const parts = costBreakdown(s);
        if (parts) {
          cost = parts.input + parts.output + parts.cacheRead + parts.cacheWrite;
          costEstimated = true;
          costParts = parts;
        }
      }
      // Break cost into input/output/cache components for the composition view.
      if (!costParts) costParts = splitCost(cost, s);

      const model = s.model || 'unknown';
      return {
        id: s.id,
        tool: s.tool,
        project,
        projectInferred,
        model,
        startedAt: s.startedAt || null,
        inputTokens: s.inputTokens || 0,
        outputTokens: s.outputTokens || 0,
        cacheReadTokens: s.cacheReadTokens || 0,
        cacheWriteTokens: s.cacheWriteTokens || 0,
        cacheWrite1hTokens: s.cacheWrite1hTokens || 0,
        cost,
        costEstimated,
        costParts,
        apiCalls: s.apiCalls || 0,
        userTurns: s.userTurns ?? null,
        isSubagent: !!s.isSubagent,
        daily: buildDaily(s, model, costEstimated, cost),
        currency: s.currency || 'USD',
      };
    });

  // A model missing from the pricing table costs $0 forever and no test catches
  // it — the sessions look fine, they just don't add up. Surface each one with
  // the tokens it silently dropped so a new model family gets noticed on the
  // first ingest after it appears, not months later.
  const unpricedModels = {};
  // A model we never identified is a different failure from a model we can't
  // price: there is no rate to add, the PARSER dropped the attribution. The
  // unpriced check above exempts both 'unknown' and anything carrying a cost,
  // and two real opencode sessions sat in that gap for months — 31.8M tokens
  // filed under 'unknown' while the tool's own recorded cost kept them quiet.
  // Counted separately so neither exemption can hide a parser regression.
  const unknownModelSessions = { sessions: 0, tokens: 0 };
  for (const s of normalized) {
    const tokens = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    if (!tokens) continue;
    if (s.model === 'unknown') {
      unknownModelSessions.sessions += 1;
      unknownModelSessions.tokens += tokens;
      continue;
    }
    if (s.cost) continue;
    const entry = (unpricedModels[s.model] ||= { sessions: 0, tokens: 0 });
    entry.sessions += 1;
    entry.tokens += tokens;
  }

  // Two checks that CAN fire, unlike a "tokens but no apiCalls" counter: for
  // claude and codex both quantities come from the same loop, so apiCalls >= 1
  // whenever tokens > 0 by construction, and the converse is filtered by
  // isZeroToken above. These catch the failures that are actually reachable.
  //
  // overWindow: a per-day context-per-call above the model's context window is
  // arithmetically impossible, so it means the delta accounting drifted — the
  // exact regression that once made Codex read ~3x high.
  const overWindowSessions = { sessions: 0, worst: 0, model: null };
  // callsByTool: a parser that silently stops counting shows up here as a step
  // change instead of a flatline nobody notices.
  const callsByTool = {};
  for (const s of normalized) {
    callsByTool[s.tool] = (callsByTool[s.tool] || 0) + s.apiCalls;
    const window = contextWindowFor(s.model);
    if (!window) continue;
    for (const [, calls, input, , cacheRead, cacheWrite] of s.daily) {
      if (!calls) continue;
      const perCall = (input + cacheRead + cacheWrite) / calls;
      if (perCall <= window) continue;
      overWindowSessions.sessions += 1;
      if (perCall > overWindowSessions.worst) {
        overWindowSessions.worst = Math.round(perCall);
        overWindowSessions.model = s.model;
      }
      break;
    }
  }

  const totals = normalized.reduce(
    (acc, s) => ({
      cost: acc.cost + s.cost,
      tokens: acc.tokens + s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens,
      sessions: acc.sessions + 1,
    }),
    { cost: 0, tokens: 0, sessions: 0 }
  );

  // Turn capability is a filter: the share of cost carried by tools whose
  // turns we can count, so later tasks can compute turn-based factors over
  // that subset only and report what got excluded rather than hiding it.
  const turnCoverage = normalized.reduce(
    (acc, s) => {
      if (TURN_CAPABLE_TOOLS.has(s.tool)) acc.cost += s.cost;
      else acc.excludedCost += s.cost;
      return acc;
    },
    { cost: 0, excludedCost: 0 }
  );
  turnCoverage.share = (turnCoverage.cost + turnCoverage.excludedCost)
    ? turnCoverage.cost / (turnCoverage.cost + turnCoverage.excludedCost)
    : 0;
  totals.turnCoverage = turnCoverage;

  return { normalized, totals, unpricedModels, unknownModelSessions, overWindowSessions, callsByTool };
}
