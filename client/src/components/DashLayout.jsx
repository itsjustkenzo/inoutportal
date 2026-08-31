import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { usePrefs } from '../context/PrefsContext.jsx';

const initials = (name) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const ICONS = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </svg>
  ),
  report: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
      <path d="M12 3l7 3v6c0 4.4-2.9 7.9-7 9-4.1-1.1-7-4.6-7-9V6l7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
};

const navClass = ({ isActive }) => `dash-nav-item${isActive ? ' active' : ''}`;

/**
 * Sidebar + topbar shell shared by the dashboard and report pages.
 * `title` and `subtitle` fill the header; `children` is the page body.
 */
export default function DashLayout({
  title,
  subtitle,
  // `flush` drops the body padding so content can meet the container edges.
  flush = false,
  // Pins the page to one accent regardless of the viewer's own preference.
  accent = null,
  children,
}) {
  const { user, isAdmin, isAudit, isManager, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { avatar, wallpaper } = usePrefs();
  const navigate = useNavigate();

  useEffect(() => {
    document.body.classList.add('dash-bg');
    return () => document.body.classList.remove('dash-bg');
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className={`mod-shell${accent ? ` accent-${accent}` : ''}`}>
      {/* Audit accounts have no personalization, so neither is offered nor shown
          — a wallpaper left over from an earlier upload stays hidden. */}
      {!isAudit && wallpaper && <div className="wallpaper-layer" aria-hidden="true" />}

      <aside className="dash-sidebar">
        <div className="user-greeting">
          <div className="user-avatar">
            {!isAudit && avatar ? <img src={avatar} alt="" /> : initials(user.name)}
          </div>
          <div className="greeting-line">
            <span className="greeting-kicker">Hi,</span>
            <span className="greeting-name">{user.name.split(' ')[0]}</span>
          </div>
        </div>

        {/* Two labelled groups, as in the design: what you look at, then who you
            are. `title` carries the label when the nav collapses to icons. */}
        {/* Audit is read-only payroll oversight: contribution totals, nothing else. */}
        {isAudit && (
          <>
            <div className="nav-label">Payroll</div>
            <NavLink to="/finance" className={navClass} title="Contribution Report">
              {ICONS.report}Contribution Report
            </NavLink>
          </>
        )}
        {!isAudit && <div className="nav-label">Overview</div>}
        {!isAudit && (isAdmin ? (
          // Admins land on the team view, so they get that in place of the
          // personal dashboard rather than a link that redirects away.
          // `end` so it does not stay highlighted on /admin/report, which
          // NavLink otherwise treats as a match on the parent path.
          // A server manager outranks the admins the board reports on, so the
          // label says so.
          <NavLink
            to="/admin"
            end
            className={navClass}
            title={isManager ? 'Server Admin Dashboard' : 'Admin Dashboard'}
          >
            {ICONS.team}{isManager ? 'Server Admin Dashboard' : 'Admin Dashboard'}
          </NavLink>
        ) : (
          <>
            <NavLink to="/" end className={navClass} title="My Dashboard">
              {ICONS.dashboard}My Dashboard
            </NavLink>
            {/* Admins have no clock-in dashboard, so a personal report has
                nothing to show — the team view covers attendance for them. */}
            <NavLink to="/history" className={navClass} title="My Report">
              {ICONS.report}My Report
            </NavLink>
          </>
        ))}

        {isAdmin && (
          <>
            <div className="nav-label">Moderation</div>
            <NavLink to="/admin/report" className={navClass} title="Moderator Report">
              {ICONS.report}Moderator Report
            </NavLink>
            <NavLink to="/admin/moderators" className={navClass} title="Moderator Management">
              {ICONS.team}Moderator Management
            </NavLink>
            {/* Rostering is an admin job; the manager oversees rather than schedules. */}
            {!isManager && (
              <NavLink to="/admin/schedule" className={navClass} title="Schedule">
                {ICONS.calendar}Schedule
              </NavLink>
            )}
          </>
        )}

        {/* Payroll reporting stays with the finance role; the manager oversees
            accounts and records through the console instead. */}
        {isManager && (
          <>
            <div className="nav-label">Server</div>
            <NavLink to="/manager" className={navClass} title="Server Management">
              {ICONS.shield}Server Management
            </NavLink>
          </>
        )}

        <div className="nav-label">Account</div>
        <NavLink to="/profile" className={navClass} title="My Account">{ICONS.account}My Account</NavLink>

        <div className="sidebar-spacer" />

        <button className="logout-btn" type="button" onClick={handleLogout} title="Logout">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" aria-hidden="true">
            <path d="M10 17l5-5-5-5" />
            <path d="M15 12H3" />
            <path d="M21 19V5a2 2 0 0 0-2-2h-6" />
          </svg>
          Logout
        </button>
      </aside>

      <main className="dash-main">
        <div className="dash-content">
          <div className="topbar">
            <div>
              <div className="page-title">{title}</div>
              {subtitle && <div className="page-sub">{subtitle}</div>}
            </div>

            <button
              className="dash-theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={isDark}
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
              </svg>
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
              </svg>
            </button>
          </div>

          <div className={`dash-body${flush ? ' flush' : ''}`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
