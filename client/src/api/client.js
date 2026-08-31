import axios from 'axios';

/**
 * Where the API lives.
 *
 * Left unset, requests go to /api on whatever origin served the page. That is
 * how this runs in development (Vite proxies /api to the API) and when the API
 * serves the built client itself, and it needs no configuration at all.
 *
 * Setting VITE_API_URL at build time points requests at an API on a different
 * origin, which is what a separately hosted frontend needs. Baked in at build
 * time, not read at runtime — that is how Vite env vars work — so changing it
 * means rebuilding.
 */
export const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

const api = axios.create({ baseURL: API_BASE });

export const TOKEN_KEY = 'inout.token';

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // A rejected token means the session is over — drop it and bounce to login.
    if (err.response?.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function errorMessage(err, fallback = 'Something went wrong') {
  return err?.response?.data?.message || err?.message || fallback;
}

export default api;
