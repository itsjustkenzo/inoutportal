import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useLiveEvent } from '../context/LiveContext.jsx';

/**
 * Someone else's profile picture, for the admin and payroll screens.
 *
 * Pictures live behind the API rather than at a public URL, so each one is
 * fetched with the caller's token and handed to the page as an object URL.
 * Results are cached per account for the life of the tab — a table of ten rows
 * paging back and forth would otherwise re-fetch the same faces continuously —
 * and a "no picture" answer is cached just as firmly as a picture, so accounts
 * without one are asked about exactly once.
 */

/** userId -> object URL, or null for "asked, and there is none". */
const cache = new Map();
/** userId -> in-flight request, so ten rows for one person make one call. */
const inflight = new Map();

const initials = (name) =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function load(userId) {
  if (cache.has(userId)) return Promise.resolve(cache.get(userId));
  if (inflight.has(userId)) return inflight.get(userId);

  const request = api
    .get(`/users/${userId}/media/avatar`, { responseType: 'blob' })
    .then(({ data }) => (data && data.size ? URL.createObjectURL(data) : null))
    // 404 is the ordinary answer for an account that has not set one.
    .catch(() => null)
    .then((url) => {
      cache.set(userId, url);
      inflight.delete(userId);
      return url;
    });

  inflight.set(userId, request);
  return request;
}

/** Drops a cached picture so the next render fetches the new one. */
function forget(userId) {
  const existing = cache.get(userId);
  if (existing) URL.revokeObjectURL(existing);
  cache.delete(userId);
}

export default function UserAvatar({ userId, name, className = 'mod-avatar' }) {
  // Seeded from the cache so a picture already loaded paints on the first frame
  // instead of flashing initials on every page change.
  const [url, setUrl] = useState(() => cache.get(userId) ?? null);

  useEffect(() => {
    if (!userId) return undefined;

    let alive = true;
    setUrl(cache.get(userId) ?? null);
    load(userId).then((next) => {
      if (alive) setUrl(next);
    });

    return () => {
      alive = false;
    };
  }, [userId]);

  // Someone changing their picture is an account event, so the console shows the
  // new one straight away rather than at the next full reload.
  useLiveEvent((event) => {
    if (!userId || !String(event.action || '').startsWith('media.avatar')) return;
    if (String(event.target) !== String(userId)) return;
    forget(userId);
    load(userId).then(setUrl);
  }, ['account']);

  return (
    <div className={`${className}${url ? ' has-photo' : ''}`} title={name || undefined}>
      {url ? <img src={url} alt="" /> : initials(name)}
    </div>
  );
}
