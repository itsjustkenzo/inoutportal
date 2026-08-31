import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import {
  downloadCsv,
  fetchDailyReport,
  downloadDailyCsv,
  openDailyPdf,
} from '../utils/dailyReport.js';
import { formatDate, formatDuration, toDateInput } from '../utils/time.js';
import UserAvatar from '../components/UserAvatar.jsx';
import RemarkCell from '../components/RemarkCell.jsx';

const PAGE_SIZE = 10;
const PERIODS = ['daily', 'monthly', 'yearly'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/** Local-time bounds and a label for the reporting period. */
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

/**
 * Payroll view for the audit role: billable hours over a chosen day, month or
 * year, with the admin's remark against each day. Read-only by design.
 */
export default function Finance() {
  const now = useMemo(() => new Date(), []);
  const years = useMemo(() => Array.from({ length: 11 }, (_, i) => now.getFullYear() - i), [now]);

  const [period, setPeriod] = useState('monthly');
  const [sel, setSel] = useState({ date: toDateInput(now), month: now.getMonth(), year: now.getFullYear() });
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sortDesc, setSortDesc] = useState(true);
  const [error, setError] = useState('');
  // userId whose per-person report is being built, so its buttons can disable.
  const [busyExport, setBusyExport] = useState(null);

  const range = useMemo(() => periodRange(period, sel), [period, sel]);

  // A remark is written against one day, so the column only appears when the
  // report is showing one.
  const isDaily = period === 'daily';
  const colCount = isDaily ? 4 : 3;

  // userId -> remark text, for the selected day.
  const [remarks, setRemarks] = useState({});

  useEffect(() => {
    if (!isDaily) return;
    api
      .get('/remarks', { params: { date: sel.date } })
      .then(({ data }) => {
        setRemarks(Object.fromEntries(data.remarks.map((r) => [String(r.user), r.text])));
      })
      // The hours are the point of this page; a failed note fetch must not
      // stop them rendering.
      .catch(() => setRemarks({}));
  }, [isDaily, sel.date]);

  useEffect(() => {
    api
      .get('/entries/summary', { params: { from: range.from.toISOString(), to: range.to.toISOString() } })
      .then(({ data }) => {
        setRows(data.rows);
        setError('');
      })
      .catch((err) => setError(errorMessage(err, 'Could not load the contribution report')));
  }, [range.from, range.to]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    return [...list].sort((a, b) => (sortDesc ? b.minutes - a.minutes : a.minutes - b.minutes));
  }, [rows, query, sortDesc]);

  const topMinutes = Math.max(1, ...rows.map((r) => r.minutes || 0));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function updateSel(patch) {
    setSel((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  /** Day-by-day report for one moderator, in either format. */
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

  const exportCsv = useCallback(() => {
    downloadCsv(
      `contribution-${range.label.replace(/\s+/g, '-').toLowerCase()}.csv`,
      ['Moderator', 'Username', 'Total hours', 'Minutes', 'Shifts', 'Hours per shift'],
      filtered.map((r) => [
        r.name,
        r.username,
        formatDuration(r.minutes),
        r.minutes,
        r.sessions,
        formatDuration(Math.round(r.minutes / r.sessions)),
      ])
    );
  }, [filtered, range.label]);

  return (
    <DashLayout
      title="Moderator's Contribution"
      subtitle="Billable hours per moderator for payroll reconciliation"
      flush
      accent="green"
    >
      {error && <div className="dash-error" role="alert">{error}</div>}

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

          <div className="segmented" role="tablist" aria-label="Reporting period">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                className={period === p ? 'active' : ''}
                onClick={() => { setPeriod(p); setPage(1); }}
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

          {/* PDF goes through the browser's print dialog ("Save as PDF") — a real
              PDF writer would mean pulling in a rendering library. */}
          <div className="export-buttons">
            <button className="export-btn pdf" type="button" onClick={() => window.print()}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
              </svg>
              Export PDF
            </button>
            <button className="export-btn excel" type="button" onClick={exportCsv}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
              </svg>
              Export Excel
            </button>
          </div>
        </div>
      </div>

      <div className="activity-scroll">
        <table className="activity-table attendance-table">
          <thead>
            <tr>
              <th>Moderator</th>
              <th>Total hours</th>
              {/* A remark belongs to a single day, so the column only makes
                  sense while a single day is being shown. */}
              {isDaily && <th>Remarks</th>}
              {/* Dropped when printing: buttons are no use on paper. This is the
                  team-wide print only — the per-person report is a separate
                  document and is untouched. */}
              <th className="num no-print">Day-by-day report</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={colCount} className="activity-empty">No completed shifts in {range.label}.</td></tr>
            )}
            {pageRows.map((r) => (
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
                      <span
                        className="hours-bar-fill"
                        style={{ width: `${Math.round((r.minutes / topMinutes) * 100)}%` }}
                      />
                    </span>
                  </div>
                </td>
                {isDaily && (
                  <td className="remark-cell">
                    {/* Finance reads payroll rather than writing it, so the
                        note is shown but not editable here. */}
                    <RemarkCell userId={r.userId} date={sel.date} value={remarks[r.userId]} readOnly />
                  </td>
                )}
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

            <FillerRows count={fillerCount(PAGE_SIZE, pageRows.length)} colSpan={colCount} tall />
          </tbody>
        </table>
      </div>

      <Pager page={page} pages={pages} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
    </DashLayout>
  );
}
