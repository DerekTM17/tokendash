import { useState, useId, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { define, titleOf } from '../lib/glossary';

const WIDTH = 260;
const GAP = 8;
const MARGIN = 8;

/**
 * A small "?" beside a label that explains the jargon behind it.
 *
 * Visibility is React state rather than a CSS `:hover` rule, for two reasons:
 * keyboard users get the same tooltip as mouse users (focus opens it, Escape
 * closes it), and the behaviour is testable — a CSS-only tooltip is invisible to
 * jsdom and its tests would pass whether or not it worked.
 *
 * The bubble is PORTALLED to document.body rather than positioned inside the
 * trigger. Several panels clip their overflow (SummaryCards does it for the glow
 * effect), and an absolutely-positioned child is cut off at that boundary — so
 * the tooltip has to leave the subtree entirely and place itself in viewport
 * coordinates instead.
 *
 * An unknown term renders nothing at all rather than an empty bubble. That is a
 * silent failure in the browser, so `glossary.test.js` scans components/ for
 * every `term=` prop and fails if one has no entry.
 */
export default function InfoTip({ term }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const id = useId();
  const body = define(term);

  /** Prefer above the trigger; flip below when the bubble would run off the top,
   *  and clamp horizontally so it never leaves the viewport on a narrow window. */
  const open = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return setPos({ top: 0, left: 0, below: false });
    const room = r.top;
    const below = room < 140;
    setPos({
      top: below ? r.bottom + GAP : r.top - GAP,
      left: Math.max(MARGIN, Math.min(r.left + r.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - MARGIN)),
      below,
    });
  }, []);

  if (!body) return null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`What is ${term}?`}
        aria-describedby={pos ? id : undefined}
        aria-expanded={!!pos}
        onMouseEnter={open}
        onMouseLeave={() => setPos(null)}
        onFocus={open}
        onBlur={() => setPos(null)}
        onClick={() => (pos ? setPos(null) : open())}
        onKeyDown={e => { if (e.key === 'Escape') setPos(null); }}
        style={{
          all: 'unset',
          cursor: 'help',
          width: 13,
          height: 13,
          marginLeft: 5,
          borderRadius: '50%',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          background: 'var(--color-detail-bg)',
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          verticalAlign: 'middle',
          opacity: pos ? 1 : 0.6,
        }}
      >
        ?
      </button>
      {pos && createPortal(
        <div
          role="tooltip"
          id={id}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: pos.below ? 'none' : 'translateY(-100%)',
            zIndex: 200,
            width: WIDTH,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 12px 34px -12px rgba(0,0,0,0.85)',
            fontFamily: 'var(--f-body)',
            fontSize: 11.5,
            lineHeight: 1.55,
            color: 'var(--color-text-secondary)',
            textTransform: 'none',
            letterSpacing: 0,
            fontWeight: 400,
            textAlign: 'left',
            pointerEvents: 'none',
          }}
        >
          <div style={{ color: 'var(--cyan)', fontWeight: 600, marginBottom: 4 }}>{titleOf(term)}</div>
          {body}
        </div>,
        document.body,
      )}
    </>
  );
}
