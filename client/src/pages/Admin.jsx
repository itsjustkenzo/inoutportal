import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLive, useLiveEvent } from '../context/LiveContext.jsx';
import DashLayout from '../components/DashLayout.jsx';
import Pager from '../components/Pager.jsx';
import FillerRows, { fillerCount } from '../components/FillerRows.jsx';
import { LoadingOverlay } from '../components/LoadingCat.jsx';
import { formatClock, formatDateTime, formatRelative } from '../utils/time.js';
import UserAvatar from '../components/UserAvatar.jsx';

const PAGE_SIZE = 5;

/** What the connection indicator says in each state. */
const LIVE_LABEL = {
  live: { text: 'Live', hint: 'Updating as events happen' },
  connecting: { text: 'Connecting', hint: 'Opening the live connection' },
  offline: { text: 'Reconnecting', hint: 'Live connection lost — retrying, and still refreshing every 2 minutes' },
  idle: { text: 'Offline', hint: 'Not connected' },
};
/** How many recent changes the dashboard previews before "View all". */
const LOG_PREVIEW = 6;

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

const ICONS = {
  in: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      <path d="M12 22c5.5-3 9-6.5 9-11.5A9 9 0 0 0 3 10.5C3 15.5 6.5 19 12 22Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  total: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  out: (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
};

export default function Admin() {
  const { isManager } = useAuth();
  const { status: liveStatus } = useLive();

  const [data, setData] = useState({ counts: { in: 0, out: 0, total: 0 }, rows: [], activity: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [activityPage, setActivityPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);
  const [log, setLog] = useState({ logs: [], total: 0 });

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get('/entries/overview');
      setData(res);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load the admin dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLog = useCallback(() => {
    if (!isManager) return;
    api
      .get('/audit', { params: { limit: LOG_PREVIEW } })
      .then(({ data: res }) => setLog(res))
      .catch(() => { /* the dashboard still works without the trail */ });
  }, [isManager]);

  /*
   * The stream carries the updates; the interval is only a safety net for a
   * dropped connection, which is why it is slow. When the stream is live the
   * board refreshes the moment something happens, not on the next tick.
   */
  useEffect(() => {
    load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    loadLog();
    const id = setInterval(loadLog, 120000);
    return () => clearInterval(id);
  }, [loadLog]);

  // A punch changes the counts, the attendance rows and the feed together.
  useLiveEvent(() => {
    load();
    loadLog();
  }, ['attendance']);

  // Account and schedule edits change who appears on the board.
  useLiveEvent(() => {
    load();
    loadLog();
  }, ['account', 'schedule']);

  const { counts, rows, activity } = data;

  const pageOf = (list, page) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagesOf = (list) => Math.max(1, Math.ceil(list.length / PAGE_SIZE));

  return (
    <DashLayout
      title={isManager ? 'Server Admin Dashboard' : 'Admin Dashboard'}
      subtitle="Moderator attendance and activity overview"
      flush
    >
      {error && <div className="dash-error" role="alert">{error}</div>}

      <div className="stats">
        <div className="stat-card stat-in">
          <div className="stat-top">
            <div className="stat-icon">{ICONS.in}</div>
            <div className="stat-delta">on duty now</div>
          </div>
          <div className="stat-num">{counts.in}</div>
          <div className="stat-label">Clocked in</div>
        </div>

        <div className="stat-card stat-total">
          <div className="stat-top">
            <div className="stat-icon">{ICONS.total}</div>
            <div className="stat-delta">{counts.total} active</div>
          </div>
          <div className="stat-num">{counts.total}</div>
          <div className="stat-label">Moderators</div>
        </div>

        <div className="stat-card stat-out">
          <div className="stat-top">
            <div className="stat-icon">{ICONS.out}</div>
            <div className="stat-delta">finished today</div>
          </div>
          <div className="stat-num">{counts.out}</div>
          <div className="stat-label">Clocked out</div>
        </div>
      </div>

      <div className="admin-panels is-busy">
        {/* Covers only the data panels, so the headline counts stay put. */}
        <LoadingOverlay show={loading} text="Loading attendance…" />
        <section className="admin-panel">
          <div className="section-head schedule-head">
            <div>
              <div className="panel-title">Recent Activity</div>
              <div className="panel-sub">Latest clock-ins and clock-outs</div>
            </div>
            <span className={`live-pill is-${liveStatus}`} title={LIVE_LABEL[liveStatus]?.hint}>
              <span className="live-dot" />
              {LIVE_LABEL[liveStatus]?.text}
            </span>
          </div>

          <div className="activity-list">
            {!loading && activity.length === 0 && (
              <div className="activity-empty-block">No punches recorded today.</div>
            )}
            {pageOf(activity, activityPage).map((a) => (
              <div className="activity-item" key={`${a.userId}-${a.type}-${a.at}`}>
                <UserAvatar
                  userId={a.userId}
                  name={a.name}
                  className={`act-avatar ${a.type === 'in' ? 'is-in' : 'is-out'}`}
                />
                <div className="act-body">
                  <div className="act-name">{a.name}</div>
                  <div className="act-meta">{a.department}</div>
                </div>
                <div className="act-right">
                  <span className={`act-tag ${a.type === 'in' ? 'tag-in' : 'tag-out'}`}>
                    {a.type === 'in' ? 'Clocked in' : 'Clocked out'}
                  </span>
                  <span className="act-time">{formatRelative(a.at)}</span>
                </div>
              </div>
            ))}

            {/* Blanks hold the feed at a constant height on a short last page. */}
            {Array.from(
              { length: fillerCount(PAGE_SIZE, pageOf(activity, activityPage).length) },
              (_, i) => <div className="activity-item filler" key={`f-${i}`} aria-hidden="true" />
            )}
          </div>

          <Pager
            page={activityPage}
            pages={pagesOf(activity)}
            total={activity.length}
            pageSize={PAGE_SIZE}
            onChange={setActivityPage}
          />
        </section>

        <section className="admin-panel">
          <div className="section-head">
            <div className="panel-title">Moderator Attendance</div>
            <div className="panel-sub">Today&apos;s clock-in and clock-out times</div>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
              <thead>
                <tr>
                  <th>Moderator</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th className="num">Status</th>
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="activity-empty">No active moderators.</td>
                  </tr>
                )}
                {pageOf(rows, attendancePage).map((r) => {
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
                      <td className="status-col-cell">
                        <span className={`pill-status ${s.cls}`}>{s.label}</span>
                      </td>
                    </tr>
                  );
                })}

                <FillerRows
                  count={fillerCount(PAGE_SIZE, pageOf(rows, attendancePage).length)}
                  colSpan={4}
                  tall
                />
              </tbody>
            </table>
          </div>

          <Pager
            page={attendancePage}
            pages={pagesOf(rows)}
            total={rows.length}
            pageSize={PAGE_SIZE}
            onChange={setAttendancePage}
          />
        </section>
      </div>

      {/* Only a server manager can read the change trail, so only they see it. */}
      {isManager && (
        <section className="admin-panel log-panel">
          <div className="section-head schedule-head">
            <div>
              <div className="panel-title">Activity Log</div>
              <div className="panel-sub">
                {log.total
                  ? `Latest of ${log.total} change${log.total === 1 ? '' : 's'} across the portal`
                  : 'Every change made across the portal'}
              </div>
            </div>
            <Link className="sort-select" to="/manager">View all</Link>
          </div>

          <div className="activity-scroll">
            <table className="activity-table attendance-table">
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
                        <div className="mod-name">{l.actorName}</div>
                      </div>
                    </td>
                    <td>
                      <div className="log-summary">{l.summary}</div>
                      <div className="mod-role">{l.action}</div>
                    </td>
                    <td className="status-col-cell">
                      <div className="mod-name">{l.targetName || '——'}</div>
                    </td>
                  </tr>
                ))}

                <FillerRows count={fillerCount(LOG_PREVIEW, log.logs.length)} colSpan={4} tall />
              </tbody>
            </table>
          </div>
        </section>
      )}
    </DashLayout>
  );
}
