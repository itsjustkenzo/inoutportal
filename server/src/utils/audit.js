import AuditLog from '../models/AuditLog.js';
import { publish, AUDIENCE } from './events.js';

/** Readable scalar for the trail; dates go in as ISO so they sort and compare. */
function show(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Field-level diff between two plain snapshots. Only fields that actually moved
 * are returned, so a save that changed nothing writes no log line.
 */
export function diff(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const from = show(before?.[field]);
    const to = show(after?.[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Write one entry to the trail.
 *
 * Deliberately never throws: an audit failure must not roll back or 500 the
 * operation the user actually asked for. A failed write is logged to the
 * console so it is still visible in the server output.
 */
export async function record(req, entry) {
  try {
    const actor = req?.user;
    const saved = await AuditLog.create({
      actor: actor?._id ?? null,
      actorName: actor?.name ?? 'System',
      actorRole: actor?.role ?? 'system',
      ...entry,
    });

    // Every change already flows through here, so this is the single point
    // that tells connected clients something moved.
    publish(
      'change',
      {
        id: String(saved._id),
        category: saved.category,
        action: saved.action,
        actorName: saved.actorName,
        actorRole: saved.actorRole,
        // The id, not just the name: it lets a listener tell which record moved
        // — a new profile picture invalidates exactly that person's cached one.
        target: saved.target ? String(saved.target) : null,
        targetName: saved.targetName,
        targetRole: saved.targetRole,
        summary: saved.summary,
        at: saved.at,
      },
      { roles: AUDIENCE[saved.category] }
    );
  } catch (err) {
    console.error('[audit] could not record %s:', entry?.action, err.message);
  }
}

/** Human-readable field names for the summary line. */
export const FIELD_LABELS = {
  name: 'name',
  username: 'username',
  role: 'role',
  region: 'region',
  department: 'department',
  active: 'access',
  in: 'clock-in',
  out: 'clock-out',
  note: 'note',
  start: 'shift start',
  end: 'shift end',
  days: 'working days',
  'prefs.accent': 'theme colour',
  'prefs.dim': 'background dimming',
};

/** "changed region and role" — the one-line gist above the field detail. */
export function summarise(verb, changes) {
  if (!changes.length) return verb;
  const names = changes.map((c) => FIELD_LABELS[c.field] || c.field);
  const last = names.pop();
  return `${verb} ${names.length ? `${names.join(', ')} and ${last}` : last}`;
}
