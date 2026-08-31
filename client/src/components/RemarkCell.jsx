import { useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';

/**
 * One admin note against one moderator on one day.
 *
 * Saved by the button, by Enter, or by clicking away — never per keystroke. A
 * remark is a sentence, not a slider, and a request per character would be
 * wasteful and would race itself.
 *
 * `readOnly` renders the text without a field, for the finance view, which is
 * read-only by design.
 */
export default function RemarkCell({ userId, date, value, readOnly = false, onSaved, onError }) {
  const [text, setText] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // What is actually stored, so an untouched field saves nothing.
  const saved = useRef(value || '');
  const flash = useRef(null);

  /*
   * A different row or day brings a different note, so the field is reseeded.
   *
   * A value equal to what was just stored is this cell's own save coming back
   * through the parent, not new information — reseeding on that would wipe the
   * "Saved" confirmation the instant it appeared. The key is compared as well
   * as the text, so switching to a day that happens to carry identical wording
   * still resets properly.
   */
  const key = `${userId}|${date}`;
  const lastKey = useRef(key);

  useEffect(() => {
    const incoming = value || '';
    const switched = lastKey.current !== key;
    lastKey.current = key;

    if (!switched && incoming === saved.current) return;

    setText(incoming);
    saved.current = incoming;
    setJustSaved(false);
  }, [value, key]);

  useEffect(() => () => clearTimeout(flash.current), []);

  const dirty = text.trim() !== saved.current;

  /*
   * The value comes from the field itself rather than from state. A blur that
   * lands in the same tick as the last change would otherwise read the previous
   * render's `text` and conclude nothing had changed, dropping the edit.
   */
  async function commit(raw) {
    const next = String(raw ?? text).trim();
    if (next === saved.current) return;

    setSaving(true);
    try {
      await api.put('/remarks', { userId, date, text: next });
      saved.current = next;
      setText(next);
      onSaved?.(userId, next);

      setJustSaved(true);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setJustSaved(false), 1600);
    } catch (err) {
      // Put the stored value back, so the cell never shows something the
      // server did not accept.
      setText(saved.current);
      onError?.(errorMessage(err, 'Could not save that remark'));
    } finally {
      setSaving(false);
    }
  }

  if (readOnly) {
    return <span className={`remark-text${text ? '' : ' empty'}`}>{text || '—'}</span>;
  }

  return (
    <div className="remark-wrap">
      <input
        className={`remark-input${saving ? ' saving' : ''}`}
        type="text"
        value={text}
        maxLength={500}
        placeholder="Add a remark…"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          // Escape abandons the edit rather than saving half a sentence.
          if (e.key === 'Escape') {
            setText(saved.current);
            e.currentTarget.blur();
          }
        }}
        aria-label={`Remark for ${date}`}
      />

      {/*
        * preventDefault on mousedown keeps focus in the field, so the button is
        * not unmounted by its own blur handler before the click lands — the
        * classic way a save button appears to do nothing.
        */}
      <button
        type="button"
        className={`remark-save${justSaved ? ' saved' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit()}
        disabled={saving || (!dirty && !justSaved)}
        title={dirty ? 'Save this remark' : 'Nothing to save'}
      >
        {justSaved ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 13 4 4L19 7" />
            </svg>
            Saved
          </>
        ) : (
          saving ? 'Saving…' : 'Save'
        )}
      </button>
    </div>
  );
}
