import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import { formatClock, formatDate, formatDuration, toDateInput } from '../utils/time.js';
import {
  downloadCsv,
  fetchDailyReport,
  downloadDailyCsv,
  openDailyPdf,
} from '../utils/dailyReport.js';

const PAGE_SIZE = 10;
const PERIODS = ['daily', 'monthly', 'yearly'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/*
 * The three states a rostered day can end in. Since the board only lists people
 * scheduled to work (or who turned up anyway), "Absent" now means something
 * specific: rostered and never clocked in. Someone who worked their shift and
 * left is off duty, not absent.
 */
const STATUS = {
  onduty: { label: 'On duty', cls: 'pill-onduty' },
  // Worked the shift and left.
  completed: { label: 'Off duty', cls: 'pill-completed' },
  // Rostered, hasn't clocked in, but the shift has not finished yet — so it is
  // too early to call it a miss. Reads the same as `completed` on purpose.
  upcoming: { label: 'Off duty', cls: 'pill-completed' },
  // Rostered, never clocked in, and the shift window has passed.
  absent: { label: 'Absent', cls: 'pill-absent' },
};

const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const shiftDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
};

/** Local-time bounds and a label for the contribution period. */
function periodRange(period, sel) {
  if (period === 'daily') {
    const day = new Date(`${sel.date}T00:00:00`);
    return { from: day, to: endOfDay(day), label: formatDate(day) };
  }
  if (period === 'monthly') {
    return {
      from: new Date(sel.year, sel.month, 1),
      to: endOfDay(new Date(sel.year, sel.month + 1, 0)),
      label: `${MONTHS[sel.month]} ${sel.year}`,
    };
  }
  return {
    from: new Date(sel.year, 0, 1),
    to: endOfDay(new Date(sel.year, 11, 31)),
    label: String(sel.year),
  };
}

export default function TeamReport() {
  const now = useMemo(() => new Date(), []);
  const years = useMemo(() => Array.from({ length: 11 }, (_, i) => now.getFullYear() - i), [now]);

  const [view, setView] = useState('attendance');
  const [error, setError] = useState('');

  // --- attendance ---
  const [date, setDate] = useState(toDateInput(now));
  const [attendance, setAttendance] = useState([]);
  const [attendanceQuery, setAttendanceQuery] = useState('');
  const [attendancePage, setAttendancePage] = useState(1);

  // --- contribution ---
  const [period, setPeriod] = useState('monthly');
  const [sel, setSel] = useState({ date: toDateInput(now), month: now.getMonth(), year: now.getFullYear() });
  const [contribution, setContribution] = useState([]);
  const [contributionQuery, setContributionQuery] = useState('');
  const [contributionPage, setContributionPage] = useState(1);
  const [sortDesc, setSortDesc] = useState(true);
  // userId whose per-person report is being built, so its buttons can disable.
  const [busyExport, setBusyExport] = useState(null);

  const range = useMemo(() => periodRange(period, sel), [period, sel]);

  const dateInput = useRef(null);

  /** Opens the native calendar. Chrome only does this from its own small
   *  indicator otherwise, so clicking the field or the icon does nothing. */
  const openDatePicker = () => {
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus(); // older browsers: fall back to the built-in indicator
    }
  };

  useEffect(() => {
    api
      .get('/entries/overview', { params: { date } })
      .then(({ data }) => {
        setAttendance(data.rows);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, 'Could not load attendance')));
  }, [date]);

  useEffect(() => {
    api
      .get('/entries/summary', { params: { from: range.from.toISOString(), to: range.to.toISOString() } })
      .then(({ data }) => {
        setContribution(data.rows);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, 'Could not load contribution')));
  }, [range.from, range.to]);

  const filteredAttendance = useMemo(() => {
    const q = attendanceQuery.trim().toLowerCase();
    return q ? attendance.filter((r) => r.name.toLowerCase().includes(q)) : attendance;
  }, [attendance, attendanceQuery]);

  const filteredContribution = useMemo(() => {
    const q = contributionQuery.trim().toLowerCase();
    const list = q ? contribution.filter((r) => r.name.toLowerCase().includes(q)) : contribution;
    return [...list].sort((a, b) => (sortDesc ? b.minutes - a.minutes : a.minutes - b.minutes));
  }, [contribution, contributionQuery, sortDesc]);

  const topMinutes = Math.max(1, ...contribution.map((r) => r.minutes || 0));

  const pageOf = (list, page) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagesOf = (list) => Math.max(1, Math.ceil(list.length / PAGE_SIZE));

  function updateSel(patch) {
    setSel((prev) => ({ ...prev, ...patch }));
    setContributionPage(1);
  }

  const exportAttendance = useCallback(() => {
    downloadCsv(
      `attendance-${date}.csv`,
      ['Moderator', 'Username', 'Clock in', 'Clock out', 'Total hours', 'Status'],
      filteredAttendance.map((r) => [
        r.name,
        r.username,
        r.in ? formatClock(r.in) : '',
        r.out ? formatClock(r.out) : '',
        formatDuration(r.minutes),
        (STATUS[r.status] || STATUS.absent).label,
      ])
    );
  }, [filteredAttendance, date]);

  /** Day-by-day report for one person, in either format. */
  async function exportPerson(person, kind) {
    setBusyExport(person.userId);
    try {
      const report = await fetchDailyReport(person, range);
      if (kind === 'csv') downloadDailyCsv(person, range, report);
      else {
        const blocked = openDailyPdf(person, range, report);
        if (blocked) setError(blocked);
      }
    } catch (err) {
      setError(errorMessage(err, `Could not build the report for ${person.name}`));
    } finally {
      setBusyExport(null);
    }
  }

  const exportContribution = useCallback(() => {
    downloadCsv(
      `contribution-${range.label.replace(/\s+/g, '-').toLowerCase()}.csv`,
      ['Moderator', 'Username', 'Total hours', 'Minutes'],
      filteredContribution.map((r) => [r.name, r.username, formatDuration(r.minutes), r.minutes])
    );
  }, [filteredContribution, range.label]);

  /*
   * PDF goes through the browser's print dialog ("Save as PDF") — a real PDF
   * writer would mean pulling in a rendering library. A print stylesheet strips
   * the chrome so only the table prints.
   */
  const exportButtons = (toCsv) => (
    <div className="export-buttons">
      <button className="export-btn pdf" type="button" onClick={() => window.print()}>
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
        </svg>
        Export PDF
      </button>
      <button className="export-btn excel" type="button" onClick={toCsv}>
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </svg>
        Export Excel
      </button>
    </div>
  );

  const searchBox = (value, onChange) => (
    <label className="search-box">
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
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
    <DashLayout title="Moderator Report" subtitle="Full attendance history and contribution analytics" flush>
      {error && <div className="dash-error" role="alert">{error}</div>}

      <div className="tabs" role="tablist">
        {[
          ['attendance', 'Full Attendance View'],
          ['contribution', "Moderator's Contribution"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`tab-btn${view === id ? ' active' : ''}`}
            onClick={() => {
              setView(id);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'attendance' ? (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              {searchBox(attendanceQuery, (e) => {
                setAttendanceQuery(e.target.value);
                setAttendancePage(1);
              })}
            </div>

            <div className="toolbar-right">
              <div className="date-picker">
                <button className="date-nav-btn" type="button" onClick={() => setDate(shiftDays(date, -1))} aria-label="Previous day">‹</button>

                <button className="date-open" type="button" onClick={openDatePicker} aria-label="Open calendar">
                  <svg className="calendar" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="17" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                </button>

                <input
                  ref={dateInput}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onClick={openDatePicker}
                  aria-label="Date"
                />

                <button className="date-nav-btn" type="button" onClick={() => setDate(shiftDays(date, 1))} aria-label="Next day">›</button>
              </div>
              {exportButtons(exportAttendance)}
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Moderator</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th>Total hours</th>
                  <th className="num">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.length === 0 && (
                  <tr><td colSpan={5} className="activity-empty">No moderators match.</td></tr>
                )}
                {pageOf(filteredAttendance, attendancePage).map((r) => {
                  const s = STATUS[r.status] || STATUS.absent;
                  return (
                    <tr key={r.userId}>
                      <td>
                        <div className="mod-cell">
                          <UserAvatar userId={r.userId} name={r.name} className={`mod-avatar is-${r.status}`} />
                          <div>
                            <div className="mod-name">{r.name}</div>
                            <div className="mod-role">@{r.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono">{r.in ? formatClock(r.in) : '——'}</td>
                      <td className="mono">{r.out ? formatClock(r.out) : '——'}</td>
                      {/* Completed sessions still count while a later one is
                          running — showing only "In progress" hid them. */}
                      <td className={r.status === 'onduty' && !r.minutes ? 'muted-italic' : 'mono strong'}>
                        {r.status === 'onduty' && !r.minutes ? (
                          'In progress'
                        ) : (
                          <>
                            {formatDuration(r.minutes)}
                            {r.status === 'onduty' && <span className="muted-italic"> + running</span>}
                          </>
                        )}
                      </td>
                      <td className="status-col-cell">
                        <span className={`pill-status ${s.cls}`}>{s.label}</span>
                      </td>
                    </tr>
                  );
                })}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(filteredAttendance, attendancePage).length)}
                  colSpan={5}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager
            page={attendancePage}
            pages={pagesOf(filteredAttendance)}
            total={filteredAttendance.length}
            pageSize={PAGE_SIZE}
            onChange={setAttendancePage}
          />
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-left">
              {searchBox(contributionQuery, (e) => {
                setContributionQuery(e.target.value);
                setContributionPage(1);
              })}

              <div className="segmented" role="tablist" aria-label="Reporting period">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={period === p}
                    className={period === p ? 'active' : ''}
                    onClick={() => {
                      setPeriod(p);
                      setContributionPage(1);
                    }}
                  >
                    {p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>

              <div className="period-picker">
                {period === 'daily' && (
                  <div className="period-group">
                    <span className="picker-label">Date</span>
                    <input type="date" value={sel.date} onChange={(e) => updateSel({ date: e.target.value })} aria-label="Date" />
                  </div>
                )}
                {period === 'monthly' && (
                  <div className="period-group">
                    <span className="picker-label">Month</span>
                    <select value={sel.month} onChange={(e) => updateSel({ month: Number(e.target.value) })} aria-label="Month">
                      {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                    </select>
                    <span className="picker-label">Year</span>
                    <select value={sel.year} onChange={(e) => updateSel({ year: Number(e.target.value) })} aria-label="Year">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                )}
                {period === 'yearly' && (
                  <div className="period-group">
                    <span className="picker-label">Year</span>
                    <select value={sel.year} onChange={(e) => updateSel({ year: Number(e.target.value) })} aria-label="Year">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="toolbar-right">
              <button className="sort-select" type="button" onClick={() => setSortDesc((v) => !v)}>
                Sort: {sortDesc ? 'Highest hours' : 'Lowest hours'}
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {exportButtons(exportContribution)}
            </div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Moderator</th>
                  <th>Total hours</th>
                  {/* Dropped when printing: buttons are no use on paper. This is
                      the team-wide print only — the per-person report is a
                      separate document and is untouched. */}
                  <th className="num no-print">Day-by-day report</th>
                </tr>
              </thead>
              <tbody>
                {filteredContribution.length === 0 && (
                  <tr><td colSpan={3} className="activity-empty">No completed shifts in {range.label}.</td></tr>
                )}
                {pageOf(filteredContribution, contributionPage).map((r) => (
                  <tr key={r.userId}>
                    <td>
                      <div className="mod-cell">
                        <UserAvatar userId={r.userId} name={r.name} className="mod-avatar is-completed" />
                        <div>
                          <div className="mod-name">{r.name}</div>
                          <div className="mod-role">@{r.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="hours-bar-wrap">
                        <span className="mono strong">{formatDuration(r.minutes)}</span>
                        <span className="hours-bar-track">
                          <span className="hours-bar-fill" style={{ width: `${Math.round((r.minutes / topMinutes) * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="status-col-cell no-print">
                      <div className="actions-cell">
                        <button
                          className="export-btn pdf compact"
                          type="button"
                          onClick={() => exportPerson(r, 'pdf')}
                          disabled={busyExport === r.userId}
                          title={`Day-by-day PDF for ${r.name}, ${range.label}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          PDF
                        </button>
                        <button
                          className="export-btn excel compact"
                          type="button"
                          onClick={() => exportPerson(r, 'csv')}
                          disabled={busyExport === r.userId}
                          title={`Day-by-day spreadsheet for ${r.name}, ${range.label}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
                          </svg>
                          Excel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(filteredContribution, contributionPage).length)}
                  colSpan={3}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager
            page={contributionPage}
            pages={pagesOf(filteredContribution)}
            total={filteredContribution.length}
            pageSize={PAGE_SIZE}
            onChange={setContributionPage}
          />
        </>
      )}
    </DashLayout>
  );
}
