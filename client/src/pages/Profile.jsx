import { useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePrefs, ACCENTS, DEFAULT_DIM } from '../context/PrefsContext.jsx';
import DashLayout from '../components/DashLayout.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import AvatarCropper from '../components/AvatarCropper.jsx';
import RegionSelect from '../components/RegionSelect.jsx';
import { DEFAULT_REGION } from '../data/regions.js';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../constants.js';
import { LoadingOverlay } from '../components/LoadingCat.jsx';

const splitName = (name) => {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
};

const initials = (name) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;

export default function Profile() {
  const [confirm, confirmDialog] = useConfirm();

  const { user, setUser, isAudit } = useAuth();
  const { avatar, setAvatar, wallpaper, setWallpaper, accent, setAccent, dim, setDim } = usePrefs();

  const initial = splitName(user.name);
  const [form, setForm] = useState({
    first: initial.first,
    last: initial.last,
    region: user.region || DEFAULT_REGION,
  });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  // What is currently being written, if anything — drives the loading cover.
  const [working, setWorking] = useState('');
  // Holds the picked file while the crop dialog is open.
  const [cropping, setCropping] = useState(null);

  const avatarInput = useRef(null);
  const wallpaperInput = useRef(null);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function pickImage(e, apply, label) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return setMessage({ type: 'error', text: 'That file is not an image.' });
    }

    try {
      setWorking(`Uploading ${label.toLowerCase()}…`);
      await apply(file); // stored at full resolution
      setMessage({ type: 'success', text: `${label} updated (${formatSize(file.size)}).` });
    } catch (err) {
      const full = err?.name === 'QuotaExceededError';
      setMessage({
        type: 'error',
        text: full
          ? `Not enough browser storage left for that ${label.toLowerCase()}. Free some space or pick a smaller file.`
          : `Could not save that ${label.toLowerCase()}.`,
      });
    } finally {
      setWorking('');
    }
  }

  /** Profile pictures go through the crop dialog rather than being stored raw. */
  function pickAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      return setMessage({ type: 'error', text: 'That file is not an image.' });
    }
    setMessage(null);
    setCropping(file);
  }

  async function saveCropped(blob) {
    try {
      // Close the cropper first, so the cover is what the user sees.
      setCropping(null);
      setWorking('Uploading profile picture…');
      await setAvatar(blob);
      setMessage({ type: 'success', text: `Profile picture updated (${formatSize(blob.size)}).` });
    } catch (err) {
      setCropping(null);
      const full = err?.name === 'QuotaExceededError';
      setMessage({
        type: 'error',
        text: full
          ? 'Not enough browser storage left for that picture. Free some space and try again.'
          : 'Could not save that picture.',
      });
    } finally {
      setWorking('');
    }
  }

  async function clearImage(apply, label) {
    // This had no confirmation at all before, and the image is gone for good —
    // nothing keeps a copy once the server has dropped it.
    const ok = await confirm({
      title: `Remove your ${label.toLowerCase()}?`,
      body: 'It is deleted from your account. You would need the original file to put it back.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;

    try {
      setWorking(`Removing ${label.toLowerCase()}…`);
      await apply(null);
      setMessage({ type: 'success', text: `${label} removed.` });
    } catch {
      setMessage({ type: 'error', text: `Could not remove that ${label.toLowerCase()}.` });
    } finally {
      setWorking('');
    }
  }

  async function save() {
    setMessage(null);

    const name = `${form.first.trim()} ${form.last.trim()}`.trim();
    if (!name) return setMessage({ type: 'error', text: 'First name is required.' });

    const changingPassword = Boolean(passwords.next || passwords.confirm);
    if (changingPassword) {
      if (passwords.next !== passwords.confirm) {
        return setMessage({ type: 'error', text: 'Passwords do not match.' });
      }
      if (passwords.next.length < MIN_PASSWORD_LENGTH) {
        return setMessage({ type: 'error', text: `${PASSWORD_RULE}.` });
      }
      if (!passwords.current) {
        return setMessage({ type: 'error', text: 'Enter your current password to change it.' });
      }
    }

    setBusy(true);
    setWorking(changingPassword ? 'Saving profile and password…' : 'Saving profile…');
    try {
      // Audit accounts have no region field, so nothing to send for it.
      const { data } = await api.patch('/users/me', isAudit ? { name } : { name, region: form.region });
      setUser(data.user);

      if (changingPassword) {
        await api.post('/users/me/password', {
          currentPassword: passwords.current,
          newPassword: passwords.next,
        });
        setPasswords({ current: '', next: '', confirm: '' });
      }

      setMessage({
        type: 'success',
        text: changingPassword ? 'Profile and password updated.' : 'Profile updated.',
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not save your changes') });
    } finally {
      setBusy(false);
      setWorking('');
    }
  }

  const previewName = `${form.first} ${form.last}`.trim() || user.name;
  const activeAccent = ACCENTS.find((a) => a.id === accent) || ACCENTS[0];

  return (
    <DashLayout title="My Account" subtitle="Update your profile and account details" flush>
      {cropping && (
        <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onConfirm={saveCropped} />
      )}

      {message && (
        <div className={message.type === 'error' ? 'dash-error' : 'dash-success'} role="alert">
          {message.text}
        </div>
      )}

      {/* Audit accounts get the settings column only — no picture, wallpaper or
          accent picker, so the page is a single column rather than a split. */}
      <div className={`split-row account-split is-busy${isAudit ? ' single' : ''}`}>
        <LoadingOverlay show={Boolean(working)} text={working} />
        {!isAudit && (
        <div className="split-cell">
          <div className="section-title">Personalization</div>
          <div className="section-sub">Picture, wallpaper and accent colour. Saved to this device instantly.</div>

          <div className="profile-row">
            <div className="profile-preview">
              {avatar ? <img src={avatar} alt="" /> : initials(previewName)}
            </div>
            <div className="profile-actions">
              <button className="file-label" type="button" onClick={() => avatarInput.current?.click()}>
                Replace Profile Picture
              </button>
              <input
                ref={avatarInput}
                className="file-input"
                type="file"
                accept="image/*"
                onChange={pickAvatar}
              />
              {avatar && (
                <button className="ghost-btn" type="button" onClick={() => clearImage(setAvatar, 'Profile picture')}>
                  Remove Picture
                </button>
              )}
              <div className="file-note">PNG, JPG or WEBP</div>
            </div>
          </div>

          <div className="wallpaper-row">
            <div
              className="wallpaper-preview"
              style={wallpaper ? { backgroundImage: `url("${wallpaper}")` } : undefined}
            />
            <div className="wallpaper-actions">
              <div className="wallpaper-buttons">
                <button className="file-label" type="button" onClick={() => wallpaperInput.current?.click()}>
                  Upload Wallpaper
                </button>
                {wallpaper && (
                  <button className="ghost-btn" type="button" onClick={() => clearImage(setWallpaper, 'Wallpaper')}>
                    Remove Wallpaper
                  </button>
                )}
              </div>
              <input
                ref={wallpaperInput}
                className="file-input"
                type="file"
                accept="image/*"
                onChange={(e) => pickImage(e, setWallpaper, 'Wallpaper')}
              />
              <div className="file-note">
                Choose a background image for your portal. Stored at full resolution — 4K is fine.
              </div>
            </div>
          </div>

          <div className="dim-row">
            <div className="dim-head">
              <span className="theme-color-title">Background Dimming</span>
              <span className="dim-value">{dim}%</span>
            </div>
            <input
              type="range"
              className="dim-slider"
              min="0"
              max="100"
              step="1"
              value={dim}
              onChange={(e) => setDim(e.target.value)}
              disabled={!wallpaper}
              aria-label="Background dimming"
            />
            <div className="dim-foot">
              <span className="file-note">
                {wallpaper ? 'Higher dims the wallpaper behind your content.' : 'Upload a wallpaper to use this.'}
              </span>
              {wallpaper && dim !== DEFAULT_DIM && (
                <button className="link-btn" type="button" onClick={() => setDim(DEFAULT_DIM)}>
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="theme-color-row">
            <div className="theme-color-title">Theme Color</div>
            <div className="theme-color-options">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`color-choice${a.id === accent ? ' active' : ''}`}
                  style={{ background: a.swatch }}
                  onClick={() => setAccent(a.id)}
                  aria-label={`${a.label} theme`}
                  aria-pressed={a.id === accent}
                />
              ))}
            </div>
            <div className="color-name">{activeAccent.label}</div>
          </div>
        </div>
        )}

        <div className="split-cell">
          <div className="section-title">Account Settings</div>
          <div className="section-sub">
            {isAudit ? 'Manage your personal details.' : 'Manage your personal details and region.'}
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="firstName">First Name</label>
              <input id="firstName" type="text" value={form.first} onChange={update('first')} required />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last Name</label>
              <input id="lastName" type="text" value={form.last} onChange={update('last')} />
            </div>

            <div className="field">
              <label htmlFor="accountUsername">Username</label>
              <input id="accountUsername" type="text" value={user.username} readOnly />
              <div className="form-note">Cannot be changed.</div>
            </div>

            {/* Region tracks where a moderator works; audit accounts have none. */}
            {!isAudit && (
              <div className="field">
                <label htmlFor="region">Region</label>
                <RegionSelect
                  id="region"
                  value={form.region}
                  onChange={(region) => setForm((f) => ({ ...f, region }))}
                />
                <div className="form-note">Update this if you move to another country or region.</div>
              </div>
            )}
          </div>

          <div className="divider" />

          <div className="section-title">Change Password</div>
          <div className="section-sub">Set a new password for your account.</div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="currentPassword">Current Password</label>
              <input
                id="currentPassword"
                type="password"
                value={passwords.current}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
              <div className="form-note">Required only when setting a new password.</div>
            </div>

            <div className="field">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                value={passwords.next}
                onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                placeholder="Enter new password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
              />
              <div className="form-note">{PASSWORD_RULE}.</div>
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={passwords.confirm}
                onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="actions">
            <button className="save-btn" type="button" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </DashLayout>
  );
}
