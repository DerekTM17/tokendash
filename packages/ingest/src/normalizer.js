import { discoverProjects, matchProject } from './discovery.js';
import { estimateCost, costBreakdown } from './pricing.js';

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

      return {
        id: s.id,
        tool: s.tool,
        project,
        projectInferred,
        model: s.model || 'unknown',
        startedAt: s.startedAt || null,
        duration: s.duration || null,
        inputTokens: s.inputTokens || 0,
        outputTokens: s.outputTokens || 0,
        cacheReadTokens: s.cacheReadTokens || 0,
        cacheWriteTokens: s.cacheWriteTokens || 0,
        cost,
        costEstimated,
        costParts,
        currency: s.currency || 'USD',
      };
    });

  // A model missing from the pricing table costs $0 forever and no test catches
  // it — the sessions look fine, they just don't add up. Surface each one with
  // the tokens it silently dropped so a new model family gets noticed on the
  // first ingest after it appears, not months later.
  const unpricedModels = {};
  for (const s of normalized) {
    if (s.cost || s.model === 'unknown') continue;
    const tokens = s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens;
    if (!tokens) continue;
    const entry = (unpricedModels[s.model] ||= { sessions: 0, tokens: 0 });
    entry.sessions += 1;
    entry.tokens += tokens;
  }

  const totals = normalized.reduce(
    (acc, s) => ({
      cost: acc.cost + s.cost,
      tokens: acc.tokens + s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens,
      sessions: acc.sessions + 1,
    }),
    { cost: 0, tokens: 0, sessions: 0 }
  );

  return { normalized, totals, unpricedModels };
}
