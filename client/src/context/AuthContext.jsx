import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import api, { TOKEN_KEY } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return setLoading(false);

    api
      .get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const authenticate = useCallback(async (path, payload) => {
    const { data } = await api.post(path, payload);
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(
    (username, password) => authenticate('/auth/login', { username, password }),
    [authenticate]
  );
  const register = useCallback((payload) => authenticate('/auth/register', payload), [authenticate]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      login,
      register,
      logout,
      // Server managers outrank admins, so every admin view is theirs too.
      isAdmin: user?.role === 'admin' || user?.role === 'manager',
      isAudit: user?.role === 'audit',
      isManager: user?.role === 'manager',
    }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
