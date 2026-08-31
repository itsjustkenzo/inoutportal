import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import { idbGet, idbDelete } from '../utils/idb.js';
import { useAuth } from './AuthContext.jsx';

const PrefsContext = createContext(null);

/*
 * Every preference is namespaced by account id, so two people sharing a browser
 * keep separate wallpapers, avatars and accents. Still per-device — nothing here
 * is synced to the server.
 */
const mediaKey = (kind, uid) => `${kind}:${uid}`;

export const DEFAULT_DIM = 45;

const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (from, to, t) => from.map((v, i) => Math.round(lerp(v, to[i], t)));
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;

/**
 * One 0–100 "dimming" value drives the veil in both themes. Raising it darkens
 * the tint *and* raises its alpha, so the wallpaper gets monotonically dimmer —
 * turning up alpha alone on a pale tint would brighten the page instead.
 */
function veilsFor(dim) {
  const t = Math.min(100, Math.max(0, dim)) / 100;
  return {
    light: rgba(mixRgb([236, 244, 253], [96, 118, 146], t), lerp(0.22, 0.86, t)),
    dark: rgba(mixRgb([20, 26, 34], [4, 6, 9], t), lerp(0.32, 0.93, t)),
  };
}
// Keys from earlier builds: data URLs in localStorage, then un-namespaced
// IndexedDB entries. Both are folded into the signed-in account on first load.
const LEGACY_DATAURL = { avatar: 'inout.avatar', wallpaper: 'inout.wallpaper' };

export const ACCENTS = [
  { id: 'white', label: 'White — Default', swatch: '#ffffff' },
  { id: 'red', label: 'Red', swatch: '#ef5350' },
  { id: 'yellow', label: 'Yellow', swatch: '#f4c542' },
  { id: 'pink', label: 'Pink', swatch: '#ec6fa9' },
  { id: 'green', label: 'Green', swatch: '#35b77a' },
  { id: 'blue', label: 'Blue', swatch: '#2e8cee' },
  { id: 'purple', label: 'Purple', swatch: '#8b6be8' },
  { id: 'cyan', label: 'Cyan', swatch: '#20bfd5' },
];

const ACCENT_IDS = ACCENTS.map((a) => a.id);

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Media used to live only in this browser. On first sign-in after the move to
 * server storage, push anything found here up to the account — then clear it,
 * so the server stays the single source of truth.
 */
async function uploadLegacy(kind, uid) {
  const candidates = [mediaKey(kind, uid), kind];
  let blob = null;
  let foundKey = null;

  for (const key of candidates) {
    try {
      const hit = await idbGet(key);
      if (hit) {
        blob = hit;
        foundKey = key;
        break;
      }
    } catch {
      return; // IndexedDB unavailable; nothing to migrate
    }
  }

  if (!blob) {
    // Older still: a base64 data URL in localStorage.
    try {
      const dataUrl = localStorage.getItem(LEGACY_DATAURL[kind]);
      if (!dataUrl) return;
      blob = await dataUrlToBlob(dataUrl);
    } catch {
      return;
    }
  }

  try {
    // Only adopt it if the account has nothing yet, so a real upload is never
    // overwritten by a stale local copy.
    await api.get(`/users/me/media/${kind}`, { responseType: 'blob' });
    return; // already set on the server
  } catch {
    /* 404 — safe to adopt */
  }

  try {
    await api.put(`/users/me/media/${kind}`, blob, {
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
    });
    if (foundKey) await idbDelete(foundKey);
    localStorage.removeItem(LEGACY_DATAURL[kind]);
  } catch {
    /* leave the local copy alone if the upload fails */
  }
}

export function PrefsProvider({ children }) {
  const { user, setUser } = useAuth();
  const uid = user?.id || null;

  const [avatar, setAvatarUrl] = useState(null);
  const [wallpaper, setWallpaperUrl] = useState(null);
  const [accent, setAccentState] = useState('white');
  const [dim, setDimState] = useState(DEFAULT_DIM);

  // Object URLs must be revoked by hand when replaced.
  const urls = useRef({ avatar: null, wallpaper: null });

  const swapUrl = useCallback((key, blob, setUrl) => {
    if (urls.current[key]) URL.revokeObjectURL(urls.current[key]);
    const next = blob ? URL.createObjectURL(blob) : null;
    urls.current[key] = next;
    setUrl(next);
  }, []);

  /** Reads one image back from the server; 404 simply means "not set". */
  const fetchMedia = useCallback(async (kind) => {
    try {
      const { data } = await api.get(`/users/me/media/${kind}`, { responseType: 'blob' });
      return data && data.size ? data : null;
    } catch {
      return null;
    }
  }, []);

  // Lets the effects below read the current account without listing `user` as a
  // dependency — saving a preference replaces that object, and re-running on it
  // is what used to reload the media.
  const userRef = useRef(user);
  userRef.current = user;

  /*
   * Media reloads when the signed-in account changes, so switching users swaps
   * the whole look rather than carrying the previous person's over.
   *
   * Keyed on the account id alone, deliberately. Depending on the whole `user`
   * object meant every saved preference re-ran this — and it blanks the
   * wallpaper before re-fetching it, so dragging the dimming slider made the
   * background disappear and fade back in on every step.
   */
  useEffect(() => {
    let cancelled = false;

    // Clear first: never show the previous account's media while loading.
    swapUrl('avatar', null, setAvatarUrl);
    swapUrl('wallpaper', null, setWallpaperUrl);

    if (!uid) return undefined;

    (async () => {
      // Hand anything left in this browser to the account, once.
      await Promise.all([uploadLegacy('avatar', uid), uploadLegacy('wallpaper', uid)]);

      const [a, w] = await Promise.all([fetchMedia('avatar'), fetchMedia('wallpaper')]);
      if (cancelled) return;
      swapUrl('avatar', a, setAvatarUrl);
      swapUrl('wallpaper', w, setWallpaperUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, swapUrl, fetchMedia]);

  /*
   * Accent and dimming ride along on the user record, and are seeded per
   * account — except for audit, which is pinned to green. That role has no
   * theme picker, so a stored value could only have come from before the
   * account became audit, and it would leave the finance report looking like a
   * different product.
   *
   * Seeding only on a change of account keeps local state authoritative while
   * someone is dragging the slider: the save echoes the value back, and
   * re-applying it mid-drag would fight whatever they had moved on to.
   */
  useEffect(() => {
    const current = userRef.current;

    if (!uid) {
      setAccentState('white');
      setDimState(DEFAULT_DIM);
      return;
    }

    setAccentState(
      current?.role === 'audit'
        ? 'green'
        : ACCENT_IDS.includes(current?.prefs?.accent) ? current.prefs.accent : 'white'
    );
    setDimState(
      Number.isFinite(current?.prefs?.dim)
        ? Math.min(100, Math.max(0, current.prefs.dim))
        : DEFAULT_DIM
    );
  }, [uid]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  // CSS picks light or dark itself, so the veil follows the theme without JS.
  useEffect(() => {
    const { light, dark } = veilsFor(dim);
    const root = document.documentElement;
    root.style.setProperty('--veil-light', light);
    root.style.setProperty('--veil-dark', dark);
  }, [dim]);

  // Exposed as a custom property so CSS decides where it is painted — the
  // content column rather than the whole viewport, so the sidebar never crops it.
  useEffect(() => {
    const root = document.documentElement;
    if (wallpaper) root.style.setProperty('--wallpaper', `url("${wallpaper}")`);
    else root.style.removeProperty('--wallpaper');

    document.body.classList.toggle('has-wallpaper', Boolean(wallpaper));
    // Clear the body background written by earlier builds.
    document.body.style.backgroundImage = '';
  }, [wallpaper]);

  /** Upload (or clear) an image on the server, then show it locally. */
  const store = useCallback(
    async (kind, blob, setUrl) => {
      if (!uid) return;

      if (blob) {
        await api.put(`/users/me/media/${kind}`, blob, {
          headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        });
      } else {
        await api.delete(`/users/me/media/${kind}`);
      }
      swapUrl(kind, blob, setUrl);
    },
    [swapUrl, uid]
  );

  const setAvatar = useCallback((blob) => store('avatar', blob, setAvatarUrl), [store]);
  const setWallpaper = useCallback((blob) => store('wallpaper', blob, setWallpaperUrl), [store]);

  /** Optimistic: apply immediately, persist to the account in the background. */
  const savePrefs = useCallback(
    (patch) => {
      if (!uid) return;
      api.patch('/users/me', { prefs: patch }).then(
        ({ data }) => setUser(data.user),
        () => {
          /* stays applied for this session even if the write fails */
        }
      );
    },
    [uid, setUser]
  );

  const setAccent = useCallback(
    (next) => {
      setAccentState(next);
      savePrefs({ accent: next });
    },
    [savePrefs]
  );

  /*
   * The slider reports every step of a drag, so the new value is applied at once
   * but only written once the drag settles. Saving on each step sent a request
   * per pixel of travel, and the account is only worth one.
   */
  const dimSave = useRef(null);

  const setDim = useCallback(
    (next) => {
      const clamped = Math.min(100, Math.max(0, Math.round(Number(next) || 0)));
      setDimState(clamped);

      clearTimeout(dimSave.current);
      dimSave.current = setTimeout(() => savePrefs({ dim: clamped }), 350);
    },
    [savePrefs]
  );

  // A drag still in flight when the page changes should not fire afterwards.
  useEffect(() => () => clearTimeout(dimSave.current), []);

  const value = useMemo(
    () => ({ avatar, setAvatar, wallpaper, setWallpaper, accent, setAccent, dim, setDim }),
    [avatar, setAvatar, wallpaper, setWallpaper, accent, setAccent, dim, setDim]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider');
  return ctx;
}
