import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLive, useLiveEvent } from '../context/LiveContext.jsx';
import DashLayout from '../components/DashLayout.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import Pager from '../components/Pager.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import RegionSelect from '../components/RegionSelect.jsx';
import { DEFAULT_REGION } from '../data/regions.js';
import { MIN_PASSWORD_LENGTH } from '../constants.js';
import { formatDate, formatDateTime, formatDuration } from '../utils/time.js';
import UserAvatar from '../components/UserAvatar.jsx';
import PasswordCell from '../components/PasswordCell.jsx';

const PAGE_SIZE = 10;

/** Every role this console can hand out, most privileged last. */
const ROLES = [
  ['employee', 'Moderator'],
  ['audit', 'Finance'],
  ['admin', 'Admin'],
  ['manager', 'Server Manager'],
];

const ROLE_LABEL = Object.fromEntries(ROLES);

const TABS = [
  ['log', 'Activity Log'],
  ['accounts', 'All Accounts'],
  ['add', 'Add Account'],
  ['records', 'Time Records'],
  ['database', 'Database'],
  ['health', 'Server Health'],
];

/** What each merge mode does, shown next to the picker. */
const IMPORT_MODES = [
  ['insert', 'Add only', 'Existing records are left alone and reported as skipped.'],
  ['upsert', 'Add and update', 'Matching records are overwritten with the imported values.'],
  ['replace', 'Replace collection', 'Deletes every existing document in the target first.'],
];

/** How often the health tab re-checks while it is open. */
const HEALTH_POLL_MS = 10000;

/** "2d 3h 14m" from a second count. */
function formatUptime(seconds) {
  if (seconds === null || seconds === undefined) return '——';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Trail categories, in the order they appear as filter chips. */
const CATEGORIES = [
  ['all', 'All'],
  ['account', 'Accounts'],
  ['attendance', 'Attendance'],
  ['schedule', 'Schedule'],
  ['security', 'Security'],
];

const LOG_PAGE_SIZE = 8;

/**
 * Time windows for the trail. Anchored to the reader's own midnight, so "today"
 * means their today — the console is used from several regions.
 */
const LOG_WHEN = [
  ['all', 'Any time'],
  ['today', 'Today'],
  ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['custom', 'Custom range'],
];

/** Period filters on one person's records. */
const RECORD_PERIODS = [
  ['all', 'All time'],
  ['daily', 'Daily'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Time Records sort options, in the order they appear in the dropdown. */
const RECORD_SORTS = [
  ['name-asc', 'Name A–Z'],
  ['name-desc', 'Name Z–A'],
  ['hours-desc', 'Highest hours'],
  ['hours-asc', 'Lowest hours'],
];

/** Mirrors the server's labels so the detail column reads in plain words. */
const FIELD_LABELS = {
  name: 'name',
  username: 'username',
  role: 'role',
  region: 'region',
  department: 'department',
  active: 'access',
  in: 'clock-in',
  out: 'clock-out',
  note: 'note',
  start: 'shift start',
  end: 'shift end',
  days: 'working days',
  'prefs.accent': 'theme',
  'prefs.dim': 'dimming',
};

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
  save: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  ),
  server: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01" />
    </svg>
  ),
  database: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  ),
  pulse: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  disk: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v6h10V4" />
      <circle cx="12" cy="15" r="2" />
    </svg>
  ),
};

/** Mirrors the server's generator so the field is filled before submitting. */
function makePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const pad = (n) => String(n).padStart(2, '0');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Audit values arrive as strings; timestamps are shown in the reader's zone. */
const prettyValue = (v) => (v === null || v === undefined ? '—' : ISO.test(v) ? formatDateTime(v) : v);

/** Date -> "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Server Manager console. The only place accounts of any role can be created
 * and attendance records can be written by hand.
 */
export default function ServerManager() {
  const { user: me } = useAuth();
  const { status: liveStatus } = useLive();

  const [confirm, confirmDialog] = useConfirm();

  const [tab, setTab] = useState('log');
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  // --- accounts ---
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(1);

  // --- add ---
  const [form, setForm] = useState({
    first: '', last: '', username: '', role: 'employee', region: DEFAULT_REGION, password: makePassword(),
  });
  const [showPassword, setShowPassword] = useState(true);

  // --- activity log ---
  const [log, setLog] = useState({ logs: [], total: 0, pages: 1, counts: {} });
  const [logPage, setLogPage] = useState(1);
  const [logCategory, setLogCategory] = useState('all');
  const [logRole, setLogRole] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [logWhen, setLogWhen] = useState('all');
  const [logFrom, setLogFrom] = useState('');
  const [logTo, setLogTo] = useState('');

  // --- database import ---
  const [preview, setPreview] = useState(null);
  const [jobs, setJobs] = useState({});
  const [report, setReport] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef(null);

  // --- server health ---
  const [health, setHealth] = useState(null);
  // Distinct from a failed database: this means the API itself did not answer.
  const [healthError, setHealthError] = useState('');
  const [checking, setChecking] = useState(false);

  // --- time records ---
  const [entries, setEntries] = useState([]);
  const [entryPage, setEntryPage] = useState(1);
  const [entryQuery, setEntryQuery] = useState('');
  const [entrySort, setEntrySort] = useState('name-asc');
  const [draft, setDraft] = useState({});
  // Which account's records are open. Null shows the list of people instead.
  const [recordUser, setRecordUser] = useState(null);
  const [recordPeriod, setRecordPeriod] = useState('all');
  const [recordSel, setRecordSel] = useState(() => {
    const d = new Date();
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, month: d.getMonth(), year: d.getFullYear() };
  });
  // Ids ticked for deletion, as a Set so toggling one row is cheap.
  const [picked, setPicked] = useState(() => new Set());

  // `subject` is only the account a new record is being written for.
  const [subject, setSubject] = useState('');
  const [newEntry, setNewEntry] = useState({ in: '', out: '', note: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data.users);
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load accounts') });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * The chosen window as two instants. Sent as ISO rather than as dates so the
   * server filters on the same moments the reader is thinking in, whatever zone
   * either of them is in. An open end stays undefined rather than "now", so a
   * change landing while you read it still appears.
   */
  const logWindow = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysBack = (n) => new Date(midnight.getTime() - n * 86400000);

    if (logWhen === 'today') return { from: midnight, to: null };
    if (logWhen === '24h') return { from: new Date(now.getTime() - 86400000), to: null };
    if (logWhen === '7d') return { from: daysBack(6), to: null };
    if (logWhen === '30d') return { from: daysBack(29), to: null };
    if (logWhen === 'custom') {
      return {
        // The "to" date is inclusive: picking the 5th should include the 5th.
        from: logFrom ? new Date(`${logFrom}T00:00:00`) : null,
        to: logTo ? new Date(`${logTo}T23:59:59.999`) : null,
      };
    }
    return { from: null, to: null };
  }, [logWhen, logFrom, logTo]);

  // Compared as strings, so the loader is not re-created on every render by two
  // freshly built Date objects that happen to mean the same instant.
  const logFromIso = logWindow.from ? logWindow.from.toISOString() : undefined;
  const logToIso = logWindow.to ? logWindow.to.toISOString() : undefined;

  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.get('/audit', {
        params: {
          category: logCategory,
          targetRole: logRole,
          q: logQuery.trim() || undefined,
          from: logFromIso,
          to: logToIso,
          page: logPage,
          limit: LOG_PAGE_SIZE,
        },
      });
      setLog(data);
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load the activity log') });
    }
  }, [logCategory, logRole, logQuery, logFromIso, logToIso, logPage]);

  // Reloaded whenever the console is showing it, so a change made on another
  // tab is already in the trail when you come back to it.
  useEffect(() => {
    if (tab === 'log') loadLog();
  }, [tab, loadLog]);

  // The trail is the one view that should show a change the instant it lands.
  useLiveEvent(() => {
    if (tab === 'log') loadLog();
    if (tab === 'accounts' || tab === 'add') load();
    if (tab === 'records') loadEntries();
  });

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await api.get('/server-health');
      setHealth(data);
      setHealthError('');
    } catch (err) {
      // A monitor has to survive the thing it monitors being down, so this
      // never clears the last good reading — it just reports the failure.
      setHealthError(
        err.response
          ? errorMessage(err, 'The API rejected the health check')
          : 'The API is not responding'
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'health') return undefined;
    checkHealth();
    const id = setInterval(checkHealth, HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [tab, checkHealth]);

  const loadEntries = useCallback(async () => {
    try {
      const { data } = await api.get('/entries/all');
      setEntries(data.entries);
      setDraft({});
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load attendance records') });
    }
  }, []);

  useEffect(() => {
    if (tab === 'records') loadEntries();
  }, [tab, loadEntries]);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  // ---------- accounts ----------

  async function addAccount(e) {
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
        role: form.role,
        // Only moderators are tied to a region; the other roles are org-wide.
        region: form.role === 'employee' ? form.region : undefined,
        password: form.password,
      });
      setMessage({
        type: 'success',
        text: `${data.user.name} added as ${ROLE_LABEL[data.user.role]}. Password: ${data.tempPassword} — copy it now, it is not shown again.`,
      });
      setForm({ first: '', last: '', username: '', role: 'employee', region: DEFAULT_REGION, password: makePassword() });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not add that account') });
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id, changes, note) {
    setMessage(null);
    try {
      const { data } = await api.patch(`/users/${id}`, changes);
      setUsers((prev) => prev.map((u) => (u.id === id ? data.user : u)));
      if (note) setMessage({ type: 'success', text: note });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Update failed') });
    }
  }

  async function resetPassword(u) {
    setMessage(null);
    try {
      const { data } = await api.post(`/users/${u.id}/reset-password`);
      setMessage({
        type: 'success',
        text: `New password for ${u.name}: ${data.tempPassword} — copy it now, it is not shown again.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not reset that password') });
    }
  }

  async function removeAccount(u) {
    const ok = await confirm({
      title: `Delete ${u.name}?`,
      body: `@${u.username}'s account and every attendance record against it will be removed. This cannot be undone.`,
      confirmLabel: 'Delete account',
    });
    if (!ok) return;

    setMessage(null);
    try {
      const { data } = await api.delete(`/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      if (subject === u.id) setSubject('');
      setMessage({
        type: 'success',
        text: `${u.name} deleted (${data.entriesRemoved} attendance record${data.entriesRemoved === 1 ? '' : 's'} removed).`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not delete that account') });
    }
  }

  // ---------- time records ----------

  const editValue = (entry, field) =>
    draft[entry._id]?.[field] ?? toLocalInput(entry[field]);

  const setEdit = (id, field, value) =>
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  async function saveEntry(entry) {
    const changes = draft[entry._id];
    if (!changes) return;

    setMessage(null);
    try {
      const { data } = await api.patch(`/entries/${entry._id}`, {
        ...(changes.in !== undefined ? { in: new Date(changes.in).toISOString() } : {}),
        // An emptied clock-out reopens the session rather than sending "".
        ...(changes.out !== undefined
          ? { out: changes.out ? new Date(changes.out).toISOString() : null }
          : {}),
      });
      setEntries((prev) => prev.map((x) => (x._id === entry._id ? { ...x, ...data.entry } : x)));
      setDraft((prev) => {
        const next = { ...prev };
        delete next[entry._id];
        return next;
      });
      setMessage({ type: 'success', text: 'Record updated.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not update that record') });
    }
  }

  async function removeEntry(entry) {
    const ok = await confirm({
      title: 'Delete this record?',
      body: `${formatDateTime(entry.in)} — ${entry.out ? formatDateTime(entry.out) : 'still open'}. This cannot be undone.`,
      confirmLabel: 'Delete record',
    });
    if (!ok) return;

    setMessage(null);
    try {
      await api.delete(`/entries/${entry._id}`);
      setEntries((prev) => prev.filter((x) => x._id !== entry._id));
      setMessage({ type: 'success', text: 'Record deleted.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not delete that record') });
    }
  }

  async function removeSelected() {
    const ids = [...picked];
    if (!ids.length) return;

    const whose = openPerson?.user?.name || 'this account';
    const ok = await confirm({
      title: `Delete ${ids.length} record${ids.length === 1 ? '' : 's'}?`,
      body: `For ${whose}${recordRange.from ? ` in ${recordRange.label}` : ''}. This cannot be undone.`,
      confirmLabel: `Delete ${ids.length} record${ids.length === 1 ? '' : 's'}`,
    });
    if (!ok) return;

    setMessage(null);
    setBusy(true);
    try {
      const { data } = await api.post('/entries/bulk-delete', { ids });
      const gone = new Set(ids);
      setEntries((prev) => prev.filter((x) => !gone.has(x._id)));
      setPicked(new Set());
      setMessage({
        type: 'success',
        text: `Deleted ${data.deleted} record${data.deleted === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not delete those records') });
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(e) {
    e.preventDefault();
    setMessage(null);

    if (!subject) return setMessage({ type: 'error', text: 'Pick an account first.' });
    if (!newEntry.in) return setMessage({ type: 'error', text: 'A clock-in time is required.' });

    setBusy(true);
    try {
      await api.post('/entries', {
        userId: subject,
        in: new Date(newEntry.in).toISOString(),
        out: newEntry.out ? new Date(newEntry.out).toISOString() : null,
        note: newEntry.note,
      });
      setNewEntry({ in: '', out: '', note: '' });
      await loadEntries();
      setMessage({ type: 'success', text: 'Record added.' });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not add that record') });
    } finally {
      setBusy(false);
    }
  }

  // ---------- database import ----------

  /** Reads the chosen file and asks the server what is in it. Writes nothing. */
  async function pickImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setMessage(null);
    setReport(null);
    setPreview(null);
    setImporting(true);

    try {
      const text = await file.text();
      const { data } = await api.post('/db/import/preview', text, {
        params: { filename: file.name },
        headers: { 'Content-Type': 'text/plain' },
        transformRequest: [(body) => body], // send the file as-is
      });
      setPreview(data);
      // Pre-select every source the server could match to a collection.
      setJobs(
        Object.fromEntries(
          data.sources.map((s) => [
            s.name,
            {
              include: Boolean(s.suggestedTarget),
              target: s.suggestedTarget || '',
              mode: 'insert',
              matchKey: s.suggestedTarget === 'users' ? 'username' : '_id',
              defaultPassword: '',
              ignorePasswords: true,
              mapping: s.mappings?.[s.suggestedTarget] || {},
              link: s.suggestedTarget && s.suggestedTarget !== 'users'
                ? { field: 'user', lookup: 'username' }
                : null,
            },
          ])
        )
      );
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not read that file') });
    } finally {
      setImporting(false);
    }
  }

  const setJob = (source, patch) =>
    setJobs((prev) => ({ ...prev, [source]: { ...prev[source], ...patch } }));

  /** Switches target and picks up the mapping the server worked out for it. */
  function changeTarget(sourceName, targetId) {
    const spec = preview.targets.find((t) => t.id === targetId);
    const source = preview.sources.find((s) => s.name === sourceName);

    setJob(sourceName, {
      target: targetId,
      mapping: source?.mappings?.[targetId] || {},
      matchKey: spec?.keys?.[0] || '_id',
      link: spec?.refs?.length ? { field: spec.refs[0], lookup: 'username' } : null,
    });
  }

  async function discardImport() {
    if (preview?.id) api.delete(`/db/import/${preview.id}`).catch(() => {});
    setPreview(null);
    setJobs({});
    setMessage(null);
  }

  async function runImport() {
    const selected = Object.entries(jobs)
      .filter(([, j]) => j.include && j.target)
      .map(([source, j]) => ({ source, ...j }));

    if (!selected.length) {
      return setMessage({ type: 'error', text: 'Choose at least one table and a collection to import it into.' });
    }

    const replacing = selected.filter((j) => j.mode === 'replace');
    if (replacing.length) {
      const ok = await confirm({
        title: 'Replace these collections?',
        body:
          `Every existing document in ${replacing.map((j) => j.target).join(', ')} is deleted first, ` +
          'then the imported rows are written. This cannot be undone.',
        confirmLabel: 'Replace and import',
      });
      if (!ok) return;
    }

    setImporting(true);
    setMessage(null);
    try {
      const { data } = await api.post('/db/import/commit', { id: preview.id, jobs: selected });
      setReport(data);
      setPreview(null);
      setJobs({});
      await load();
      setMessage({
        type: 'success',
        text: `Import finished — ${data.totals.inserted} added, ${data.totals.updated} updated, ` +
          `${data.totals.skipped} skipped, ${data.totals.failed} failed.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'The import failed') });
    } finally {
      setImporting(false);
    }
  }

  // ---------- derived ----------

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleFilter === 'all' || u.role === roleFilter) &&
        (!q || u.name.toLowerCase().includes(q) || u.username.includes(q))
    );
  }, [users, query, roleFilter]);

  /*
   * The people the records belong to, with a line each. This is the first thing
   * the tab shows: 2000 rows across everybody is a haystack, and the question
   * being asked is almost always about one person.
   */
  const recordPeople = useMemo(() => {
    const byUser = new Map();
    for (const e of entries) {
      if (!e.user) continue;
      const id = String(e.user._id);
      if (!byUser.has(id)) byUser.set(id, { id, user: e.user, count: 0, minutes: 0, open: 0, last: null });
      const p = byUser.get(id);
      p.count += 1;
      p.minutes += e.minutes || 0;
      if (!e.out) p.open += 1;
      if (!p.last || new Date(e.in) > new Date(p.last)) p.last = e.in;
    }

    const q = entryQuery.trim().toLowerCase();
    const list = q
      ? [...byUser.values()].filter(
          (p) => p.user.name.toLowerCase().includes(q) || p.user.username.includes(q)
        )
      : [...byUser.values()];

    return list.sort((a, b) => {
      switch (entrySort) {
        case 'name-desc': return b.user.name.localeCompare(a.user.name);
        case 'hours-desc': return b.minutes - a.minutes;
        case 'hours-asc': return a.minutes - b.minutes;
        default: return a.user.name.localeCompare(b.user.name);
      }
    });
  }, [entries, entryQuery, entrySort]);

  /** Years that actually have records, so the picker offers nothing empty. */
  const recordYears = useMemo(() => {
    const years = new Set(entries.map((e) => new Date(e.in).getFullYear()));
    years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  }, [entries]);

  /** The chosen period as bounds, in the manager's own clock. */
  const recordRange = useMemo(() => {
    const { date, month, year } = recordSel;
    const endOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    if (recordPeriod === 'daily') {
      const day = new Date(`${date}T00:00:00`);
      return { from: day, to: endOf(day), label: date };
    }
    if (recordPeriod === 'monthly') {
      return {
        from: new Date(year, month, 1),
        to: endOf(new Date(year, month + 1, 0)),
        label: `${MONTH_NAMES[month]} ${year}`,
      };
    }
    if (recordPeriod === 'yearly') {
      return { from: new Date(year, 0, 1), to: endOf(new Date(year, 11, 31)), label: String(year) };
    }
    return { from: null, to: null, label: 'all time' };
  }, [recordPeriod, recordSel]);

  /** One person's records inside that period, newest first. */
  const personEntries = useMemo(() => {
    if (!recordUser) return [];
    const { from, to } = recordRange;
    return entries
      .filter((e) => String(e.user?._id) === recordUser)
      .filter((e) => {
        if (!from && !to) return true;
        const at = new Date(e.in);
        return (!from || at >= from) && (!to || at <= to);
      })
      .sort((a, b) => new Date(b.in) - new Date(a.in));
  }, [entries, recordUser, recordRange]);

  const openPerson = recordPeople.find((p) => p.id === recordUser)
    || (recordUser ? { user: entries.find((e) => String(e.user?._id) === recordUser)?.user } : null);

  // A different person or period is a different set of rows, so a tick made
  // against the old view must not survive into the new one.
  useEffect(() => {
    setPicked(new Set());
    setEntryPage(1);
  }, [recordUser, recordPeriod, recordSel]);

  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Every row the filter is showing, not just the page — "select all" while
  // looking at a month should mean the month.
  const allPicked = personEntries.length > 0 && personEntries.every((e) => picked.has(e._id));
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(personEntries.map((e) => e._id)));


  const pageOf = (list, p) => list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const pagesOf = (list) => Math.max(1, Math.ceil(list.length / PAGE_SIZE));

  const logFiltered =
    logCategory !== 'all' || logRole !== 'all' || logQuery.trim() !== '' || logWhen !== 'all';

  return (
    <DashLayout
      title="Server Management"
      subtitle="Create accounts of any role and correct attendance records"
      flush
    >
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
            onClick={() => { setTab(id); setMessage(null); }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <>
          <div className="section-head schedule-head">
            <div>
              <div className="panel-title">Activity Log</div>
              <div className="panel-sub">
                {logFiltered
                  ? `${log.total} of ${Object.values(log.counts || {}).reduce((a, b) => a + b, 0)} changes shown`
                  : `Every change made across the portal — ${log.total} recorded`}
              </div>
            </div>
            <div className="head-actions">
              <span className={`live-pill is-${liveStatus}`}>
                <span className="live-dot" />
                {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Reconnecting'}
              </span>
              <button
                className="sort-select"
                type="button"
                onClick={() => {
                  setLogCategory('all');
                  setLogRole('all');
                  setLogQuery('');
                  setLogWhen('all');
                  setLogFrom('');
                  setLogTo('');
                  setLogPage(1);
                }}
                disabled={!logFiltered}
              >
                View all
              </button>
            </div>
          </div>

          <div className="toolbar">
            <div className="toolbar-left">
              <label className="search-box">
                {ICONS.search}
                <input
                  type="search"
                  value={logQuery}
                  onChange={(e) => { setLogQuery(e.target.value); setLogPage(1); }}
                  placeholder="Search who or what changed"
                  aria-label="Search the activity log"
                />
              </label>

              <div className="segmented" role="tablist" aria-label="Filter by category">
                {CATEGORIES.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={logCategory === id}
                    className={logCategory === id ? 'active' : ''}
                    onClick={() => { setLogCategory(id); setLogPage(1); }}
                  >
                    {label}
                    {id !== 'all' && log.counts?.[id] ? ` ${log.counts[id]}` : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="toolbar-right">
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={logWhen}
                  onChange={(e) => { setLogWhen(e.target.value); setLogPage(1); }}
                  aria-label="Filter by when it happened"
                >
                  {LOG_WHEN.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <span className="select-chevron">{ICONS.chevron}</span>
              </div>

              {logWhen === 'custom' && (
                <div className="period-group">
                  <span className="picker-label">From</span>
                  <input
                    type="date"
                    value={logFrom}
                    max={logTo || undefined}
                    onChange={(e) => { setLogFrom(e.target.value); setLogPage(1); }}
                    aria-label="From date"
                  />
                  <span className="picker-label">To</span>
                  <input
                    type="date"
                    value={logTo}
                    min={logFrom || undefined}
                    onChange={(e) => { setLogTo(e.target.value); setLogPage(1); }}
                    aria-label="To date"
                  />
                </div>
              )}

              <div className="select-wrap">
                <select
                  className="form-select"
                  value={logRole}
                  onChange={(e) => { setLogRole(e.target.value); setLogPage(1); }}
                  aria-label="Filter by the role that was changed"
                >
                  <option value="all">Any role</option>
                  {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <span className="select-chevron">{ICONS.chevron}</span>
              </div>
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table row-log">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Change</th>
                  <th className="num">Affected</th>
                </tr>
              </thead>
              <tbody>
                {log.logs.length === 0 && (
                  <tr><td colSpan={4} className="activity-empty">No activity recorded yet.</td></tr>
                )}
                {log.logs.map((l) => (
                  <tr key={l._id}>
                    <td className="mono">{formatDateTime(l.at)}</td>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar userId={l.actor} name={l.actorName} className="mod-avatar is-completed" />
                        <div>
                          <div className="mod-name">{l.actorName}</div>
                          <div className="mod-role">{ROLE_LABEL[l.actorRole] || l.actorRole}</div>
                        </div>
                      </div>
                    </td>
                    <td className="log-cell">
                      <div className="log-summary">{l.summary}</div>
                      <div className="mod-role">{l.action}</div>
                      {/* Rendered even when empty, so every row is the same height. */}
                      <div className="log-changes">
                        {l.changes?.map((c) => (
                          <div className="log-change" key={c.field}>
                            <span className="log-field">{FIELD_LABELS[c.field] || c.field}</span>
                            <span className="log-from">{prettyValue(c.from)}</span>
                            <span className="log-arrow">→</span>
                            <span className="log-to">{prettyValue(c.to)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="status-col-cell">
                      <div className="mod-name">{l.targetName || '——'}</div>
                      {l.targetRole && <div className="mod-role">{ROLE_LABEL[l.targetRole] || l.targetRole}</div>}
                    </td>
                  </tr>
                ))}

                <FillerRows count={fillerCount(LOG_PAGE_SIZE, log.logs.length)} colSpan={4} tall />
              </tbody>
            </table>
          </div>

          <Pager
            page={logPage}
            pages={log.pages}
            total={log.total}
            pageSize={LOG_PAGE_SIZE}
            onChange={setLogPage}
          />
        </>
      )}

      {tab === 'database' && (
        <>
          <div className="section-head">
            <div className="panel-title">Import Data</div>
            <div className="panel-sub">
              A MySQL dump (.sql) or a MongoDB export (.json / .jsonl). The file is read and
              described first — nothing is written until you confirm.
            </div>
          </div>

          <div className="assign-row">
            <button
              className="btn-primary"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
            >
              {importing ? 'Reading…' : 'Choose file'}
            </button>
            <input
              ref={fileInput}
              className="file-input"
              type="file"
              accept=".sql,.json,.jsonl,.ndjson,.txt,application/json,text/plain"
              onChange={pickImportFile}
            />
            {preview && (
              <button className="ghost-btn" type="button" onClick={discardImport} disabled={importing}>
                Discard
              </button>
            )}
            <span className="file-note">
              {preview
                ? `${preview.filename} — ${preview.format === 'mysql' ? 'MySQL dump' : 'JSON export'}, expires in ${preview.expiresInMinutes} min`
                : 'Up to 12MB.'}
            </span>
          </div>

          {preview?.sources.map((source) => {
            const job = jobs[source.name] || {};
            const target = preview.targets.find((t) => t.id === job.target);
            return (
              <div className="import-source" key={source.name}>
                <div className="section-head schedule-head">
                  <div>
                    <div className="panel-title">
                      <label className="day-pill checked-hidden">
                        <input
                          type="checkbox"
                          checked={Boolean(job.include)}
                          onChange={(e) => setJob(source.name, { include: e.target.checked })}
                        />
                        {source.name}
                      </label>
                    </div>
                    <div className="panel-sub">
                      {source.rows} row{source.rows === 1 ? '' : 's'} · {source.columns.length} column
                      {source.columns.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="assign-row">
                  <div className="select-wrap">
                    <select
                      className="form-select"
                      value={job.target || ''}
                      onChange={(e) => changeTarget(source.name, e.target.value)}
                      aria-label={`Target collection for ${source.name}`}
                    >
                      <option value="">Import into…</option>
                      {preview.targets.map((t) => (
                        <option key={t.id} value={t.id}>{t.label} ({t.id})</option>
                      ))}
                    </select>
                    <span className="select-chevron">{ICONS.chevron}</span>
                  </div>

                  <div className="select-wrap">
                    <select
                      className="form-select"
                      value={job.mode || 'insert'}
                      onChange={(e) => setJob(source.name, { mode: e.target.value })}
                      aria-label={`Merge mode for ${source.name}`}
                    >
                      {IMPORT_MODES.map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                    <span className="select-chevron">{ICONS.chevron}</span>
                  </div>

                  {job.mode !== 'replace' && (
                    <div className="select-wrap">
                      <select
                        className="form-select"
                        value={job.matchKey || ''}
                        onChange={(e) => setJob(source.name, { matchKey: e.target.value })}
                        aria-label={`Match rows on for ${source.name}`}
                      >
                        <option value="">Match on…</option>
                        {(target?.keys || ['_id']).map((k) => (
                          <option key={k} value={k}>Match on {k}</option>
                        ))}
                      </select>
                      <span className="select-chevron">{ICONS.chevron}</span>
                    </div>
                  )}

                  {job.target === 'users' && (
                    <input
                      className="form-input note-input"
                      value={job.defaultPassword || ''}
                      onChange={(e) => setJob(source.name, { defaultPassword: e.target.value })}
                      placeholder="Temp password (optional)"
                      aria-label="Temporary password for imported accounts"
                    />
                  )}
                </div>

                <div className="import-note">
                  {IMPORT_MODES.find(([id]) => id === (job.mode || 'insert'))?.[2]}
                </div>

                {job.target === 'users' && (
                  <div className="import-options">
                    <label className="day-pill checked-hidden">
                      <input
                        type="checkbox"
                        checked={job.ignorePasswords !== false}
                        onChange={(e) => setJob(source.name, { ignorePasswords: e.target.checked })}
                      />
                      Ignore passwords in the file
                    </label>
                    <span className="file-note">
                      Recommended. Exported passwords are either plain text or hashed by another
                      system, so they would never work here. Each account gets a fresh password —
                      set one above, or issue them individually with Reset password.
                    </span>
                  </div>
                )}

                {/* A reference cannot be taken literally from a file: the source
                    stores its own id, which means nothing in this database. */}
                {target?.refs?.length > 0 && (
                  <div className="import-options">
                    <div className="import-link-row">
                      <span className="file-note">Link each row to an account by matching</span>
                      <div className="select-wrap">
                        <select
                          className="form-select"
                          value={job.link?.field || ''}
                          onChange={(e) =>
                            setJob(source.name, {
                              link: e.target.value
                                ? { field: e.target.value, lookup: job.link?.lookup || 'username' }
                                : null,
                            })
                          }
                          aria-label="Column holding the account reference"
                        >
                          <option value="">(no link)</option>
                          {target.refs.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <span className="select-chevron">{ICONS.chevron}</span>
                      </div>
                      <span className="file-note">against the account&apos;s</span>
                      <div className="select-wrap">
                        <select
                          className="form-select"
                          value={job.link?.lookup || 'username'}
                          disabled={!job.link?.field}
                          onChange={(e) =>
                            setJob(source.name, { link: { ...job.link, lookup: e.target.value } })
                          }
                          aria-label="Account field to match against"
                        >
                          {['username', 'email', 'name'].map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <span className="select-chevron">{ICONS.chevron}</span>
                      </div>
                    </div>
                    <span className="file-note">
                      Rows whose reference matches no account are reported and skipped, not guessed at.
                    </span>
                  </div>
                )}

                <div className="activity-scroll">
                  <table className="activity-table attendance-table">
                    <thead>
                      <tr>
                        {source.columns.map((c) => (
                          <th key={c}>
                            <div className="import-col">
                              <span className="import-col-name">{c}</span>
                              <div className="table-select-wrap">
                                <select
                                  className="table-select"
                                  value={job.mapping?.[c] ?? ''}
                                  onChange={(e) =>
                                    setJob(source.name, {
                                      mapping: { ...job.mapping, [c]: e.target.value },
                                    })
                                  }
                                  aria-label={`Import ${c} as`}
                                >
                                  <option value="">skip</option>
                                  {(target?.fields || []).map((f) => (
                                    <option key={f} value={f}>{f}</option>
                                  ))}
                                </select>
                                <span className="table-select-chevron">{ICONS.chevron}</span>
                              </div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {source.sample.map((row, i) => (
                        <tr key={i}>
                          {source.columns.map((c) => (
                            <td className={`mono${job.mapping?.[c] ? '' : ' import-skipped'}`} key={c}>
                              {row[c] === null || row[c] === undefined
                                ? <span className="muted-italic">null</span>
                                : String(row[c]).slice(0, 60)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {source.rows > source.sample.length && (
                  <div className="import-note">
                    Showing the first {source.sample.length} of {source.rows} rows.
                  </div>
                )}
              </div>
            );
          })}

          {preview && (
            <div className="form-foot full import-foot">
              <button className="btn-primary" type="button" onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : 'Import selected'}
              </button>
            </div>
          )}

          {report && (
            <>
              <div className="section-head">
                <div className="panel-title">Import Report</div>
                <div className="panel-sub">
                  {report.totals.inserted} added · {report.totals.updated} updated ·{' '}
                  {report.totals.skipped} skipped · {report.totals.failed} failed
                </div>
              </div>

              <div className="activity-scroll">
                <table className="activity-table attendance-table">
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th>Mode</th>
                      <th>Rows</th>
                      <th>Added</th>
                      <th>Updated</th>
                      <th>Skipped</th>
                      <th className="num">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.reports.map((r) => (
                      <tr key={r.target}>
                        <td className="mono strong">{r.target}</td>
                        <td className="mono">{IMPORT_MODES.find(([id]) => id === r.mode)?.[1]}</td>
                        <td className="mono">{r.total}</td>
                        <td className="mono">{r.inserted}</td>
                        <td className="mono">{r.updated}</td>
                        <td className="mono">{r.skipped}</td>
                        <td className="mono status-col-cell">{r.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {report.reports.some((r) => r.errors.length > 0) && (
                <>
                  <div className="section-head">
                    <div className="panel-title">Rows That Failed</div>
                    <div className="panel-sub">Everything else was imported — these were left out.</div>
                  </div>
                  <div className="activity-scroll">
                    <table className="activity-table attendance-table">
                      <thead>
                        <tr><th>Collection</th><th>Row</th><th>Reason</th></tr>
                      </thead>
                      <tbody>
                        {report.reports.flatMap((r) =>
                          r.errors.map((e) => (
                            <tr key={`${r.target}-${e.row}`}>
                              <td className="mono">{r.target}</td>
                              <td className="mono">{e.row}</td>
                              <td>{e.message}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'health' && (
        <>
          <div className="section-head schedule-head">
            <div>
              <div className="panel-title">Server Health</div>
              <div className="panel-sub">
                {healthError
                  ? healthError
                  : health
                    ? `Checked ${formatDateTime(health.checkedAt)} — rechecks every ${HEALTH_POLL_MS / 1000}s`
                    : 'Checking…'}
              </div>
            </div>
            <button className="sort-select" type="button" onClick={checkHealth} disabled={checking}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>

          <div className="stats health-stats">
            <div className={`stat-card ${healthError ? 'stat-down' : 'stat-in'}`}>
              <div className="stat-top">
                <div className="stat-icon">{ICONS.server}</div>
                <div className="stat-delta">{healthError ? 'unreachable' : 'responding'}</div>
              </div>
              <div className="stat-num">{healthError ? 'Down' : 'Up'}</div>
              <div className="stat-label">API server</div>
            </div>

            {/* Unknown (API down) stays neutral; a confirmed disconnect is an alarm. */}
            <div
              className={`stat-card ${
                healthError ? 'stat-out' : health?.database?.connected ? 'stat-in' : 'stat-down'
              }`}
            >
              <div className="stat-top">
                <div className="stat-icon">{ICONS.database}</div>
                <div className="stat-delta">
                  {healthError ? 'unknown' : health?.database?.state || 'checking'}
                </div>
              </div>
              <div className="stat-num">
                {healthError ? '——' : health?.database?.connected ? 'Connected' : 'Disconnected'}
              </div>
              <div className="stat-label">MongoDB</div>
            </div>

            <div className="stat-card stat-total">
              <div className="stat-top">
                <div className="stat-icon">{ICONS.pulse}</div>
                <div className="stat-delta">round trip</div>
              </div>
              <div className="stat-num">
                {health?.database?.pingMs != null && !healthError ? `${health.database.pingMs}ms` : '——'}
              </div>
              <div className="stat-label">Database ping</div>
            </div>

            <div className="stat-card stat-total">
              <div className="stat-top">
                <div className="stat-icon">{ICONS.clock}</div>
                <div className="stat-delta">since restart</div>
              </div>
              <div className="stat-num health-uptime">
                {healthError ? '——' : formatUptime(health?.api?.uptimeSeconds)}
              </div>
              <div className="stat-label">API uptime</div>
            </div>

            <div className="stat-card stat-total">
              <div className="stat-top">
                <div className="stat-icon">{ICONS.disk}</div>
                <div className="stat-delta">
                  {health?.storage?.objects != null && !healthError
                    ? `${health.storage.objects} docs`
                    : 'on disk'}
                </div>
              </div>
              <div className="stat-num health-uptime">
                {health?.storage && !healthError ? `${health.storage.totalMb} MB` : '——'}
              </div>
              <div className="stat-label">Total storage</div>
            </div>
          </div>

          {/* Only meaningful when a ceiling is configured, e.g. an Atlas M0's 512MB. */}
          {health?.storage?.limitMb && !healthError && (
            <div className="storage-meter">
              <div className="storage-meter-head">
                <span className="theme-color-title">Storage used</span>
                <span className="mono">
                  {health.storage.totalMb} MB of {health.storage.limitMb} MB
                  {' · '}
                  {Math.round((health.storage.totalMb / health.storage.limitMb) * 100)}%
                </span>
              </div>
              <span className="hours-bar-track storage-bar">
                <span
                  className="hours-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.round((health.storage.totalMb / health.storage.limitMb) * 100))}%`,
                  }}
                />
              </span>
            </div>
          )}

          {health?.database?.error && (
            <div className="dash-error" role="alert">
              Database error: {health.database.error}
            </div>
          )}

          <div className="split-row">
            <div className="split-cell">
              <div className="section-title">Database</div>
              <div className="section-sub">Connection to MongoDB.</div>
              <dl className="health-list">
                <div><dt>Status</dt><dd>
                  <span className={`pill-status ${health?.database?.connected && !healthError ? 'pill-onduty' : 'pill-absent'}`}>
                    {healthError ? 'Unknown' : health?.database?.state || 'checking'}
                  </span>
                </dd></div>
                <div><dt>Host</dt><dd className="mono">{health?.database?.host || '——'}</dd></div>
                <div><dt>Database</dt><dd className="mono">{health?.database?.name || '——'}</dd></div>
                <div><dt>Ping</dt><dd className="mono">
                  {health?.database?.pingMs != null ? `${health.database.pingMs} ms` : '——'}
                </dd></div>
              </dl>

              <div className="divider" />

              <div className="section-title">Storage</div>
              <div className="section-sub">Space this database occupies.</div>
              <dl className="health-list">
                <div><dt>Total on disk</dt><dd className="mono strong">
                  {health?.storage ? `${health.storage.totalMb} MB` : '——'}
                </dd></div>
                <div><dt>Documents</dt><dd className="mono">
                  {health?.storage ? `${health.storage.storageMb} MB` : '——'}
                </dd></div>
                <div><dt>Indexes</dt><dd className="mono">
                  {health?.storage ? `${health.storage.indexMb} MB` : '——'}
                </dd></div>
                <div><dt>Uncompressed</dt><dd className="mono">
                  {health?.storage ? `${health.storage.dataMb} MB` : '——'}
                </dd></div>
                <div><dt>Documents stored</dt><dd className="mono">
                  {health?.storage?.objects ?? '——'}
                </dd></div>
                <div><dt>Average document</dt><dd className="mono">
                  {health?.storage ? `${(health.storage.avgObjBytes / 1024).toFixed(1)} KB` : '——'}
                </dd></div>
              </dl>

              <div className="divider" />

              <div className="section-title">By Collection</div>
              <div className="section-sub">Documents and space used, largest first.</div>

              <div className="activity-scroll">
                <table className="activity-table attendance-table">
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th>Documents</th>
                      <th className="num">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!health?.storage?.byCollection?.length && (
                      <tr><td colSpan={3} className="activity-empty">No storage detail available.</td></tr>
                    )}
                    {health?.storage?.byCollection?.map((c) => (
                      <tr key={c.name}>
                        <td className="mono strong">{c.name}</td>
                        <td className="mono">{c.documents}</td>
                        <td className="mono status-col-cell">{c.totalMb} MB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="split-cell">
              <div className="section-title">API Process</div>
              <div className="section-sub">The Node server behind this portal.</div>
              <dl className="health-list">
                <div><dt>Status</dt><dd>
                  <span className={`pill-status ${healthError ? 'pill-absent' : 'pill-onduty'}`}>
                    {healthError ? 'Not responding' : 'Responding'}
                  </span>
                </dd></div>
                <div><dt>Uptime</dt><dd className="mono">{formatUptime(health?.api?.uptimeSeconds)}</dd></div>
                <div><dt>Host</dt><dd className="mono">{health?.api?.hostname || '——'}</dd></div>
                <div><dt>Environment</dt><dd className="mono">{health?.api?.environment || '——'}</dd></div>
                <div><dt>Node</dt><dd className="mono">{health?.api?.node || '——'}</dd></div>
                <div><dt>Process ID</dt><dd className="mono">{health?.api?.pid ?? '——'}</dd></div>
                <div><dt>Memory (RSS)</dt><dd className="mono">
                  {health?.api?.memory ? `${health.api.memory.rssMb} MB` : '——'}
                </dd></div>
                <div><dt>Heap used</dt><dd className="mono">
                  {health?.api?.memory ? `${health.api.memory.heapUsedMb} / ${health.api.memory.heapTotalMb} MB` : '——'}
                </dd></div>
              </dl>
            </div>
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              <label className="search-box">
                {ICONS.search}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                  placeholder="Search name or username"
                  aria-label="Search accounts"
                />
              </label>

              <div className="segmented" role="tablist" aria-label="Filter by role">
                {[['all', 'All'], ...ROLES].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={roleFilter === id}
                    className={roleFilter === id ? 'active' : ''}
                    onClick={() => { setRoleFilter(id); setPage(1); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table row-controls">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Added</th>
                  <th>Password</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="activity-empty">No accounts match.</td></tr>
                )}
                {pageOf(rows, page).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar
                          userId={u.id}
                          name={u.name}
                          className={`mod-avatar ${u.active ? 'is-completed' : 'is-absent'}`}
                        />
                        <div>
                          <div className="mod-name">{u.name}</div>
                          {/* Region only. It used to fall back to department,
                              which is how "General" reappeared here. */}
                          <div className="mod-role">{u.region}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{u.username}</td>
                    <td>
                      <div className="table-select-wrap">
                        <select
                          className="table-select"
                          value={u.role}
                          disabled={u.id === me.id}
                          onChange={(e) =>
                            patchUser(u.id, { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value]}.`)
                          }
                          aria-label={`Role for ${u.name}`}
                        >
                          {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                        <span className="table-select-chevron">{ICONS.chevron}</span>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`manage-btn ${u.active ? 'to-revoke' : 'to-grant'}`}
                        disabled={u.id === me.id}
                        onClick={() =>
                          patchUser(
                            u.id,
                            { active: !u.active },
                            `${u.name} ${u.active ? 'can no longer sign in' : 'can sign in again'}.`
                          )
                        }
                      >
                        {u.active ? 'Revoke access' : 'Grant access'}
                      </button>
                    </td>
                    <td className="mono">{u.createdAt ? formatDate(u.createdAt) : '——'}</td>
                    <td>
                      <PasswordCell
                        mod={u}
                        onSaved={(text) => setMessage({ type: 'success', text })}
                        onError={(text) => setMessage({ type: 'error', text })}
                      />
                    </td>
                    <td className="status-col-cell">
                      <div className="actions-cell">
                        <button
                          type="button"
                          className="icon-action-btn reset"
                          onClick={() => resetPassword(u)}
                          title="Reset password"
                          aria-label={`Reset password for ${u.name}`}
                        >
                          {ICONS.reset}
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn delete"
                          onClick={() => removeAccount(u)}
                          disabled={u.id === me.id}
                          title="Delete account"
                          aria-label={`Delete ${u.name}`}
                        >
                          {ICONS.trash}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(rows, page).length)}
                  colSpan={7}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager page={page} pages={pagesOf(rows)} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      {tab === 'add' && (
        <form className="form-grid" onSubmit={addAccount}>
          <div className="form-field">
            <label className="form-label" htmlFor="smFirst">First name</label>
            <input id="smFirst" className="form-input" value={form.first} onChange={update('first')} placeholder="e.g. Wei Ling" required />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="smLast">Last name</label>
            <input id="smLast" className="form-input" value={form.last} onChange={update('last')} placeholder="e.g. Tan" />
          </div>

          <div className="form-field full">
            <label className="form-label" htmlFor="smUsername">Username</label>
            <input
              id="smUsername"
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
            <label className="form-label" htmlFor="smRole">Role</label>
            <div className="select-wrap">
              <select id="smRole" className="form-select" value={form.role} onChange={update('role')}>
                {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <span className="select-chevron">{ICONS.chevron}</span>
            </div>
            <div className="form-note">
              {form.role === 'manager'
                ? 'Full control, including this console.'
                : form.role === 'admin'
                  ? 'Oversees moderators; cannot edit attendance or create accounts above moderator.'
                  : form.role === 'audit'
                    ? 'Read-only payroll contribution report.'
                    : 'Clocks in and out and sees their own report.'}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="smRegion">Region</label>
            <RegionSelect
              id="smRegion"
              value={form.region}
              onChange={(region) => setForm((f) => ({ ...f, region }))}
              disabled={form.role !== 'employee'}
            />
            {form.role !== 'employee' && <div className="form-note">Only moderators are tied to a region.</div>}
          </div>

          <div className="form-field full">
            <label className="form-label" htmlFor="smPassword">Temporary password</label>
            <div className="password-wrap">
              <input
                id="smPassword"
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
              {busy ? 'Adding…' : '+  Add Account'}
            </button>
          </div>
        </form>
      )}

      {tab === 'records' && (
        <>
          <div className="section-head">
            <div className="panel-title">Add a Record</div>
            <div className="panel-sub">Leave the clock-out empty to leave the session open.</div>
          </div>

          <form className="assign-row" onSubmit={addEntry}>
            <div className="select-wrap">
              <select
                className="form-select"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-label="Account"
                required
              >
                <option value="">Select an account</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                ))}
              </select>
              <span className="select-chevron">{ICONS.chevron}</span>
            </div>
            <input
              className="form-input datetime-input"
              type="datetime-local"
              value={newEntry.in}
              onChange={(e) => setNewEntry({ ...newEntry, in: e.target.value })}
              aria-label="Clock in"
              required
            />
            <span className="to-label">to</span>
            <input
              className="form-input datetime-input"
              type="datetime-local"
              value={newEntry.out}
              onChange={(e) => setNewEntry({ ...newEntry, out: e.target.value })}
              aria-label="Clock out"
            />
            <input
              className="form-input note-input"
              value={newEntry.note}
              onChange={(e) => setNewEntry({ ...newEntry, note: e.target.value })}
              placeholder="Note (optional)"
              aria-label="Note"
            />
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Adding…' : '+  Add Record'}
            </button>
          </form>

          <div className="section-head schedule-head">
            <div>
              <div className="panel-title">
                {recordUser ? `${openPerson?.user?.name || 'Account'} — Records` : 'All Attendance Records'}
              </div>
              <div className="panel-sub">
                {recordUser
                  ? `${personEntries.length} record${personEntries.length === 1 ? '' : 's'} in ${recordRange.label}`
                  : `${recordPeople.length} account${recordPeople.length === 1 ? '' : 's'} with records — open one to see its shifts`}
              </div>
            </div>
            {recordUser && (
              <button className="sort-select" type="button" onClick={() => setRecordUser(null)}>
                &lsaquo; All accounts
              </button>
            )}
          </div>

          <div className="toolbar">
            <div className="toolbar-left">
              {!recordUser && (
                <label className="search-box">
                  {ICONS.search}
                  <input
                    type="search"
                    value={entryQuery}
                    onChange={(e) => { setEntryQuery(e.target.value); setEntryPage(1); }}
                    placeholder="Search by name"
                    aria-label="Search records by name"
                  />
                </label>
              )}

              {recordUser && (
                <>
                  <div className="segmented" role="tablist" aria-label="Period">
                    {RECORD_PERIODS.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={recordPeriod === id}
                        className={recordPeriod === id ? 'active' : ''}
                        onClick={() => setRecordPeriod(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="period-picker">
                    {recordPeriod === 'daily' && (
                      <div className="period-group">
                        <span className="picker-label">Date</span>
                        <input
                          type="date"
                          value={recordSel.date}
                          onChange={(e) => setRecordSel({ ...recordSel, date: e.target.value })}
                          aria-label="Date"
                        />
                      </div>
                    )}
                    {recordPeriod === 'monthly' && (
                      <div className="period-group">
                        <span className="picker-label">Month</span>
                        <select
                          value={recordSel.month}
                          onChange={(e) => setRecordSel({ ...recordSel, month: Number(e.target.value) })}
                          aria-label="Month"
                        >
                          {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
                        </select>
                        <span className="picker-label">Year</span>
                        <select
                          value={recordSel.year}
                          onChange={(e) => setRecordSel({ ...recordSel, year: Number(e.target.value) })}
                          aria-label="Year"
                        >
                          {recordYears.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
                    )}
                    {recordPeriod === 'yearly' && (
                      <div className="period-group">
                        <span className="picker-label">Year</span>
                        <select
                          value={recordSel.year}
                          onChange={(e) => setRecordSel({ ...recordSel, year: Number(e.target.value) })}
                          aria-label="Year"
                        >
                          {recordYears.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="toolbar-right">
              {recordUser ? (
                <button
                  className="bulk-delete-btn"
                  type="button"
                  onClick={removeSelected}
                  disabled={picked.size === 0 || busy}
                  title={picked.size ? `Delete ${picked.size} selected` : 'Tick records to delete'}
                >
                  {ICONS.trash}
                  {picked.size ? `Delete ${picked.size} selected` : 'Delete selected'}
                </button>
              ) : (
                <div className="select-wrap">
                  <select
                    className="form-select"
                    value={entrySort}
                    onChange={(e) => { setEntrySort(e.target.value); setEntryPage(1); }}
                    aria-label="Sort records"
                  >
                    {RECORD_SORTS.map(([id, label]) => (
                      <option key={id} value={id}>Sort: {label}</option>
                    ))}
                  </select>
                  <span className="select-chevron">{ICONS.chevron}</span>
                </div>
              )}
            </div>
          </div>

          {!recordUser && (
            <>
              <div className="activity-scroll">
                <table className="activity-table attendance-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Records</th>
                      <th>Total hours</th>
                      <th>Latest</th>
                      <th className="num">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordPeople.length === 0 && (
                      <tr><td colSpan={5} className="activity-empty">
                        {entries.length ? 'No accounts match.' : 'No attendance records yet.'}
                      </td></tr>
                    )}
                    {pageOf(recordPeople, entryPage).map((p) => (
                      <tr
                        key={p.id}
                        className="row-clickable"
                        onClick={() => setRecordUser(p.id)}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open the records for ${p.user.name}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setRecordUser(p.id);
                          }
                        }}
                      >
                        <td>
                          <div className="mod-cell">
                            <UserAvatar userId={p.user._id} name={p.user.name} className="mod-avatar is-completed" />
                            <div>
                              <div className="mod-name">{p.user.name}</div>
                              <div className="mod-role">@{p.user.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="mono">
                          {p.count}
                          {p.open ? <span className="muted-italic"> ({p.open} open)</span> : ''}
                        </td>
                        <td className="mono strong">{formatDuration(p.minutes)}</td>
                        <td className="mono">{p.last ? formatDate(p.last) : '——'}</td>
                        <td className="status-col-cell mono">&rsaquo;</td>
                      </tr>
                    ))}

                    <FillerRows
                      count={fillerCount(PAGE_SIZE, pageOf(recordPeople, entryPage).length)}
                      colSpan={5}
                      tall
                    />
                  </tbody>
                </table>
              </div>

              <Pager
                page={entryPage}
                pages={pagesOf(recordPeople)}
                total={recordPeople.length}
                pageSize={PAGE_SIZE}
                onChange={setEntryPage}
              />
            </>
          )}

          {recordUser && (
            <>
              <div className="activity-scroll">
                <table className="activity-table attendance-table row-controls">
                  <thead>
                    <tr>
                      <th className="tick-col">
                        <input
                          type="checkbox"
                          checked={allPicked}
                          /* Some-but-not-all shows as indeterminate rather than
                             claiming everything is selected. */
                          ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !allPicked; }}
                          onChange={toggleAll}
                          disabled={personEntries.length === 0}
                          aria-label="Select every record shown"
                        />
                      </th>
                      <th>Clock in</th>
                      <th>Clock out</th>
                      <th>Total</th>
                      <th>Note</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personEntries.length === 0 && (
                      <tr><td colSpan={6} className="activity-empty">
                        No records in {recordRange.label}.
                      </td></tr>
                    )}
                    {pageOf(personEntries, entryPage).map((entry) => {
                      const dirty = Boolean(draft[entry._id]);
                      return (
                        <tr key={entry._id} className={picked.has(entry._id) ? 'row-picked' : ''}>
                          <td className="tick-col">
                            <input
                              type="checkbox"
                              checked={picked.has(entry._id)}
                              onChange={() => togglePick(entry._id)}
                              aria-label={`Select the record starting ${formatDateTime(entry.in)}`}
                            />
                          </td>
                          <td>
                            <input
                              className="table-input"
                              type="datetime-local"
                              value={editValue(entry, 'in')}
                              onChange={(e) => setEdit(entry._id, 'in', e.target.value)}
                              aria-label="Clock in"
                            />
                          </td>
                          <td>
                            <input
                              className="table-input"
                              type="datetime-local"
                              value={editValue(entry, 'out')}
                              onChange={(e) => setEdit(entry._id, 'out', e.target.value)}
                              aria-label="Clock out"
                            />
                          </td>
                          <td className="mono strong">
                            {entry.out ? formatDuration(entry.minutes) : <span className="muted-italic">Open</span>}
                          </td>
                          <td className="mono">{entry.note || '——'}</td>
                          <td className="status-col-cell">
                            <div className="actions-cell">
                              <button
                                type="button"
                                className="icon-action-btn save"
                                onClick={() => saveEntry(entry)}
                                disabled={!dirty}
                                title={dirty ? 'Save changes' : 'No changes'}
                                aria-label="Save changes"
                              >
                                {ICONS.save}
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn delete"
                                onClick={() => removeEntry(entry)}
                                title="Delete record"
                                aria-label="Delete record"
                              >
                                {ICONS.trash}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    <FillerRows
                      count={fillerCount(PAGE_SIZE, pageOf(personEntries, entryPage).length)}
                      colSpan={6}
                      tall
                    />
                  </tbody>
                </table>
              </div>

              <Pager
                page={entryPage}
                pages={pagesOf(personEntries)}
                total={personEntries.length}
                pageSize={PAGE_SIZE}
                onChange={setEntryPage}
              />
            </>
          )}
        </>
      )}
      {confirmDialog}
    </DashLayout>
  );
}
