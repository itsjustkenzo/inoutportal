import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import { LoadingOverlay } from '../components/LoadingCat.jsx';
import {
  dayRangeIn,
  formatClock,
  formatDate,
  formatDay,
  formatDuration,
  monthRangeIn,
  partsIn,
  toDateInput,
  yearRangeIn,
} from '../utils/time.js';
import { useZone } from '../utils/zone.js';

const PAGE_SIZE = 10;
const PERIODS = ['daily', 'monthly', 'yearly'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Bounds and a label for the selected period, measured in the moderator's own
 * zone. Picking "August" in São Paulo has to mean August there — asking for
 * Malaysian August would drop the evening of the 31st and pull in the evening
 * of the 31st of July.
 */
function periodRange(period, sel, zone) {
  if (period === 'daily') {
    const [y, m, d] = sel.date.split('-').map(Number);
    const range = dayRangeIn(y, m - 1, d, zone);
    return { ...range, label: formatDate(range.from, zone) };
  }
  if (period === 'monthly') {
    return { ...monthRangeIn(sel.year, sel.month, zone), label: `${MONTHS[sel.month]} ${sel.year}` };
  }
  return { ...yearRangeIn(sel.year, zone), label: String(sel.year) };
}

export default function History() {
  const { zone } = useZone();
  const now = useMemo(() => new Date(), []);
  // "This year" and "this month" are the moderator's, so the defaults and the
  // year list are read off their calendar rather than the browser's.
  const todayParts = useMemo(() => partsIn(now, zone), [now, zone]);
  const years = useMemo(
    () => Array.from({ length: 11 }, (_, i) => todayParts.year - i),
    [todayParts.year]
  );

  const [period, setPeriod] = useState('monthly');
  const [sel, setSel] = useState({
    date: toDateInput(now, zone),
    month: todayParts.month,
    year: todayParts.year,
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ entries: [], total: 0, page: 1, pages: 1, totalMinutes: 0, workDays: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => periodRange(period, sel, zone), [period, sel, zone]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get('/entries/history', {
        params: {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          page,
          limit: PAGE_SIZE,
        },
      });
      setData(res);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your report'));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Any change of period resets paging, otherwise page 3 of a month can outlive the filter.
  function choosePeriod(next) {
    setPeriod(next);
    setPage(1);
  }

  function updateSel(patch) {
    setSel((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  // Loading and empty each render a single message row, so they pad to the same height.
  const renderedRows = loading || data.entries.length === 0 ? 1 : data.entries.length;
  const fillerRows = Math.max(0, PAGE_SIZE - renderedRows);

  return (
    <DashLayout title="My Report" subtitle="Review your working hours and attendance history" flush>
      {error && <div className="dash-error" role="alert">{error}</div>}

      <div className="toolbar">
        <div className="toolbar-left">
          <div className="segmented" role="tablist" aria-label="Report period">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                className={period === p ? 'active' : ''}
                onClick={() => choosePeriod(p)}
              >
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          <div className="period-picker">
            {period === 'daily' && (
              <div className="period-group">
                <span className="picker-label">Date</span>
                <input
                  type="date"
                  value={sel.date}
                  onChange={(e) => updateSel({ date: e.target.value })}
                  aria-label="Date"
                />
              </div>
            )}

            {period === 'monthly' && (
              <div className="period-group">
                <span className="picker-label">Month</span>
                <select value={sel.month} onChange={(e) => updateSel({ month: Number(e.target.value) })} aria-label="Month">
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i}>{m}</option>
                  ))}
                </select>
                <span className="picker-label">Year</span>
                <select value={sel.year} onChange={(e) => updateSel({ year: Number(e.target.value) })} aria-label="Year">
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}

            {period === 'yearly' && (
              <div className="period-group">
                <span className="picker-label">Year</span>
                <select value={sel.year} onChange={(e) => updateSel({ year: Number(e.target.value) })} aria-label="Year">
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="split-row">
        <div className="split-cell">
          <div className="summary-label">Total Hours Worked</div>
          <div className="summary-value">{formatDuration(data.totalMinutes)}</div>
          <div className="summary-meta">{range.label}</div>
        </div>
        <div className="split-cell">
          <div className="summary-label">Work Days</div>
          <div className="summary-small">
            {data.workDays} {data.workDays === 1 ? 'day' : 'days'}
          </div>
          <div className="summary-meta">Recorded attendance entries</div>
        </div>
      </div>

      <div>
        <div className="section-head">
          <div className="panel-title">Attendance Details</div>
          <div className="panel-sub">Clock-in and clock-out records for the selected period</div>
        </div>

        <div className="activity-scroll is-busy">
          <LoadingOverlay show={loading} text="Loading records…" size={88} />
          <table className="activity-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Total Hours</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="activity-empty">&nbsp;</td>
                </tr>
              )}
              {!loading && data.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="activity-empty">No records for {range.label}.</td>
                </tr>
              )}
              {!loading &&
                data.entries.map((e) => (
                  <tr key={e._id}>
                    <td className="strong">{formatDate(e.in, zone)}</td>
                    <td>{formatDay(e.in, zone)}</td>
                    <td className="mono">{formatClock(e.in, zone)}</td>
                    <td className="mono">{e.out ? formatClock(e.out, zone) : 'In progress'}</td>
                    <td className="mono strong">{e.out ? formatDuration(e.minutes) : '—'}</td>
                  </tr>
                ))}

              {/* Blank rows keep the table a fixed height, so a short last page
                  (or the loading/empty state) does not shrink the panel. */}
              {Array.from({ length: fillerRows }, (_, i) => (
                <tr key={`filler-${i}`} className="filler-row" aria-hidden="true">
                  <td colSpan={5} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </div>
    </DashLayout>
  );
}
