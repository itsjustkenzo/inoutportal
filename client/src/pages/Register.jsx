import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../constants.js';

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', department: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password.length < MIN_PASSWORD_LENGTH) return setError(PASSWORD_RULE);

    setBusy(true);
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <div className="login-head">
        <span className="login-mark" aria-hidden="true">IN</span>
        <ThemeToggle className="login-theme-toggle" />
      </div>

      <h1>Create your account</h1>
      <p className="muted">The first account created becomes the portal admin.</p>

      <form onSubmit={handleSubmit} className="form">
        {error && <div className="alert alert-error">{error}</div>}

        <label>
          Full name
          <input value={form.name} onChange={update('name')} required />
        </label>

        <label>
          Username
          <input
            value={form.username}
            onChange={update('username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            pattern="[A-Za-z0-9._-]{3,32}"
            title="3–32 characters: letters, numbers, dots, dashes or underscores"
            required
          />
        </label>

        <label>
          Email
          <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </label>

        <label>
          Department
          <input value={form.department} onChange={update('department')} placeholder="Engineering" />
        </label>

        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="muted small">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
