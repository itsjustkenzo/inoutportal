import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A confirmation before anything destructive.
 *
 * Replaces window.confirm, which cannot be styled, looks like the browser
 * rather than the app, and is suppressed outright by some browsers when a page
 * shows too many — exactly the situation an admin deleting several records in a
 * row would hit, and it fails by silently returning false.
 *
 * Portalled to the body for the same reason the region picker is: the panels it
 * would otherwise open inside set `overflow: hidden` and would clip it.
 */
function Dialog({ title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true, onResolve }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  /*
   * Focus lands on Cancel, not on the destructive button. Someone who hits
   * Enter out of habit should not thereby delete a month of records; they have
   * to move to the other button deliberately.
   */
  useEffect(() => {
    (danger ? cancelRef : confirmRef).current?.focus();
  }, [danger]);

  // The page behind must not scroll while this is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve(false);
      }
      // Keeps focus inside: tabbing past the last control wraps to the first.
      if (e.key === 'Tab') {
        const focusable = [cancelRef.current, confirmRef.current].filter(Boolean);
        if (focusable.length < 2) return;
        const [first, last] = e.shiftKey ? [focusable[0], focusable[1]] : [focusable[1], focusable[0]];
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onResolve]);

  return createPortal(
    <div
      className="confirm-backdrop"
      // Only a click on the backdrop itself dismisses — not one that started
      // inside the card and drifted out.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onResolve(false); }}
    >
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className={`confirm-icon${danger ? ' danger' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>

        <div className="confirm-text">
          <div className="confirm-title" id="confirm-title">{title}</div>
          {body && <div className="confirm-body">{body}</div>}
        </div>

        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" ref={cancelRef} onClick={() => onResolve(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-go${danger ? ' danger' : ''}`}
            ref={confirmRef}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Returns `[confirm, dialog]`.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: '…', body: '…' }))) return;
 *   …
 *   return <>{children}{confirmDialog}</>;
 *
 * `confirm` resolves true or false, so a caller reads like the window.confirm
 * it replaces and the call site keeps its early return.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);

  const confirm = useCallback(
    (options) => new Promise((resolve) => setRequest({ ...options, resolve })),
    []
  );

  const resolve = useCallback(
    (answer) => {
      setRequest((current) => {
        current?.resolve(answer);
        return null;
      });
    },
    []
  );

  return [confirm, request ? <Dialog {...request} onResolve={resolve} /> : null];
}
