import { discoverProjects, matchProject } from './discovery.js';
import { estimateCost } from './pricing.js';

function isZeroToken(s) {
  return !(s.inputTokens || s.outputTokens || s.cacheReadTokens || s.cacheWriteTokens);
}

export function normalize(sessions, projects) {
  const normalized = sessions
    .filter(s => !isZeroToken(s))
    .map(s => {
      let project = matchProject(s.cwd || s.projectPath || s.project, projects);
      if (project === 'other' && s.project && s.project !== 'other') {
        project = s.project;
      }

      // Tools that report tokens but no cost (Claude transcripts) get a cost
      // derived from token usage x model pricing; source-reported cost wins.
      let cost = s.cost || 0;
      let costEstimated = false;
      if (!cost) {
        const estimated = estimateCost(s);
        if (estimated != null) {
          cost = estimated;
          costEstimated = true;
        }
      }

      return {
        id: s.id,
        tool: s.tool,
        project,
        model: s.model || 'unknown',
        startedAt: s.startedAt || null,
        duration: s.duration || null,
        inputTokens: s.inputTokens || 0,
        outputTokens: s.outputTokens || 0,
        cacheReadTokens: s.cacheReadTokens || 0,
        cacheWriteTokens: s.cacheWriteTokens || 0,
        cost,
        costEstimated,
        currency: s.currency || 'USD',
      };
    });

  const totals = normalized.reduce(
    (acc, s) => ({
      cost: acc.cost + s.cost,
      tokens: acc.tokens + s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens,
      sessions: acc.sessions + 1,
    }),
    { cost: 0, tokens: 0, sessions: 0 }
  );

  return { normalized, totals };
}
