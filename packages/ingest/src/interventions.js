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

/**
 * Attach frozen results to their interventions.
 *
 * A verdict is only computable while its before-window is still on disk. Once
 * the 30-day retention sweep passes that window, the same intervention re-reads
 * as `refused` — the number changes because history was deleted, not because
 * anything about the work changed. Freezing a matured result keeps a record of
 * what was true when it could still be measured.
 *
 * The sidecar is written by the dashboard operator, not by ingest; ingest only
 * carries it through to tokens.json. Because it is hand-edited, a frozen entry
 * is validated the same way readInterventions validates interventions.json:
 * warn and skip rather than attach garbage that would crash the dashboard's
 * render. Returns `{ entries, warnings }`, the same contract as
 * `readInterventions` above, so the two warn-and-skip functions in this module
 * read the same way; `index.js` prints the warnings through its existing
 * `WARNING:` loop.
 */
export function mergeResults(entries, sidecarPath) {
  const warnings = [];
  const bail = () => ({ entries: [...entries], warnings });
  if (!fs.existsSync(sidecarPath)) return bail();

  let frozen;
  try {
    frozen = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch (e) {
    warnings.push(`interventions.results.json is not valid JSON (${e.message}) — ignoring the file.`);
    return bail();
  }
  if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen)) {
    warnings.push('interventions.results.json must be an object keyed by "date::label" — ignoring the file.');
    return bail();
  }

  const merged = entries.map(e => {
    const key = `${e.date}::${e.label}`;
    if (!(key in frozen)) return e;
    const result = frozen[key];
    if (!result || typeof result !== 'object' || typeof result.verdict !== 'string') {
      warnings.push(`interventions.results.json["${key}"] is not a valid frozen result — ignoring.`);
      return e;
    }
    return { ...e, result };
  });
  return { entries: merged, warnings };
}
