/*
 * Every formatter here takes an optional IANA `timeZone`. Left off, it falls
 * back to the browser's own zone, which is what the admin-facing screens still
 * want. The moderator screens pass the zone of the account's region instead, so
 * someone in Brazil reads Brazil time even on a laptop set to Kuala Lumpur.
 */

/** Cached, because constructing an Intl formatter is the expensive part. */
const FORMATTERS = new Map();

function fmt(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = FORMATTERS.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    FORMATTERS.set(key, f);
  }
  return f;
}

/** `timeZone: undefined` tells Intl to use the browser's zone. */
const withZone = (options, timeZone) => (timeZone ? { ...options, timeZone } : options);

export function formatDateTime(value, timeZone) {
  if (!value) return '—';
  return fmt(
    undefined,
    withZone({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, timeZone)
  ).format(new Date(value));
}

export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function formatRelative(value) {
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

/** Minutes elapsed since `start`, for the live "you've been in for…" counter. */
export function minutesSince(start) {
  return Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000));
}

/** 24h clock time, e.g. "09:01" */
export function formatClock(value, timeZone) {
  if (!value) return '—';
  return fmt(
    'en-GB',
    withZone({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timeZone)
  ).format(new Date(value));
}

/** "Wednesday" */
export function formatDay(value, timeZone) {
  if (!value) return '—';
  return fmt('en-GB', withZone({ weekday: 'long' }, timeZone)).format(new Date(value));
}

/** "12 Aug 2026" */
export function formatDate(value, timeZone) {
  if (!value) return '—';
  return fmt(
    'en-GB',
    withZone({ day: '2-digit', month: 'short', year: 'numeric' }, timeZone)
  ).format(new Date(value));
}

/** hh:mm:ss, for the live session stopwatch. */
export function formatStopwatch(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/* ------------------------------------------------------------------ *
 * Calendar arithmetic in a named zone.
 *
 * "Today" is not a property of an instant, it is a property of an instant
 * *somewhere*. A shift that starts 22:00 in São Paulo belongs to that day in
 * Brazil and to the next one in Malaysia, so any day boundary the moderator
 * sees has to be computed in the moderator's own zone rather than the browser's.
 * ------------------------------------------------------------------ */

/** Wall-clock fields for `value` as read in `timeZone`. */
export function partsIn(value, timeZone) {
  const d = new Date(value);
  if (!timeZone) {
    return {
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(),
    };
  }
  const p = {};
  for (const { type, value: v } of fmt('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d)) {
    p[type] = v;
  }
  return {
    year: Number(p.year), month: Number(p.month) - 1, day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute),
  };
}

/** Milliseconds `timeZone` runs ahead of UTC at `instant`. */
function zoneOffsetMs(instant, timeZone) {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, 0);
  // formatToParts is second-resolution, so compare against whole minutes to
  // keep the arithmetic exact for every zone in use (all are whole minutes).
  return asUtc - Math.floor(instant.getTime() / 60000) * 60000;
}

/** The instant at which a given wall-clock reading occurs in `timeZone`. */
export function zonedTimeToUtc(year, month, day, hour, minute, second, ms, timeZone) {
  if (!timeZone) return new Date(year, month, day, hour, minute, second, ms);

  const wall = Date.UTC(year, month, day, hour, minute, second, ms);
  // Guess using the offset in force at that reading, then measure again at the
  // result: right at a DST change the first guess sits on the wrong side of it.
  const guess = wall - zoneOffsetMs(new Date(wall), timeZone);
  return new Date(wall - zoneOffsetMs(new Date(guess), timeZone));
}

/** Midnight opening the day that `value` falls on, in `timeZone`. */
export function startOfDayIn(value, timeZone) {
  const { year, month, day } = partsIn(value, timeZone);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, 0, timeZone);
}

/**
 * A whole calendar period in `timeZone`, ending one millisecond before the next
 * one opens — so no instant can fall into two periods or between them.
 */
function rangeIn(fromParts, toParts, timeZone) {
  const from = zonedTimeToUtc(...fromParts, 0, 0, 0, 0, timeZone);
  const next = zonedTimeToUtc(...toParts, 0, 0, 0, 0, timeZone);
  return { from, to: new Date(next.getTime() - 1) };
}

export const dayRangeIn = (y, m, d, timeZone) =>
  rangeIn([y, m, d], [y, m, d + 1], timeZone);

export const monthRangeIn = (y, m, timeZone) =>
  rangeIn([y, m, 1], [y, m + 1, 1], timeZone);

export const yearRangeIn = (y, timeZone) =>
  rangeIn([y, 0, 1], [y + 1, 0, 1], timeZone);

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(date, timeZone) {
  const { year, month, day } = partsIn(date, timeZone);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
