import { useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../constants.js';

/**
 * The password column of an account row.
 *
 * Idle it shows dots and an Edit button; editing swaps in a field so the admin
 * can type a password of their choosing. The lock button beside it still issues
 * a random one — both go through the same endpoint, so there is one code path
 * that sets somebody else's password.
 *
 * The field is never seeded with the current password: the server stores a hash
 * and could not supply one, and a blank field makes it plain that this sets a
 * new password rather than revealing the old.
 */
export default function PasswordCell({ mod, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  function stop() {
    setEditing(false);
    setValue('');
    setShow(false);
  }

  async function save() {
    const next = value.trim();
    if (next.length < MIN_PASSWORD_LENGTH) {
      onError?.(PASSWORD_RULE);
      return;
    }

    setSaving(true);
    try {
      await api.post(`/users/${mod.id}/reset-password`, { password: next });
      onSaved?.(`Password updated for ${mod.name}. Pass it on — it is not shown again.`);
      stop();
    } catch (err) {
      onError?.(errorMessage(err, 'Could not set that password'));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="password-cell">
        <span className="password-dots">••••••••</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => setEditing(true)}
          aria-label={`Set a password for ${mod.name}`}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="password-edit">
      <div className="password-field">
        <input
          className="form-input compact"
          type={show ? 'text' : 'password'}
          value={value}
          autoFocus
          autoComplete="new-password"
          placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') stop();
          }}
          aria-label={`New password for ${mod.name}`}
        />
        <button
          type="button"
          className="password-reveal small"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
          {show ? (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2" />
              <path d="M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7a12 12 0 0 1-2.4 3.2M6.2 6.6C3.9 8.1 3 10.4 3 12c0 2.5 4 7 9 7a9.6 9.6 0 0 0 3.3-.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      <button
        type="button"
        className="pw-btn save"
        onClick={save}
        disabled={saving || value.trim().length < MIN_PASSWORD_LENGTH}
        title={value.trim().length < MIN_PASSWORD_LENGTH ? PASSWORD_RULE : 'Save this password'}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="pw-btn" onClick={stop} disabled={saving}>
        Cancel
      </button>
    </div>
  );
}
