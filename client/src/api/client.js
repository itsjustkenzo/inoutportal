import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

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
