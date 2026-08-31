import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import RegionSelect from '../components/RegionSelect.jsx';
import { DEFAULT_REGION } from '../data/regions.js';
import { MIN_PASSWORD_LENGTH } from '../constants.js';
import { formatDate, formatRelative } from '../utils/time.js';
import UserAvatar from '../components/UserAvatar.jsx';

const PAGE_SIZE = 10;

const TABS = [
  ['add', 'Add New Moderator'],
  ['access', 'Access Control'],
  ['settings', 'Account Settings'],
];

const ICONS = {
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  reset: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
    </svg>
  ),
};

/** Mirrors the server's generator so the field is filled before submitting. */
function makePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function ModeratorManagement() {
  const { user: me } = useAuth();

  const [tab, setTab] = useState('add');
  const [mods, setMods] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ first: '', last: '', username: '', region: DEFAULT_REGION, password: makePassword() });
  const [showPassword, setShowPassword] = useState(true);

  const [accessQuery, setAccessQuery] = useState('');
  const [accessPage, setAccessPage] = useState(1);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [settingsPage, setSettingsPage] = useState(1);
  const [listPage, setListPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/users', { params: { role: 'employee' } });
      setMods(data.users);
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load moderators') });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function addModerator(e) {
    e.preventDefault();
    setMessage(null);

    const name = `${form.first.trim()} ${form.last.trim()}`.trim();
    if (!name) return setMessage({ type: 'error', text: 'First name is required.' });
    if (!form.username.trim()) return setMessage({ type: 'error', text: 'Username is required.' });

    setBusy(true);
    try {
      const { data } = await api.post('/users', {
        name,
        username: form.username.trim(),
        region: form.region,
        password: form.password,
      });
      setMessage({
        type: 'success',
        text: `${data.user.name} added. Temporary password: ${data.tempPassword} — copy it now, it is not shown again.`,
      });
      setForm({ first: '', last: '', username: '', region: DEFAULT_REGION, password: makePassword() });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not add that moderator') });
    } finally {
      setBusy(false);
    }
  }

  async function patchMod(id, changes, note) {
    setMessage(null);
    try {
      const { data } = await api.patch(`/users/${id}`, changes);
      setMods((prev) => prev.map((m) => (m.id === id ? data.user : m)));
      if (note) setMessage({ type: 'success', text: note });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Update failed') });
    }
  }

  async function resetPassword(mod) {
    setMessage(null);
    try {
      const { data } = await api.post(`/users/${mod.id}/reset-password`);
      setMessage({
        type: 'success',
        text: `New password for ${mod.name}: ${data.tempPassword} — copy it now, it is not shown again.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not reset that password') });
    }
  }

  async function removeMod(mod) {
    // Deleting takes their attendance history with it, so confirm first.
    const ok = window.confirm(
      `Delete ${mod.name} (@${mod.username})?\n\nThis also removes their attendance records. It cannot be undone.`
    );
    if (!ok) return;

    setMessage(null);
    try {
      const { data } = await api.delete(`/users/${mod.id}`);
      setMods((prev) => prev.filter((m) => m.id !== mod.id));
      setMessage({
        type: 'success',
        text: `${mod.name} deleted (${data.entriesRemoved} attendance record${data.entriesRemoved === 1 ? '' : 's'} removed).`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not delete that account') });
    }
  }

  const filter = (q) => {
    const needle = q.trim().toLowerCase();
    return needle
      ? mods.filter((m) => m.name.toLowerCase().includes(needle) || m.username.includes(needle))
      : mods;
  };

  const accessRows = useMemo(() => filter(accessQuery), [mods, accessQuery]);
  const settingsRows = useMemo(() => filter(settingsQuery), [mods, settingsQuery]);

  const pageOf = (list, page) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagesOf = (list) => Math.max(1, Math.ceil(list.length / PAGE_SIZE));

  const searchBox = (value, onChange) => (
    <label className="search-box">
      {ICONS.search}
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder="Search Moderator's Name"
        aria-label="Search moderator's name"
      />
    </label>
  );

  return (
    <DashLayout title="Moderator Management" subtitle="Add moderators, control access, and manage accounts" flush>
      {message && (
        <div className={message.type === 'error' ? 'dash-error' : 'dash-success'} role="alert">
          {message.text}
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab-btn${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'add' && (
        <>
          <form className="form-grid" onSubmit={addModerator}>
            <div className="form-field">
              <label className="form-label" htmlFor="first">First name</label>
              <input id="first" className="form-input" value={form.first} onChange={update('first')} placeholder="e.g. Wei Ling" required />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="last">Last name</label>
              <input id="last" className="form-input" value={form.last} onChange={update('last')} placeholder="e.g. Tan" />
            </div>

            <div className="form-field full">
              <label className="form-label" htmlFor="newUsername">Username</label>
              <input
                id="newUsername"
                className="form-input"
                value={form.username}
                onChange={update('username')}
                placeholder="e.g. wtan_mod"
                autoCapitalize="none"
                spellCheck="false"
                pattern="[A-Za-z0-9._-]{3,32}"
                title="3–32 characters: letters, numbers, dots, dashes or underscores"
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="newRegion">Region</label>
              <RegionSelect
                id="newRegion"
                value={form.region}
                onChange={(region) => setForm((f) => ({ ...f, region }))}
              />
            </div>

            <div className="form-field">
              <label className="form-label" htmlFor="newPassword">Temporary password</label>
              <div className="password-wrap">
                <input
                  id="newPassword"
                  className="form-input"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={update('password')}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
                <div className="field-inline-btns">
                  <button
                    className="icon-mini-btn"
                    type="button"
                    onClick={() => setForm({ ...form, password: makePassword() })}
                    title="Generate a new password"
                    aria-label="Generate a new password"
                  >
                    {ICONS.refresh}
                  </button>
                  <button
                    className="icon-mini-btn"
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>

            <div className="form-foot full">
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? 'Adding…' : '+  Add Moderator'}
              </button>
            </div>
          </form>

          <div className="section-head">
            <div className="panel-title">All Moderator Accounts</div>
            <div className="panel-sub">{mods.length} account{mods.length === 1 ? '' : 's'}</div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Moderator</th>
                  <th>Username</th>
                  <th>Region</th>
                  <th className="num">Date added</th>
                </tr>
              </thead>
              <tbody>
                {mods.length === 0 && (
                  <tr><td colSpan={4} className="activity-empty">No moderator accounts yet.</td></tr>
                )}
                {pageOf(mods, listPage).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar
                          userId={m.id}
                          name={m.name}
                          className={`mod-avatar ${m.active ? 'is-completed' : 'is-absent'}`}
                        />
                        <div>
                          <div className="mod-name">{m.name}</div>
                          <div className="mod-role">@{m.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{m.username}</td>
                    <td className="mono">{m.region}</td>
                    <td className="mono status-col-cell">{m.createdAt ? formatDate(m.createdAt) : '——'}</td>
                  </tr>
                ))}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(mods, listPage).length)}
                  colSpan={4}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager page={listPage} pages={pagesOf(mods)} total={mods.length} pageSize={PAGE_SIZE} onChange={setListPage} />
        </>
      )}

      {tab === 'access' && (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              {searchBox(accessQuery, (e) => {
                setAccessQuery(e.target.value);
                setAccessPage(1);
              })}
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Region</th>
                  <th>Account status</th>
                  <th>Last updated</th>
                  <th className="num">Manage</th>
                </tr>
              </thead>
              <tbody>
                {accessRows.length === 0 && (
                  <tr><td colSpan={6} className="activity-empty">No moderators match.</td></tr>
                )}
                {pageOf(accessRows, accessPage).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar
                          userId={m.id}
                          name={m.name}
                          className={`mod-avatar ${m.active ? 'is-completed' : 'is-absent'}`}
                        />
                        <div className="mod-name">{m.name}</div>
                      </div>
                    </td>
                    <td className="mono">{m.username}</td>
                    <td className="mono">{m.region}</td>
                    <td>
                      <span className={`pill-status ${m.active ? 'pill-granted' : 'pill-revoked'}`}>
                        {m.active ? 'Granted' : 'Revoked'}
                      </span>
                    </td>
                    <td className="mono">{m.updatedAt ? formatRelative(m.updatedAt) : '——'}</td>
                    <td className="status-col-cell">
                      <button
                        type="button"
                        className={`manage-btn ${m.active ? 'to-revoke' : 'to-grant'}`}
                        onClick={() =>
                          patchMod(
                            m.id,
                            { active: !m.active },
                            `${m.name} ${m.active ? 'can no longer sign in' : 'can sign in again'}.`
                          )
                        }
                      >
                        {m.active ? 'Revoke access' : 'Grant access'}
                      </button>
                    </td>
                  </tr>
                ))}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(accessRows, accessPage).length)}
                  colSpan={6}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager page={accessPage} pages={pagesOf(accessRows)} total={accessRows.length} pageSize={PAGE_SIZE} onChange={setAccessPage} />
        </>
      )}

      {tab === 'settings' && (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              {searchBox(settingsQuery, (e) => {
                setSettingsQuery(e.target.value);
                setSettingsPage(1);
              })}
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Full name</th>
                  <th>Username</th>
                  <th>Region</th>
                  <th>Password</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {settingsRows.length === 0 && (
                  <tr><td colSpan={5} className="activity-empty">No moderators match.</td></tr>
                )}
                {pageOf(settingsRows, settingsPage).map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar
                          userId={m.id}
                          name={m.name}
                          className={`mod-avatar ${m.active ? 'is-completed' : 'is-absent'}`}
                        />
                        <div className="mod-name">{m.name}</div>
                      </div>
                    </td>
                    <td className="mono">{m.username}</td>
                    <td>
                      <RegionSelect
                        compact
                        value={m.region || ''}
                        placeholder="Set region"
                        onChange={(region) => patchMod(m.id, { region }, `${m.name} moved to ${region}.`)}
                      />
                    </td>
                    <td><span className="password-dots">••••••••</span></td>
                    <td className="status-col-cell">
                      <div className="actions-cell">
                        <button
                          type="button"
                          className="icon-action-btn reset"
                          onClick={() => resetPassword(m)}
                          title="Reset password"
                          aria-label={`Reset password for ${m.name}`}
                        >
                          {ICONS.reset}
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn delete"
                          onClick={() => removeMod(m)}
                          disabled={m.id === me.id}
                          title="Delete account"
                          aria-label={`Delete ${m.name}`}
                        >
                          {ICONS.trash}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(settingsRows, settingsPage).length)}
                  colSpan={5}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager page={settingsPage} pages={pagesOf(settingsRows)} total={settingsRows.length} pageSize={PAGE_SIZE} onChange={setSettingsPage} />
        </>
      )}
    </DashLayout>
  );
}
