import api from '../api/client.js';
import { formatClock, formatDate, formatDay, formatDuration, toDateInput } from './time.js';
import { zoneForRegion } from './zone.js';

/**
 * Per-person, day-by-day attendance reports, shared by the Moderator Report and
 * the Finance contribution report so the two can never disagree about someone's
 * hours. Both outputs are built from one set of rows for the same reason.
 */

/** Builds a CSV and hands it to the browser as a download. */
export function downloadCsv(filename, header, rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  // BOM so Excel reads UTF-8 names correctly.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * One person's shifts over a period, collapsed to a row per day.
 *
 * Someone can clock in and out several times in a day, so a day's total is the
 * sum of its sessions rather than the first-in to last-out span — those differ
 * whenever there is a break.
 *
 * Days are cut in the moderator's own zone, so a report about someone in Brazil
 * dates their shifts the way they do — and the way their own My Report does.
 * The period itself stays the one the reader picked, identical for everybody, so
 * these totals still reconcile against the summary table they were opened from.
 */
export async function fetchDailyReport(person, range) {
  const zone = zoneForRegion(person.region);
  const { data } = await api.get('/entries/history', {
    params: {
      userId: person.userId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      limit: 100,
    },
  });

  const byDay = new Map();
  // The API returns newest first; a report reads better oldest first.
  for (const e of [...data.entries].reverse()) {
    const key = toDateInput(e.in, zone);
    if (!byDay.has(key)) byDay.set(key, { date: key, at: e.in, sessions: [], minutes: 0 });
    const day = byDay.get(key);
    day.sessions.push(e);
    day.minutes += e.minutes || 0;
  }

  const days = [...byDay.values()].map((d) => {
    const last = d.sessions[d.sessions.length - 1];
    return {
      // Labelled off a real instant from the day, so the weekday is the one that
      // zone actually had — re-parsing "yyyy-mm-dd" would read it back locally.
      date: formatDate(d.at, zone),
      day: formatDay(d.at, zone),
      in: formatClock(d.sessions[0].in, zone),
      out: last.out ? formatClock(last.out, zone) : '—',
      sessions: d.sessions.length,
      hours: formatDuration(d.minutes),
      minutes: d.minutes,
    };
  });

  return {
    days,
    zone,
    totalMinutes: data.totalMinutes,
    // A month sits far below the cap, but a long period could reach it.
    truncated: data.total > data.entries.length,
  };
}

const slug = (s) => String(s).replace(/\s+/g, '-').toLowerCase();

/** Which clock the times are on — omitted when there is no region to name. */
const clockNote = (person, report) =>
  person.region && person.region !== 'Global' ? `${person.region} time (${report.zone})` : '';

export function downloadDailyCsv(person, range, report) {
  const rows = report.days.map((d) => [d.date, d.day, d.in, d.out, d.sessions, d.hours, d.minutes]);
  rows.push([]);
  rows.push(['Total', '', '', '', '', formatDuration(report.totalMinutes), report.totalMinutes]);

  const note = clockNote(person, report);
  if (note) rows.push(['Times shown in', note]);

  downloadCsv(
    `${person.username}-${slug(range.label)}.csv`,
    ['Date', 'Day', 'First in', 'Last out', 'Sessions', 'Hours', 'Minutes'],
    rows
  );
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Opens the report in a window of its own and calls print, where the browser
 * offers "Save as PDF". Printing the page itself would carry the whole console
 * into the file, and a real PDF writer would mean adding a rendering library.
 *
 * Returns an error string when the pop-up was blocked, otherwise null.
 */
export function openDailyPdf(person, range, report) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return 'Your browser blocked the report window. Allow pop-ups for this site and try again.';

  const { days, totalMinutes } = report;
  const note = clockNote(person, report);

  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(person.name)} — ${esc(range.label)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 34px 38px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #12283f; }
  h1 { margin: 0 0 4px; font-size: 21px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 22px; }
  .meta b { color: #12283f; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; padding: 9px 10px; border-bottom: 2px solid #12283f; font-size: 10.5px;
       letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
  td { padding: 8px 10px; border-bottom: 1px solid #e6edf5; }
  td.num, th.num { text-align: right; }
  tfoot td { border-top: 2px solid #12283f; border-bottom: none; font-weight: 700; padding-top: 11px; }
  .empty { padding: 30px; text-align: center; color: #64748b; }
  .note { margin-top: 14px; font-size: 11px; color: #64748b; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${esc(person.name)}</h1>
<div class="meta">
  <b>@${esc(person.username)}</b> &nbsp;·&nbsp; ${esc(range.label)}
  &nbsp;·&nbsp; ${days.length} day${days.length === 1 ? '' : 's'} worked
  &nbsp;·&nbsp; total <b>${esc(formatDuration(totalMinutes))}</b>
  ${note ? `<br>Times shown in ${esc(note)}` : ''}
</div>
${days.length === 0 ? '<div class="empty">No completed shifts in this period.</div>' : `
<table>
  <thead><tr>
    <th>Date</th><th>Day</th><th>First in</th><th>Last out</th>
    <th class="num">Sessions</th><th class="num">Hours</th>
  </tr></thead>
  <tbody>
    ${days.map((d) => `<tr>
      <td>${esc(d.date)}</td><td>${esc(d.day)}</td><td>${esc(d.in)}</td><td>${esc(d.out)}</td>
      <td class="num">${esc(d.sessions)}</td><td class="num">${esc(d.hours)}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot><tr>
    <td colspan="5">Total</td><td class="num">${esc(formatDuration(totalMinutes))}</td>
  </tr></tfoot>
</table>`}
${report.truncated ? '<div class="note">Only the most recent 100 records are included for this period.</div>' : ''}
</body></html>`);
  win.document.close();
  // Waits for layout, otherwise the dialog can open on a blank page.
  win.onload = () => { win.focus(); win.print(); };
  return null;
}
