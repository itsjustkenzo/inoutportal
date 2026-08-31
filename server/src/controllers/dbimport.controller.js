import { randomUUID, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import User, { MIN_PASSWORD_LENGTH } from '../models/User.js';
import Entry from '../models/Entry.js';
import Schedule from '../models/Schedule.js';
import { asyncHandler } from '../middleware/error.js';
import { record } from '../utils/audit.js';
import { parseSqlDump } from '../utils/importers/sql.js';
import { parseJsonExport } from '../utils/importers/json.js';

/** Uploads live here between preview and commit so the file is sent once. */
const staged = new Map();
const STAGE_TTL_MS = 15 * 60 * 1000;
const SAMPLE_ROWS = 5;
const MAX_ERRORS = 50;

/**
 * Known targets go through their Mongoose model, so imported rows face the same
 * validation and hooks as anything the app writes itself. Anything else is
 * written straight to a collection.
 */
const MODELS = { users: User, entries: Entry, schedules: Schedule };

/**
 * Collections the console offers as targets: the key rows match on, the fields
 * a source column can be mapped to, and which of those are references to an
 * account (resolved by lookup rather than taken literally from the file).
 */
export const TARGETS = [
  {
    id: 'users',
    label: 'Accounts',
    keys: ['username', 'email', '_id'],
    fields: ['name', 'username', 'email', 'password', 'role', 'region', 'department', 'active'],
    refs: [],
  },
  {
    id: 'entries',
    label: 'Attendance',
    keys: ['_id'],
    /*
     * `date` and `outDate` are not stored — they are helper columns. A time
     * clock commonly splits a shift across a date column and a time column,
     * and the clock-out can land on the following day, so both are mapped and
     * then folded into the two timestamps this app actually keeps.
     */
    fields: ['user', 'in', 'out', 'date', 'outDate', 'note'],
    refs: ['user'],
  },
  {
    id: 'schedules',
    label: 'Schedules',
    keys: ['user', '_id'],
    fields: ['user', 'start', 'end', 'days'],
    refs: ['user'],
  },
];

/**
 * Role names other systems use. A source saying `staff` means a moderator here,
 * and rejecting the row over vocabulary would be needless friction.
 */
const ROLE_ALIASES = {
  staff: 'employee', employee: 'employee', moderator: 'employee', mod: 'employee',
  user: 'employee', member: 'employee', worker: 'employee', agent: 'employee', '': 'employee',
  admin: 'admin', administrator: 'admin', supervisor: 'admin', lead: 'admin',
  audit: 'audit', auditor: 'audit', finance: 'audit', accountant: 'audit', payroll: 'audit',
  manager: 'manager', owner: 'manager', superadmin: 'manager', root: 'manager',
};

/** Column names commonly meaning the same thing, used to pre-fill the mapping. */
const FIELD_ALIASES = {
  name: ['name', 'full_name', 'fullname', 'employee_name', 'staff_name', 'display_name', 'displayname'],
  username: ['username', 'user_name', 'login', 'staff_id', 'employee_code', 'handle'],
  email: ['email', 'email_address', 'mail', 'e_mail'],
  password: ['password', 'passwd', 'pass', 'password_hash'],
  role: ['role', 'user_role', 'position', 'job_title', 'access_level', 'type'],
  region: ['region', 'location', 'country', 'area', 'site'],
  department: ['department', 'dept', 'team', 'division', 'unit'],
  active: ['active', 'is_active', 'enabled', 'status', 'access', 'account_status'],
  // `username`/`login` belong here too: in an attendance table that column is
  // the account reference. The users target has no `user` field, so this can
  // never steal a column that should map to `username` there.
  user: ['user', 'user_id', 'employee_id', 'staff_id', 'emp_id', 'member_id', 'username', 'login', 'user_name'],
  in: ['in', 'clock_in', 'clockin', 'time_in', 'start_time', 'check_in', 'punch_in'],
  out: ['out', 'clock_out', 'clockout', 'time_out', 'end_time', 'check_out', 'punch_out'],
  date: ['date', 'work_date', 'shift_date', 'day', 'attendance_date', 'clock_in_date'],
  outDate: ['clock_out_date', 'out_date', 'end_date', 'checkout_date'],
  note: ['note', 'notes', 'remark', 'remarks', 'comment'],
  minutes: ['minutes', 'duration', 'total_minutes', 'mins'],
  start: ['start', 'shift_start', 'start_time'],
  end: ['end', 'shift_end', 'end_time'],
  days: ['days', 'working_days', 'work_days'],
};

/**
 * Best-guess mapping of source columns onto target fields.
 *
 * Two passes, because an alias list can never cover every spelling. Exact
 * matches win first; leftovers then match on the column's last word, so
 * `emp_name` finds `name` without `name` being claimed by `username` — which
 * pass one has already taken.
 *
 * A field is claimed once: two columns never both map onto `name`.
 */
function guessMapping(columns, target) {
  const spec = TARGETS.find((t) => t.id === target);
  if (!spec) return {};

  const out = Object.fromEntries(columns.map((c) => [c, '']));
  const taken = new Set();
  const norm = (c) => String(c).toLowerCase().replace(/[\s-]/g, '_');

  for (const column of columns) {
    const key = norm(column);
    const field = spec.fields.find((f) => !taken.has(f) && (FIELD_ALIASES[f] || [f]).includes(key));
    if (field) {
      out[column] = field;
      taken.add(field);
    }
  }

  for (const column of columns) {
    if (out[column]) continue;

    const key = norm(column);
    // A table's own primary key maps to nothing here, and a bare `id` suffix is
    // too weak a signal — `id` would otherwise be read as `employee_id`.
    if (key === 'id' || key === '_id') continue;

    const last = key.split('_').pop();
    if (last === 'id') continue;

    const field = spec.fields.find(
      (f) => !taken.has(f) && (f === last || (FIELD_ALIASES[f] || []).some((a) => a.split('_').pop() === last))
    );
    if (field) {
      out[column] = field;
      taken.add(field);
    }
  }

  return out;
}

setInterval(() => {
  const cutoff = Date.now() - STAGE_TTL_MS;
  for (const [id, s] of staged) if (s.at < cutoff) staged.delete(id);
}, 60000).unref();

/** Best guess at which collection a source belongs in, by name. */
function suggestTarget(name) {
  const n = name.toLowerCase();
  if (/(user|employee|staff|account|moderator|member)/.test(n)) return 'users';
  if (/(entry|entries|attendance|punch|timesheet|clock|shift_log)/.test(n)) return 'entries';
  if (/(schedule|roster|shift)/.test(n)) return 'schedules';
  return '';
}

/** POST — parse an uploaded file and describe what is in it. Writes nothing. */
export const previewImport = asyncHandler(async (req, res) => {
  const filename = String(req.query.filename || 'import');
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');

  if (!text.trim()) return res.status(400).json({ message: 'The uploaded file is empty' });

  const isSql = /\.sql$/i.test(filename) || /^\s*(--|\/\*|drop\s+table|create\s+table|insert\s+into)/i.test(text);

  let sources;
  try {
    sources = isSql ? parseSqlDump(text) : parseJsonExport(text, filename);
  } catch (err) {
    return res.status(400).json({ message: `Could not read that file: ${err.message}` });
  }

  if (!sources.length) {
    return res.status(400).json({
      message: isSql
        ? 'No INSERT statements found — the dump may contain only schema, no data'
        : 'No documents found in that file',
    });
  }

  const id = randomUUID();
  staged.set(id, { at: Date.now(), filename, format: isSql ? 'sql' : 'json', sources, by: String(req.user._id) });

  res.json({
    id,
    filename,
    format: isSql ? 'mysql' : 'json',
    expiresInMinutes: STAGE_TTL_MS / 60000,
    sources: sources.map((s) => {
      const suggestedTarget = suggestTarget(s.name);
      return {
        name: s.name,
        rows: s.rows.length,
        columns: s.columns,
        suggestedTarget,
        /*
         * A mapping for every target, not just the suggested one, so switching
         * the target in the console is a lookup rather than a second guess
         * implemented client-side that could disagree with this one.
         */
        mappings: Object.fromEntries(TARGETS.map((t) => [t.id, guessMapping(s.columns, t.id)])),
        sample: s.rows.slice(0, SAMPLE_ROWS),
      };
    }),
    targets: TARGETS,
  });
});

/** Strips keys that must never come from a file. */
function clean(row) {
  const out = { ...row };
  delete out.__v;
  return out;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const generatePassword = (length = 12) =>
  Array.from(randomBytes(length)).map((b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');

/**
 * A foreign staff table rarely carries the fields this app requires. Rather
 * than fail every row on validation, fill in what can be derived — the same way
 * the Add Account form does — and leave the rest to the model.
 *
 * `name` and `username` are mapped from the usual column spellings so a plain
 * `employees` dump lands without hand-editing the file first.
 */
function prepareUser(row, { defaultPassword, ignorePasswords }) {
  const out = { ...row };

  const pick = (...keys) => keys.map((k) => out[k]).find((v) => typeof v === 'string' && v.trim());

  if (!out.name) {
    const named = pick('full_name', 'fullname', 'displayName', 'display_name', 'employee_name');
    const first = pick('first_name', 'firstname', 'given_name');
    const last = pick('last_name', 'lastname', 'surname', 'family_name');
    if (named) out.name = named;
    else if (first || last) out.name = `${first || ''} ${last || ''}`.trim();
  }

  if (!out.username) {
    const alt = pick('user_name', 'login', 'staff_id', 'employee_code');
    if (alt) out.username = alt;
  }
  if (typeof out.username === 'string') {
    out.username = out.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  }

  // Derived exactly as createUser does, so imported and hand-made accounts match.
  if (!out.email && out.username) out.email = `${out.username}@inout.local`;

  /*
   * Passwords in an export are either plaintext (which should not be trusted
   * into a new system) or hashed by another algorithm (which would be
   * double-hashed here and never match). Either way the safe default is to
   * discard them and issue a fresh one.
   */
  if (ignorePasswords) delete out.password;
  if (!out.password) out.password = defaultPassword || generatePassword();

  // Another system's vocabulary for roles, translated rather than rejected.
  if (out.role !== undefined) {
    const key = String(out.role).trim().toLowerCase();
    out.role = ROLE_ALIASES[key] || 'employee';
  }

  if (typeof out.active === 'number') out.active = out.active !== 0;
  // "granted"/"revoked" and similar wordings, not just booleans.
  if (typeof out.active === 'string') {
    out.active = !/^(0|no|false|inactive|disabled|revoked|suspended|banned|denied)$/i.test(out.active.trim());
  }

  return out;
}

const TIME_ONLY = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Attendance rows arrive with times as strings, and often with the date in a
 * column of its own. This folds them into the two timestamps the app stores.
 *
 * A shift that runs past midnight is why `outDate` matters: without it a
 * 20:00 → 04:00 shift would look like an eight-hour journey backwards.
 */
function prepareEntry(row) {
  const out = { ...row };

  const dayOf = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 10) : null;
  };

  const inDay = dayOf(out.date);
  // Falls back to the clock-in date when the source has no separate out date.
  const outDay = dayOf(out.outDate) || inDay;

  const build = (value, day) => {
    if (value instanceof Date) return value;
    if (typeof value !== 'string' || !value.trim()) return null;

    const text = value.trim();
    if (TIME_ONLY.test(text) && day) {
      const time = text.length === 5 ? `${text}:00` : text;
      const d = new Date(`${day}T${time}`);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = new Date(text.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  out.in = build(out.in, inDay);
  out.out = build(out.out, outDay);

  // A clock-out before the clock-in means the shift crossed midnight and the
  // source did not say so; the only sensible reading is the next day.
  if (out.in && out.out && out.out < out.in && !dayOf(row.outDate)) {
    out.out = new Date(out.out.getTime() + 24 * 60 * 60 * 1000);
  }

  delete out.date;
  delete out.outDate;
  // Recomputed by the model's save hook, so a stale value is not carried over.
  delete out.minutes;
  return out;
}

function prepareSchedule(row) {
  const out = { ...row };
  // "09:00" or "0900" -> minutes from midnight, which is how shifts are stored.
  const toMinutes = (v) => {
    if (typeof v === 'number') return v;
    const digits = String(v).replace(/\D/g, '');
    if (digits.length !== 4) return v;
    return Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
  };
  if (out.start !== undefined) out.start = toMinutes(out.start);
  if (out.end !== undefined) out.end = toMinutes(out.end);
  if (typeof out.days === 'string') {
    out.days = out.days.split(/[,;|\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  return out;
}

const PREPARE = { users: prepareUser, entries: prepareEntry, schedules: prepareSchedule };

/** Maps a source row onto target fields; unmapped columns are dropped. */
function applyMapping(row, mapping) {
  if (!mapping || !Object.keys(mapping).length) return { ...row };
  const out = {};
  for (const [column, field] of Object.entries(mapping)) {
    if (!field) continue; // explicitly skipped
    if (row[column] === undefined) continue;
    out[field] = row[column];
  }
  return out;
}

/**
 * Turns a foreign key into the account it refers to.
 *
 * An attendance table stores something like `employee_id = 4`, which means
 * nothing here. `link` says which account field that value should be matched
 * against, so the row can carry a real reference without the source file being
 * edited. Results are cached: a dump repeats the same handful of ids.
 */
function makeLinker(link) {
  if (!link?.field || !link?.lookup) return null;
  const cache = new Map();

  return async (row) => {
    const raw = row[link.field];
    if (raw === undefined || raw === null || raw === '') return { ok: false, reason: `no value for ${link.field}` };

    const key = String(raw);
    if (cache.has(key)) {
      const hit = cache.get(key);
      return hit ? { ok: true, id: hit } : { ok: false, reason: `no account with ${link.lookup} "${key}"` };
    }

    const value = link.lookup === 'username' ? key.trim().toLowerCase() : key;
    const found = await User.findOne({ [link.lookup]: value }).select('_id').lean();

    cache.set(key, found?._id ?? null);
    return found
      ? { ok: true, id: found._id }
      : { ok: false, reason: `no account with ${link.lookup} "${key}"` };
  };
}

async function importRows({ rows, target, mode, matchKey, actorName, defaultPassword, mapping, options = {}, link }) {
  const Model = MODELS[target];
  const prepare = PREPARE[target];
  const linker = makeLinker(link);
  const collection = Model ? null : mongoose.connection.collection(target);

  const report = { target, mode, total: rows.length, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  if (mode === 'replace') {
    report.deleted = Model
      ? (await Model.deleteMany({})).deletedCount
      : (await collection.deleteMany({})).deletedCount;
  }

  for (const [index, raw] of rows.entries()) {
    const line = index + 1;
    const mapped = applyMapping(clean(raw), mapping);
    const row = prepare
      ? prepare(mapped, { defaultPassword, ignorePasswords: options.ignorePasswords })
      : mapped;

    try {
      if (linker) {
        const resolved = await linker(row);
        if (!resolved.ok) {
          report.failed += 1;
          if (report.errors.length < MAX_ERRORS) {
            report.errors.push({ row: line, message: `Could not link to an account — ${resolved.reason}` });
          }
          continue;
        }
        row[link.field] = resolved.id;
      }

      const key = matchKey && row[matchKey] !== undefined ? { [matchKey]: row[matchKey] } : null;

      if (mode === 'upsert' && key) {
        const existing = Model ? await Model.findOne(key) : await collection.findOne(key);
        if (existing) {
          if (Model) {
            existing.set(row);
            await existing.save();
          } else {
            await collection.updateOne(key, { $set: row });
          }
          report.updated += 1;
          continue;
        }
      } else if (mode === 'insert' && key) {
        const exists = Model ? await Model.exists(key) : await collection.findOne(key);
        if (exists) {
          report.skipped += 1;
          continue;
        }
      }

      if (Model) await Model.create(row);
      else await collection.insertOne(row);
      report.inserted += 1;
    } catch (err) {
      report.failed += 1;
      // A duplicate key is a skip, not a failure worth shouting about.
      if (err?.code === 11000) {
        report.failed -= 1;
        report.skipped += 1;
        continue;
      }
      if (report.errors.length < MAX_ERRORS) {
        report.errors.push({ row: line, message: err.message.replace(/^.*validation failed: /i, '') });
      }
    }
  }

  report.errorsTruncated = report.failed > report.errors.length;
  report.actorName = actorName;
  return report;
}

/** POST — run the import the operator confirmed. */
export const commitImport = asyncHandler(async (req, res) => {
  const { id, jobs } = req.body;
  const stage = staged.get(id);

  if (!stage) {
    return res.status(410).json({ message: 'That upload has expired — please choose the file again' });
  }
  if (!Array.isArray(jobs) || !jobs.length) {
    return res.status(400).json({ message: 'Nothing selected to import' });
  }

  const reports = [];
  for (const job of jobs) {
    const source = stage.sources.find((s) => s.name === job.source);
    if (!source) continue;
    if (!job.target) continue;
    if (!MODELS[job.target] && !/^[a-z][\w.-]{0,60}$/i.test(job.target)) {
      return res.status(400).json({ message: `Invalid target collection: ${job.target}` });
    }

    reports.push(
      await importRows({
        rows: source.rows,
        target: job.target,
        mode: ['insert', 'upsert', 'replace'].includes(job.mode) ? job.mode : 'insert',
        matchKey: job.matchKey || null,
        actorName: req.user.name,
        defaultPassword:
          typeof job.defaultPassword === 'string' && job.defaultPassword.length >= MIN_PASSWORD_LENGTH
            ? job.defaultPassword
            : null,
        mapping: job.mapping && typeof job.mapping === 'object' ? job.mapping : null,
        // Discarding foreign passwords is the default; the form has to opt out.
        options: { ignorePasswords: job.ignorePasswords !== false },
        link: job.link || null,
      })
    );
  }

  staged.delete(id);

  const totals = reports.reduce(
    (a, r) => ({
      inserted: a.inserted + r.inserted,
      updated: a.updated + r.updated,
      skipped: a.skipped + r.skipped,
      failed: a.failed + r.failed,
    }),
    { inserted: 0, updated: 0, skipped: 0, failed: 0 }
  );

  await record(req, {
    category: 'account',
    action: 'db.import',
    targetType: 'user',
    target: null,
    targetName: stage.filename,
    summary:
      `imported ${stage.filename} — ${totals.inserted} added, ${totals.updated} updated, ` +
      `${totals.skipped} skipped, ${totals.failed} failed`,
    changes: reports.map((r) => ({
      field: r.target,
      from: null,
      to: `+${r.inserted} ~${r.updated} skip ${r.skipped} fail ${r.failed}`,
    })),
  });

  res.json({ reports, totals });
});

/** DELETE — throw away a staged upload without importing it. */
export const discardImport = asyncHandler(async (req, res) => {
  staged.delete(req.params.id);
  res.json({ message: 'Upload discarded' });
});
