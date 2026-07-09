import { discoverProjects, matchProject } from './discovery.js';

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
        cost: s.cost || 0,
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
