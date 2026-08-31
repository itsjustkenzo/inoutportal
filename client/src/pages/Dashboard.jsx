import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import {
  dayRangeIn,
  formatClock,
  formatDate,
  formatDay,
  formatDuration,
  formatStopwatch,
  partsIn,
} from '../utils/time.js';
import { offsetLabel, useZone } from '../utils/zone.js';

const PAGE_SIZE = 7;
// Head office time, shown alongside the moderator's own as a shared reference.
const BASE_ZONE = 'Asia/Kuala_Lumpur';

const clockFmt = (timeZone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

export default function Dashboard() {
  const { setUser } = useAuth();
  // Times follow the account's region, not the machine — a moderator in Brazil
  // reads Brazil time even from a laptop still set to Kuala Lumpur.
  const { zone, place, offset } = useZone();

  const [entry, setEntry] = useState(null);
  const [today, setToday] = useState({ minutes: 0, lastIn: null });
  const [activity, setActivity] = useState({ entries: [], total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Drives both wall clocks and the session stopwatch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadToday = useCallback(async () => {
    // "Today" has to be the moderator's today: their midnight, not the browser's.
    // Taken as a whole calendar day rather than midnight + 24h, since a day that
    // crosses a DST change is 23 or 25 hours long.
    const { year, month, day } = partsIn(Date.now(), zone);
    const { from, to } = dayRangeIn(year, month, day, zone);

    const { data } = await api.get('/entries/history', {
      params: { from: from.toISOString(), to: to.toISOString(), limit: 100 },
    });

    setToday({
      minutes: data.totalMinutes,
      lastIn: data.entries.length ? data.entries[0].in : null,
    });
  }, [zone]);

  const loadActivity = useCallback(async (targetPage) => {
    const { data } = await api.get('/entries/history', { params: { page: targetPage, limit: PAGE_SIZE } });
    setActivity(data);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/entries/current');
      setEntry(data.entry);
      await Promise.all([loadToday(), loadActivity(page)]);
    } catch (err) {
      setError(errorMessage(err, 'Could not load your dashboard'));
    }
  }, [loadToday, loadActivity, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function punch() {
    const direction = entry ? 'out' : 'in';
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post(`/entries/${direction}`);
      setEntry(direction === 'in' ? data.entry : null);
      setUser((prev) => ({ ...prev, status: data.status }));
      await Promise.all([loadToday(), loadActivity(page)]);
    } catch (err) {
      setError(errorMessage(err, 'Clock action failed'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  // The empty state renders a single message row, so it pads to the same height.
  const renderedRows = activity.entries.length === 0 ? 1 : activity.entries.length;
  const fillerRows = Math.max(0, PAGE_SIZE - renderedRows);

  const isIn = Boolean(entry);
  const openMs = isIn ? now - new Date(entry.in).getTime() : 0;
  const workedMinutes = today.minutes + (isIn ? Math.floor(openMs / 60000) : 0);

  return (
    <DashLayout title="My Dashboard" subtitle="Track your work session and recent attendance activity" flush>
      {error && <div className="dash-error" role="alert">{error}</div>}

      <div className="split-row">
        <div className="split-cell">
          <div className="clock-label">Malaysia Time</div>
          <div className="clock-time">{clockFmt(BASE_ZONE).format(now)}</div>
          <div className="clock-meta">Malaysia · MYT ({offsetLabel(BASE_ZONE)})</div>
        </div>
        <div className="split-cell">
          <div className="clock-label">Your Local Time</div>
          <div className="clock-time">{clockFmt(zone).format(now)}</div>
          <div className="clock-meta">{place} · {offset}</div>
        </div>
      </div>

      <div className="split-row">
        <div className="split-cell">
          <div className="action-head">
            <div className="action-title">Work Session</div>
            <div className={`duty-pill${isIn ? ' on' : ''}`}>{isIn ? 'On Duty' : 'Off Duty'}</div>
          </div>
          <div className="session-copy">
            {isIn ? 'Current session is in progress.' : 'You are currently not clocked in.'}
          </div>
          <div className="session-timer">{formatStopwatch(openMs)}</div>
          <button className={`clock-btn${isIn ? ' out' : ''}`} onClick={punch} disabled={busy}>
            {busy ? '…' : isIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>

        <div className="split-cell">
          <div className="status-title">Today's Status</div>
          <div className="status-row">
            <div className="status-key">Hours Worked</div>
            <div className="status-value">{formatDuration(workedMinutes)}</div>
          </div>
          <div className="status-row">
            <div className="status-key">Status</div>
            <div className="status-value">{isIn ? 'On Duty' : 'Off Duty'}</div>
          </div>
          <div className="status-row">
            <div className="status-key">Last Clock In</div>
            <div className="status-value">{formatClock(today.lastIn, zone)}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="section-head">
          <div className="panel-title">Your Activity</div>
          <div className="panel-sub">Recent clock-in and clock-out history</div>
        </div>

        <div className="activity-scroll">
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
              {activity.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="activity-empty">No activity recorded yet.</td>
                </tr>
              )}
              {activity.entries.map((e) => (
                <tr key={e._id}>
                  <td className="strong">{formatDate(e.in, zone)}</td>
                  <td>{formatDay(e.in, zone)}</td>
                  <td className="mono">{formatClock(e.in, zone)}</td>
                  <td className="mono">{e.out ? formatClock(e.out, zone) : 'In progress'}</td>
                  <td className="mono strong">{e.out ? formatDuration(e.minutes) : '—'}</td>
                </tr>
              ))}

              {/* Blank rows hold the table at a fixed height, so a short last
                  page does not shrink the panel. */}
              {Array.from({ length: fillerRows }, (_, i) => (
                <tr key={`filler-${i}`} className="filler-row" aria-hidden="true">
                  <td colSpan={5} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pager
          page={activity.page}
          pages={activity.pages}
          total={activity.total}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </div>
    </DashLayout>
  );
}
