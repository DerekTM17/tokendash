// packages/hooks/lib/stale-reads.mjs
// Count file reads whose content is superseded by a later edit to the same path.
//
// Only called AFTER the decision to fire, so a full read of the transcript is
// acceptable here (measured: ~0.04s for 8MB, against a 60s hook timeout). It is
// deliberately NOT in the hot path.

import fs from 'node:fs';

const STALE_GAP_ENTRIES = Number(process.env.CTX_STALE_GAP_ENTRIES || 50);
const EDITORS = new Set(['Edit', 'Write', 'NotebookEdit']);

/**
 * @returns number of reads superseded by an edit at least `gapEntries` later.
 */
export function countStaleReads(transcriptPath, gapEntries = STALE_GAP_ENTRIES) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return 0;
  }

  const firstRead = new Map();   // path -> earliest read index
  const firstEdit = new Map();   // path -> earliest edit index

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
      if (b.name === 'Read' && !firstRead.has(p)) firstRead.set(p, idx);
      else if (EDITORS.has(b.name) && !firstEdit.has(p)) firstEdit.set(p, idx);
    }
  });

  let stale = 0;
  for (const [p, readIdx] of firstRead) {
    const editIdx = firstEdit.get(p);
    if (editIdx !== undefined && editIdx - readIdx >= gapEntries) stale++;
  }
  return stale;
}
