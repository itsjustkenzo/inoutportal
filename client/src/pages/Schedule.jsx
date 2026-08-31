import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import { formatDuration } from '../utils/time.js';

const PAGE_SIZE = 10;

/** Shift times are given in the organisation's base zone. */
const BASE_ZONE = 'Asia/Kuala_Lumpur';

/*
 * One representative zone per region — enough to answer "roughly what time is
 * this for them", not a precise per-person clock. Shared with the account forms
 * so a region that can be chosen is always a region that can be converted.
 */
import { REGION_ZONES } from '../data/regions.js';
import UserAvatar from '../components/UserAvatar.jsx';

const DAYS = [
  [1, 'Monday', 'Mon'],
  [2, 'Tuesday', 'Tue'],
  [3, 'Wednesday', 'Wed'],
  [4, 'Thursday', 'Thu'],
  [5, 'Friday', 'Fri'],
  [6, 'Saturday', 'Sat'],
  [0, 'Sunday', 'Sun'],
];

const SHORT_DAY = Object.fromEntries(DAYS.map(([n, , s]) => [n, s]));

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (mins) => `${pad(Math.floor(mins / 60))}${pad(mins % 60)}`;
const toClock = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** "0830" or "08:30" -> minutes, or null when it isn't a real time. */
function parseTime(text) {
  const digits = String(text).replace(/\D/g, '');
  if (digits.length !== 4) return null;
  const h = Number(digits.slice(0, 2));
  const m = Number(digits.slice(2));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** A zone's current UTC offset in minutes, read from Intl rather than hard-coded. */
function zoneOffset(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
    const m = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch {
    return 0;
  }
}

const offsetLabel = (mins) => {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `GMT${sign}${Math.floor(a / 60)}${a % 60 ? `:${pad(a % 60)}` : ''}`;
};

/** Shift start/end expressed in the moderator's regional zone. */
function convertToRegion(start, end, region) {
  const zone = REGION_ZONES[region] || BASE_ZONE;
  const shift = zoneOffset(zone) - zoneOffset(BASE_ZONE);
  const wrap = (m) => ((m + shift) % 1440 + 1440) % 1440;
  return { start: wrap(start), end: wrap(end), label: offsetLabel(zoneOffset(zone)) };
}

/** Which band a shift falls in, for the timeline bar colour. */
function shiftTone(start) {
  if (start < 6 * 60 || start >= 20 * 60) return 'night';
  if (start < 12 * 60) return 'morning';
  return 'afternoon';
}

export default function Schedule() {
  const [mods, setMods] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState('list');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sortAsc, setSortAsc] = useState(true);

  const [form, setForm] = useState({ userId: '', start: '', end: '', days: [] });

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([
        api.get('/users', { params: { role: 'employee' } }),
        api.get('/schedules'),
      ]);
      setMods(u.data.users);
      setSchedules(s.data.schedules);
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not load schedules') });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = mods.find((m) => m.id === form.userId) || null;

  const toggleDay = (n) =>
    setForm((f) => ({ ...f, days: f.days.includes(n) ? f.days.filter((d) => d !== n) : [...f.days, n] }));

  async function assign(e) {
    e.preventDefault();
    setMessage(null);

    if (!form.userId) return setMessage({ type: 'error', text: 'Pick a moderator first.' });

    const start = parseTime(form.start);
    const end = parseTime(form.end);
    if (start === null || end === null) {
      return setMessage({ type: 'error', text: 'Times must be 24-hour, four digits — e.g. 0800 and 1630.' });
    }
    if (start === end) return setMessage({ type: 'error', text: 'Start and end cannot be the same time.' });
    if (!form.days.length) return setMessage({ type: 'error', text: 'Pick at least one working day.' });

    setBusy(true);
    try {
      const { data } = await api.put(`/schedules/${form.userId}`, { start, end, days: form.days });
      setMessage({
        type: 'success',
        text: `${data.schedule.name}: ${toClock(start)}–${toClock(end)} (${formatDuration(data.schedule.minutes)}) assigned.`,
      });
      setForm({ userId: '', start: '', end: '', days: [] });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not assign that shift') });
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(row) {
    if (!window.confirm(`Remove ${row.name}'s shift?`)) return;
    setMessage(null);
    try {
      await api.delete(`/schedules/${row.userId}`);
      setSchedules((prev) => prev.filter((s) => s.userId !== row.userId));
      setMessage({ type: 'success', text: `${row.name}'s shift removed.` });
    } catch (err) {
      setMessage({ type: 'error', text: errorMessage(err, 'Could not remove that shift') });
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? schedules.filter((s) => s.name.toLowerCase().includes(q)) : schedules;
    return [...list].sort((a, b) => (sortAsc ? 1 : -1) * a.name.localeCompare(b.name));
  }, [schedules, query, sortAsc]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  // Marker for the current moment on the 24-hour timeline.
  const nowPct = useMemo(() => {
    const now = new Date();
    const here = new Intl.DateTimeFormat('en-GB', { timeZone: BASE_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const [h, m] = here.split(':').map(Number);
    return ((h * 60 + m) / 1440) * 100;
  }, []);

  return (
    <DashLayout title="Schedule" subtitle="Assign shifts and manage moderator work schedules" flush>
      {message && (
        <div className={message.type === 'error' ? 'dash-error' : 'dash-success'} role="alert">
          {message.text}
        </div>
      )}

      <div className="section-head">
        <div className="panel-title">Assign Work Schedule</div>
        <div className="panel-sub">Times are {BASE_ZONE.split('/').pop().replace(/_/g, ' ')} time ({offsetLabel(zoneOffset(BASE_ZONE))})</div>
      </div>

      <form onSubmit={assign}>
        <div className="assign-row">
          <div className="select-wrap">
            <select
              className="form-select"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              aria-label="Moderator"
            >
              <option value="">Select Moderator</option>
              {mods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <span className="select-chevron">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </div>

          <input
            className="form-input region-readonly"
            value={selected?.region || ''}
            placeholder="Moderator Region"
            readOnly
            aria-label="Region"
          />

          <input
            className="form-input time-input"
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
            placeholder="24-Hour Format e.g. 0800"
            inputMode="numeric"
            aria-label="Start time"
          />
          <span className="to-label">to</span>
          <input
            className="form-input time-input"
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
            placeholder="24-Hour Format e.g. 1630"
            inputMode="numeric"
            aria-label="End time"
          />

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Assigning…' : '+  Assign Shift'}
          </button>
        </div>

        <div className="days-row">
          {DAYS.map(([n, long]) => (
            <button
              key={n}
              type="button"
              className={`day-pill${form.days.includes(n) ? ' checked' : ''}`}
              onClick={() => toggleDay(n)}
              aria-pressed={form.days.includes(n)}
            >
              <span className="day-checkbox">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              {long}
            </button>
          ))}
        </div>
      </form>

      <div className="section-head schedule-head">
        <div>
          <div className="panel-title">Current Schedule</div>
          <div className="panel-sub">{schedules.length} shift{schedules.length === 1 ? '' : 's'} assigned</div>
        </div>
        <div className="segmented" role="tablist" aria-label="Schedule view">
          {[['list', 'List'], ['grid', 'Visual']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              className={view === id ? 'active' : ''}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <label className="search-box">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search Moderator's Name"
              aria-label="Search moderator's name"
            />
          </label>
          {view === 'list' && (
            <button className="sort-select" type="button" onClick={() => setSortAsc((v) => !v)}>
              Sort: Name {sortAsc ? 'A–Z' : 'Z–A'}
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <>
          <div className="activity-scroll">
            <table className="activity-table attendance-table schedule-table">
              <thead>
                <tr>
                  <th>Moderator</th>
                  <th>Region</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Total Hours</th>
                  <th>Working Days</th>
                  <th>Converted (Mod&apos;s local)</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="activity-empty">No shifts assigned yet.</td></tr>
                )}
                {pageRows.map((r) => {
                  const local = convertToRegion(r.start, r.end, r.region);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="mod-cell">
                          <UserAvatar userId={r.userId} name={r.name} className="mod-avatar is-completed" />
                          <div className="mod-name">{r.name}</div>
                        </div>
                      </td>
                      <td className="mono">{r.region}</td>
                      <td className="mono">{toHHMM(r.start)}</td>
                      <td className="mono">{toHHMM(r.end)}</td>
                      <td className="mono strong">{formatDuration(r.minutes)}</td>
                      <td className="days-cell">
                        {r.days.map((d) => <span key={d} className="day-chip">{SHORT_DAY[d]}</span>)}
                      </td>
                      <td>
                        <div className="converted-cell">
                          <span className="converted-time">{toClock(local.start)} – {toClock(local.end)}</span>
                          <span className="converted-tz">{local.label}</span>
                        </div>
                      </td>
                      <td className="status-col-cell">
                        <button
                          type="button"
                          className="icon-action-btn delete"
                          onClick={() => removeSchedule(r)}
                          title="Remove shift"
                          aria-label={`Remove ${r.name}'s shift`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                <FillerRows count={fillerCount(PAGE_SIZE, pageRows.length)} colSpan={8} tall />
              </tbody>
            </table>
          </div>

          <Pager page={page} pages={pages} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      ) : (
        <div className="timeline-wrap">
          <div className="timeline-board">
            <div className="tl-row tl-header">
              <div className="tl-col-head">Moderator</div>
              <div className="tl-timeline-head">
                {[0, 4, 8, 12, 16, 20, 24].map((h) => (
                  <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{pad(h)}:00</span>
                ))}
              </div>
              <div className="tl-col-head days-head">Working Days</div>
            </div>

            {rows.length === 0 && <div className="activity-empty-block">No shifts assigned yet.</div>}

            {rows.map((r) => {
              const width = (r.minutes / 1440) * 100;
              const left = (r.start / 1440) * 100;
              const tone = shiftTone(r.start);
              // A shift crossing midnight is drawn as two pieces.
              const overnight = r.end <= r.start;

              return (
                <div className="tl-row" key={r.id}>
                  <div className="tl-mod-cell">
                    <UserAvatar userId={r.userId} name={r.name} className="mod-avatar is-completed" />
                    <div>
                      <div className="mod-name">{r.name}</div>
                      <div className="tl-mod-region">{r.region}</div>
                    </div>
                  </div>

                  <div className="tl-track">
                    <div className="tl-gridlines">
                      {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
                        <i key={h} className={h % 4 === 0 ? 'major' : ''} style={{ left: `${(h / 24) * 100}%` }} />
                      ))}
                    </div>

                    {overnight ? (
                      <>
                        <div className={`tl-bar tl-bar-${tone}`} style={{ left: `${left}%`, width: `${100 - left}%` }}>
                          <span className="t">{toClock(r.start)}</span>
                        </div>
                        <div className={`tl-bar tl-bar-${tone}`} style={{ left: 0, width: `${(r.end / 1440) * 100}%` }}>
                          <span className="t dim">{toClock(r.end)}</span>
                        </div>
                      </>
                    ) : (
                      <div className={`tl-bar tl-bar-${tone}`} style={{ left: `${left}%`, width: `${width}%` }}>
                        <span className="t">{toClock(r.start)}</span>
                        <span className="t dim">{toClock(r.end)}</span>
                      </div>
                    )}

                    <div className="tl-now-line" style={{ left: `${nowPct}%` }}>
                      <div className="tl-now-dot" />
                    </div>
                  </div>

                  <div className="tl-days-cell">
                    {r.days.map((d) => <span key={d} className="day-chip">{SHORT_DAY[d]}</span>)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid-legend">
            {[['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']].map(([tone, label]) => (
              <span className="legend-item" key={tone}>
                <span className={`legend-swatch tl-bar-${tone}`} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </DashLayout>
  );
}
