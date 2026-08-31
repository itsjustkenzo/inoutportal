import { useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';

/**
 * One admin note against one moderator on one day.
 *
 * Saved when the field loses focus or on Enter, rather than per keystroke — a
 * remark is a sentence, not a slider, and a request per character would be
 * wasteful and would race itself.
 *
 * `readOnly` renders the text without a field, for the finance view, which is
 * read-only by design.
 */
export default function RemarkCell({ userId, date, value, readOnly = false, onSaved, onError }) {
  const [text, setText] = useState(value || '');
  const [saving, setSaving] = useState(false);
  // What is actually stored, so blurring an untouched field saves nothing.
  const saved = useRef(value || '');

  // A different day or a reload brings different notes.
  useEffect(() => {
    setText(value || '');
    saved.current = value || '';
  }, [value, userId, date]);

  /*
   * The value comes from the field itself rather than from state. A blur that
   * lands in the same tick as the last change would otherwise read the previous
   * render's `text` and conclude nothing had changed — dropping the edit.
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
  );
}
