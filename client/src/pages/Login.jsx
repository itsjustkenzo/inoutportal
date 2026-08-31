import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { errorMessage } from '../api/client.js';
import { homeFor } from '../components/ProtectedRoute.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Full-bleed gradient backdrop, removed again when leaving the page.
  useEffect(() => {
    document.body.classList.add('auth-bg');
    return () => document.body.classList.remove('auth-bg');
  }, []);

  if (user) {
    return <Navigate to={location.state?.from?.pathname || homeFor(user.role)} replace />;
  }

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const signedIn = await login(form.username.trim(), form.password);
      // Land on the view that matches the role, unless a guarded page sent us here.
      navigate(location.state?.from?.pathname || homeFor(signedIn.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <button
        className="theme-toggle-fixed"
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={isDark}
      >
        {isDark ? (
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8Z" />
          </svg>
        )}
      </button>

      <div className="login-wrap">
        <div className="brand-block">
          <div className="clock-logo">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3.2 2" />
            </svg>
          </div>
          <div className="brand-name">InOut Portal</div>
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-title">Welcome back</div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              value={form.username}
              onChange={update('username')}
              placeholder="Enter username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={update('password')}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
              {/* type="button" so pressing it never submits the form. */}
              <button
                className="password-reveal"
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.4 5.2A9.7 9.7 0 0 1 12 4.9c5 0 8.4 4 9.4 6a13 13 0 0 1-2.4 3.2" />
                    <path d="M6.2 6.6A13 13 0 0 0 2.6 11c1 2 4.4 6 9.4 6a9.9 9.9 0 0 0 4.3-1" />
                    <path d="m3 3 18 18" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.6 11S6 5 12 5s9.4 6 9.4 6-3.4 6-9.4 6-9.4-6-9.4-6Z" />
                    <circle cx="12" cy="11" r="2.6" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>

        <div className="login-footer">INOUT PORTAL</div>
      </div>
    </div>
  );
}
