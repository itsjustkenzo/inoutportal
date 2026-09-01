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
 * One person's shifts over a period, a row per shift.
 *
 * Not a row per day: someone who works 12:00-16:00 and again 19:00-22:00 has
 * two shifts, and collapsing them reads as one 12:00-22:00 stretch — a span of
 * ten hours next to a total of seven. Each clock-in and clock-out keeps its own
 * line, so the times and the hours beside them describe the same thing.
 *
 * Days are cut in the moderator's own zone, so a report about someone in Brazil
 * dates their shifts the way they do — and the way their own My Report does.
 * The period itself stays the one the reader picked, identical for everybody, so
 * these totals still reconcile against the summary table they were opened from.
 */
export async function fetchDailyReport(person, range) {
  const zone = zoneForRegion(person.region);

  // Remarks are keyed by the same YYYY-MM-DD the table writes them against, so
  // a note lands on the day the admin was looking at.
  const [{ data }, remarks] = await Promise.all([
    api.get('/entries/history', {
      params: {
        userId: person.userId,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        limit: 100,
      },
    }),
    api
      .get('/remarks', {
        params: {
          userId: person.userId,
          from: toDateInput(range.from, zone),
          to: toDateInput(range.to, zone),
        },
      })
      .then(({ data: d }) => new Map(d.remarks.map((r) => [r.date, r.text])))
      // A report is still worth having if the notes cannot be fetched.
      .catch(() => new Map()),
  ]);

  // The API returns newest first; a report reads better oldest first. Shifts
  // on the same day therefore sit next to each other, which is what lets the
  // day's remark be attached to the first of them.
  let previousDay = null;

  const rows = [...data.entries].reverse().map((e) => {
    const key = toDateInput(e.in, zone);
    const opensTheDay = key !== previousDay;
    previousDay = key;

    return {
      key,
      // Labelled off the shift's own instant, so the weekday is the one that
      // zone actually had — re-parsing "yyyy-mm-dd" would read it back locally.
      date: formatDate(e.in, zone),
      day: formatDay(e.in, zone),
      in: formatClock(e.in, zone),
      out: e.out ? formatClock(e.out, zone) : '—',
      // A shift still open has no duration yet; 0m would read as "worked none".
      hours: e.out ? formatDuration(e.minutes || 0) : '—',
      minutes: e.out ? e.minutes || 0 : 0,
      /*
       * A remark belongs to the day, not to a shift within it. Putting it on
       * the day's first row shows it once instead of repeating it against every
       * shift, which would read as several separate notes.
       */
      remark: opensTheDay ? remarks.get(key) || '' : '',
    };
  });

  return {
    rows,
    zone,
    // Distinct days, for the summary line — no longer the same as the row count.
    dayCount: new Set(rows.map((r) => r.key)).size,
    // Lets the outputs drop the column entirely when nothing was written.
    hasRemarks: rows.some((r) => r.remark),
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
  // No Sessions column: every row is one shift, so it would read 1 throughout.
  const rows = report.rows.map((r) => [r.date, r.day, r.in, r.out, r.hours, r.minutes, r.remark]);
  rows.push([]);
  rows.push(['Total', '', '', '', formatDuration(report.totalMinutes), report.totalMinutes, '']);

  const note = clockNote(person, report);
  if (note) rows.push(['Times shown in', note]);

  downloadCsv(
    `${person.username}-${slug(range.label)}.csv`,
    ['Date', 'Day', 'Clock in', 'Clock out', 'Hours', 'Minutes', 'Remarks'],
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

  const { rows, dayCount, totalMinutes } = report;
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
  td.remark { color: #334155; font-style: italic; max-width: 260px; }
  /* A day's later shifts read as belonging to the row above. */
  tr.same-day td { border-top: none; }
  tr.same-day td:first-child, tr.same-day td:nth-child(2) { color: #94a3b8; }
  .empty { padding: 30px; text-align: center; color: #64748b; }
  .note { margin-top: 14px; font-size: 11px; color: #64748b; }
  @page { margin: 14mm; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>${esc(person.name)}</h1>
<div class="meta">
  <b>@${esc(person.username)}</b> &nbsp;·&nbsp; ${esc(range.label)}
  &nbsp;·&nbsp; ${dayCount} day${dayCount === 1 ? '' : 's'} worked
  &nbsp;·&nbsp; ${rows.length} shift${rows.length === 1 ? '' : 's'}
  &nbsp;·&nbsp; total <b>${esc(formatDuration(totalMinutes))}</b>
  ${note ? `<br>Times shown in ${esc(note)}` : ''}
</div>
${rows.length === 0 ? '<div class="empty">No completed shifts in this period.</div>' : `
<table>
  <thead><tr>
    <th>Date</th><th>Day</th><th>Clock in</th><th>Clock out</th>
    <th class="num">Hours</th>
    ${report.hasRemarks ? '<th>Remarks</th>' : ''}
  </tr></thead>
  <tbody>
    ${rows.map((r, i) => `<tr${i > 0 && r.key === rows[i - 1].key ? ' class="same-day"' : ''}>
      <td>${esc(r.date)}</td><td>${esc(r.day)}</td><td>${esc(r.in)}</td><td>${esc(r.out)}</td>
      <td class="num">${esc(r.hours)}</td>
      ${report.hasRemarks ? `<td class="remark">${esc(r.remark)}</td>` : ''}
    </tr>`).join('')}
  </tbody>
  <tfoot><tr>
    <td colspan="4">Total</td><td class="num">${esc(formatDuration(totalMinutes))}</td>
    ${report.hasRemarks ? '<td></td>' : ''}
  </tr></tfoot>
</table>`}
${report.truncated ? '<div class="note">Only the most recent 100 records are included for this period.</div>' : ''}
</body></html>`);
  win.document.close();
  // Waits for layout, otherwise the dialog can open on a blank page.
  win.onload = () => { win.focus(); win.print(); };
  return null;
}
