import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

/*
 * Opt-in rather than opt-out. Every other page carries its own shell — the
 * sidebar layout or the full-viewport login — so listing the exceptions meant a
 * new page silently got this navbar stacked on top of its own nav.
 */
const NAVBAR_ROUTES = ['/register'];

export default function Navbar() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!NAVBAR_ROUTES.includes(location.pathname)) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <div className="brand">
          <span className="brand-mark">IN</span>
          <span className="brand-text">/OUT Portal</span>
        </div>

        {user && (
          <nav className="nav-links">
            <NavLink to="/" end>Board</NavLink>
            <NavLink to="/history">History</NavLink>
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            <NavLink to="/profile">Profile</NavLink>
          </nav>
        )}

        {user ? (
          <div className="nav-user">
            <span className={`pill pill-${user.status}`}>{user.status === 'in' ? 'IN' : 'OUT'}</span>
            <span className="nav-name">{user.name}</span>
            <ThemeToggle />
            <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
        ) : (
          // The auth pages carry their own toggle, so it is not repeated here.
          <nav className="nav-links">
            <NavLink to="/login">Log in</NavLink>
            <NavLink to="/register">Sign up</NavLink>
          </nav>
        )}
      </div>
    </header>
  );
}
