/**
 * Read declared interventions.
 *
 * Warns and skips bad entries rather than aborting. `index.js` already warns and
 * continues on unpriced and unidentified models, and aborting here would kill
 * tokens.json regeneration in --watch mode over a typo in an optional file,
 * taking the whole dashboard down for a config error.
 */
import fs from 'node:fs';

export const FACTOR_KEYS = [
  'activeDays',
  'turnsPerActiveDay',
  'requestsPerTurn',
  'tokensPerRequest',
  'pricePerToken',
];

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function readInterventions(filePath) {
  const warnings = [];
  if (!fs.existsSync(filePath)) return { entries: [], warnings };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    warnings.push(`interventions.json is not valid JSON (${e.message}) — ignoring the file.`);
    return { entries: [], warnings };
  }
  if (!Array.isArray(raw)) {
    warnings.push('interventions.json must be an array — ignoring the file.');
    return { entries: [], warnings };
  }

  const entries = [];
  for (const [i, entry] of raw.entries()) {
    const where = `interventions.json[${i}]`;
    if (!entry || typeof entry !== 'object') {
      warnings.push(`${where} is not an object — skipped.`);
      continue;
    }
    if (!isDay(entry.date)) {
      warnings.push(`${where} has no valid YYYY-MM-DD "date" — skipped.`);
      continue;
    }
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      warnings.push(`${where} has no "label" — skipped.`);
      continue;
    }
    if (!FACTOR_KEYS.includes(entry.expect)) {
      warnings.push(
        `${where} has "expect": ${JSON.stringify(entry.expect)}, which is not a factor. ` +
        `Valid keys: ${FACTOR_KEYS.join(', ')} — skipped.`
      );
      continue;
    }
    entries.push({
      date: entry.date,
      label: entry.label,
      expect: entry.expect,
      note: typeof entry.note === 'string' ? entry.note : '',
      // Pre-registered categories exempt from the confound verdict. Cost shares
      // are endogenous: an intervention that scopes subagent dispatches better
      // drops subagent cost share by design, and flagging that would mark every
      // successful intervention confounded.
      expectedShift: Array.isArray(entry.expectedShift) ? entry.expectedShift : [],
    });
  }
  return { entries, warnings };
}
