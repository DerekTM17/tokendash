// packages/hooks/lib/stale-reads.mjs
// Count files whose in-context copy is superseded by a later edit to the same path.
//
// Walks the transcript in order, pairing each Read with the NEXT edit to the same
// path (not just the first-ever read/edit — a re-read refreshes the copy in context,
// and an edit consumes the outstanding read whether or not it clears the gap). Each
// path counts at most once, since the directive this feeds says "N files", not "N
// read events".
//
// Only called AFTER the decision to fire, so a full read of the transcript is
// acceptable here (measured: ~0.04s for 8MB, against a 60s hook timeout). It is
// deliberately NOT in the hot path.

import fs from 'node:fs';
import { numEnv } from './env.mjs';

// Why the gap threshold exists: measured across all main transcripts, 633 of 1,170
// reads are followed by an edit to the same path, but the median gap is 2 entries
// and 51.7% are <=2 — that's mandatory read-before-edit (Edit refuses to run without
// a prior Read), not waste. Only a gap of 50+ entries means the content actually went
// stale before it was acted on.
const STALE_GAP_ENTRIES = numEnv('CTX_STALE_GAP_ENTRIES', 50);
const EDITORS = new Set(['Edit', 'Write', 'NotebookEdit']);

/**
 * @returns number of distinct paths whose read was superseded by an edit at
 *   least `gapEntries` later.
 */
export function countStaleReads(transcriptPath, gapEntries = STALE_GAP_ENTRIES) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return 0;
  }

  const outstandingRead = new Map(); // path -> index of the most recent unconsumed read
  const stalePaths = new Set();

  lines.forEach((line, idx) => {
    if (!line) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return; // a truncated or malformed line must not abort the scan
    }
    if (ev?.isSidechain) return;
    const content = ev?.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const p = b?.input?.file_path;
      if (typeof p !== 'string') continue;
      if (b.name === 'Read') {
        outstandingRead.set(p, idx); // a re-read refreshes the copy in context
      } else if (EDITORS.has(b.name)) {
        const readIdx = outstandingRead.get(p);
        if (readIdx !== undefined) {
          if (idx - readIdx >= gapEntries) stalePaths.add(p);
          outstandingRead.delete(p); // the edit consumes the read either way
        }
      }
    }
  });

  return stalePaths.size;
}
