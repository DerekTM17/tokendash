/**
 * What counts as a user turn.
 *
 * Isolated in its own module because a wrong predicate here silently corrupts
 * every factor downstream, and the failure is not loud: counting `type ===
 * 'user'` naively admits 2,112 entries where 1,607 are real turns, because
 * Claude Code logs tool results, system reminders and slash-command echoes as
 * user-role entries. The tell is Requests/Turn landing at 0.72 — below 1, which
 * is structurally impossible.
 *
 * Verified against the full local corpus (116 main transcripts): the naive rule
 * admitted 93 non-prompts (5.5%) that none of `isMeta` alone would have caught —
 * 41 slash-command echoes, 14 local-command-stdout echoes, 14 compaction
 * summaries, 14 interrupt markers, 10 bare system reminders.
 */

/** Text shapes Claude Code writes into user entries that are not prompts. */
const NON_PROMPT = [
  /^<command-name>/,
  /<local-command-stdout>/,
  /^\[Request interrupted/,
  /^<system-reminder>/,
];

/** The entry's prompt text: a string body, or the first `text` part of an
 *  array body. Multi-part content (text + image) is common and real. */
export function turnText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const part = content.find(p => p && p.type === 'text');
    return (part && part.text) || '';
  }
  return '';
}

/**
 * True when this transcript entry is a human turn.
 *
 * `isSidechain` is defensive: there are 0 such entries inside main transcripts
 * today, but older Claude Code versions inlined sidechains rather than writing
 * them to subagents/, and the clause costs nothing.
 */
export function isUserTurn(entry) {
  if (!entry || entry.type !== 'user') return false;
  if (entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false;

  const content = entry.message?.content;
  if (content == null) return false;
  if (Array.isArray(content)) {
    if (content.length === 0) return false;
    if (content[0]?.type === 'tool_result') return false;
  }

  const text = turnText(entry).trim();
  return !NON_PROMPT.some(re => re.test(text));
}
