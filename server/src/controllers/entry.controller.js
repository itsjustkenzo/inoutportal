import mongoose from 'mongoose';
import Entry from '../models/Entry.js';
import User from '../models/User.js';
import Schedule from '../models/Schedule.js';
import { asyncHandler } from '../middleware/error.js';
import { record, diff, summarise } from '../utils/audit.js';

/** Attendance fields the trail watches. */
const ENTRY_FIELDS = ['in', 'out', 'note'];
const entrySnapshot = (e) => ({ in: e.in, out: e.out, note: e.note });

/** Punch IN. Rejects if an open entry already exists. */
export const punchIn = asyncHandler(async (req, res) => {
  const open = await Entry.findOne({ user: req.user._id, out: null });
  if (open) return res.status(409).json({ message: 'You are already punched in', entry: open });

  const note = (req.body.note || '').trim();
  const entry = await Entry.create({ user: req.user._id, in: new Date(), note });

  req.user.status = 'in';
  req.user.lastSeenAt = entry.in;
  req.user.statusNote = note;
  await req.user.save();

  await record(req, {
    category: 'attendance',
    action: 'entry.punch_in',
    targetType: 'entry',
    target: entry._id,
    targetName: req.user.name,
    targetRole: req.user.role,
    summary: 'clocked in',
  });

  res.status(201).json({ entry, status: 'in' });
});

/** Punch OUT. Closes the open entry and stamps duration. */
export const punchOut = asyncHandler(async (req, res) => {
  const entry = await Entry.findOne({ user: req.user._id, out: null });
  if (!entry) return res.status(409).json({ message: 'You are not punched in' });

  entry.out = new Date();
  if (req.body.note !== undefined) entry.note = String(req.body.note).trim();
  await entry.save();

  req.user.status = 'out';
  req.user.lastSeenAt = entry.out;
  req.user.statusNote = entry.note;
  await req.user.save();

  await record(req, {
    category: 'attendance',
    action: 'entry.punch_out',
    targetType: 'entry',
    target: entry._id,
    targetName: req.user.name,
    targetRole: req.user.role,
    summary: `clocked out after ${entry.minutes}m`,
  });

  res.json({ entry, status: 'out' });
});

/** Whoever is currently punched in, plus everyone else, for the board. */
export const board = asyncHandler(async (req, res) => {
  const users = await User.find({ active: true })
    .select('name username email status lastSeenAt statusNote role')
    .sort({ status: 1, name: 1 })
    .lean();

  res.json({
    inCount: users.filter((u) => u.status === 'in').length,
    total: users.length,
    users,
  });
});

/** Current user's open entry, if any. */
export const current = asyncHandler(async (req, res) => {
  const entry = await Entry.findOne({ user: req.user._id, out: null });
  res.json({ entry, status: entry ? 'in' : 'out' });
});

/**
 * Entry history. Employees see only their own; admins may pass ?userId=
 * Supports ?from=&to=&page=&limit=
 */
export const history = asyncHandler(async (req, res) => {
  /*
   * Audit is included because payroll reconciliation is exactly a per-person
   * question — the contribution report breaks a month down day by day. Note the
   * fallback is silent by design for a moderator (their own history), so any
   * role that needs another person's must be listed here or it would quietly
   * return the wrong data under the right name.
   */
  const canReadOthers = ['admin', 'manager', 'audit'].includes(req.user.role);
  const targetUser = canReadOthers && req.query.userId ? req.query.userId : req.user._id;

  const filter = { user: targetUser };
  if (req.query.from || req.query.to) {
    filter.in = {};
    if (req.query.from) filter.in.$gte = new Date(req.query.from);
    if (req.query.to) filter.in.$lte = new Date(req.query.to);
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

  // Totals cover the whole filtered period, not just the page being returned.
  const totalsMatch = { ...filter, user: new mongoose.Types.ObjectId(String(targetUser)) };

  const [entries, total, totals] = await Promise.all([
    Entry.find(filter)
      .populate('user', 'name email department')
      .sort({ in: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Entry.countDocuments(filter),
    Entry.aggregate([
      { $match: totalsMatch },
      {
        $group: {
          _id: null,
          minutes: { $sum: '$minutes' },
          days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$in' } } },
        },
      },
    ]),
  ]);

  res.json({
    entries,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    totalMinutes: totals[0]?.minutes || 0,
    workDays: totals[0]?.days.length || 0,
  });
});

/**
 * Admin: everything the admin dashboard needs for one day, in a single call —
 * headline counts, an attendance row per active user, and a recent-events feed.
 * `?date=YYYY-MM-DD` selects the day; it defaults to today.
 */
export const overview = asyncHandler(async (req, res) => {
  const base = req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return res.status(400).json({ message: 'Invalid date' });

  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Schedules store weekdays the JS way, 0 = Sunday.
  const weekday = start.getDay();

  const [users, entries, schedules] = await Promise.all([
    // Moderators only. Admins oversee attendance rather than record it, so
    // listing them would show a permanently "absent" row for every admin.
    User.find({ active: true, role: 'employee' })
      .select('name username role department')
      .sort({ name: 1 })
      .lean(),
    /*
     * For today, open entries are included whatever day they started, so a
     * shift running past midnight still reads as on duty. For a past date the
     * day is scoped strictly — otherwise a currently-open shift would leak into
     * every historical day and mark people on duty when they were not.
     */
    Entry.find(
      start.toDateString() === new Date().toDateString()
        ? { $or: [{ in: { $gte: start, $lte: end } }, { out: null }] }
        : { in: { $gte: start, $lte: end } }
    )
      .populate('user', 'name username role department')
      .sort({ in: 1 })
      .lean(),
    // Who is rostered on this weekday.
    Schedule.find({ days: weekday }).select('user start end').lean(),
  ]);

  const rostered = new Map(schedules.map((s) => [String(s.user), s]));

  const byUser = new Map();
  for (const e of entries) {
    if (!e.user) continue; // entry whose user was deleted
    const key = String(e.user._id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(e);
  }

  /*
   * The board is the day's roster: who was meant to be working. Someone not
   * scheduled for this weekday is not off-duty, they are simply not on the rota,
   * and listing them adds a row that can never mean anything.
   *
   * The second half of the test matters as much as the first — anyone who
   * actually clocked in is shown whether or not the rota expected them.
   * Hiding real attendance because the schedule disagrees would lose data, and
   * an unscheduled person who turned up is exactly what an admin needs to see.
   */
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  /** When a shift on this date actually ends, counting one that crosses midnight. */
  const shiftEndsAt = (shift) => {
    const end = start.getTime() + shift.end * 60000;
    return shift.end <= shift.start ? end + DAY_MS : end;
  };

  const rows = users
    .filter((u) => rostered.has(String(u._id)) || byUser.has(String(u._id)))
    .map((u) => {
      const mine = byUser.get(String(u._id)) || [];
      const open = mine.find((e) => !e.out);
      const last = mine[mine.length - 1];
      const shift = rostered.get(String(u._id));

      /*
       * Missing a shift is only knowable once the shift is over. Before then —
       * whether the day has not started or is still running — there is nothing
       * to report, so the row reads as off duty rather than accusing someone of
       * absence hours before they were due. On a past date every shift has
       * ended, so a no-show is correctly absent.
       */
      let status;
      if (open) status = 'onduty';
      else if (mine.length) status = 'completed';
      else if (shift && now < shiftEndsAt(shift)) status = 'upcoming';
      else status = 'absent';

      return {
        userId: u._id,
        name: u.name,
        username: u.username,
        role: u.role,
        department: u.department,
        // Lets the console tell "off duty" apart from "worked unscheduled".
        scheduled: Boolean(shift),
        shift: shift ? { start: shift.start, end: shift.end } : null,
        // First clock-in and last clock-out of the day frame the whole shift.
        in: mine.length ? mine[0].in : null,
        out: open ? null : last?.out || null,
        minutes: mine.reduce((sum, e) => sum + (e.minutes || 0), 0),
        status,
      };
    });

  // One event per punch, newest first.
  const activity = entries
    .flatMap((e) => {
      // Handle rather than department: the reports identify people by username.
      const who = { userId: e.user._id, name: e.user.name, username: e.user.username };
      const events = [{ ...who, type: 'in', at: e.in }];
      if (e.out) events.push({ ...who, type: 'out', at: e.out });
      return events;
    })
    // Enough to page through on the dashboard rather than just a preview.
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 60);

  res.json({
    date: start,
    counts: {
      in: rows.filter((r) => r.status === 'onduty').length,
      out: rows.filter((r) => r.status === 'completed').length,
      total: rows.length,
    },
    rows,
    activity,
  });
});

/** Admin: minutes logged per user over a window (default: last 30 days). */
export const summary = asyncHandler(async (req, res) => {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const rows = await Entry.aggregate([
    { $match: { in: { $gte: from, $lte: to }, out: { $ne: null } } },
    { $group: { _id: '$user', minutes: { $sum: '$minutes' }, sessions: { $sum: 1 } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    // Moderators only, matching the attendance view.
    { $match: { 'user.role': 'employee', 'user.active': true } },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: '$user.name',
        // The reports identify people by handle rather than by department.
        username: '$user.username',
        email: '$user.email',
        department: '$user.department',
        // Lets a per-person report break the period into that person's own
        // calendar days rather than into the reader's.
        region: '$user.region',
        minutes: 1,
        sessions: 1,
      },
    },
    { $sort: { minutes: -1 } },
  ]);

  res.json({ from, to, rows });
});

/**
 * Server manager: every attendance record across every account, newest first.
 * Searching and sorting happen client-side over this set — the console needs
 * the whole list to sort by name or duration, not one page of it.
 */
export const listAllEntries = asyncHandler(async (req, res) => {
  const entries = await Entry.find()
    .populate('user', 'name username role')
    .sort({ in: -1 })
    .limit(2000)
    .lean();

  // Drop rows whose account was deleted; nothing sensible to show for them.
  res.json({ entries: entries.filter((e) => e.user) });
});

/**
 * Server manager: write an attendance record by hand, for a shift that was
 * never punched or was recorded against the wrong account.
 */
export const createEntry = asyncHandler(async (req, res) => {
  const { userId, in: inAt, out, note } = req.body;
  if (!userId || !inAt) {
    return res.status(400).json({ message: 'userId and in are required' });
  }

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: 'User not found' });

  const start = new Date(inAt);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ message: 'Invalid clock-in time' });
  }

  let end = null;
  if (out) {
    end = new Date(out);
    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid clock-out time' });
    }
    if (end < start) {
      return res.status(400).json({ message: 'Punch-out cannot precede punch-in' });
    }
  } else if (await Entry.findOne({ user: user._id, out: null })) {
    // Two open entries would make "who is in right now" ambiguous.
    return res.status(409).json({ message: `${user.name} already has an open session` });
  }

  const entry = await Entry.create({
    user: user._id,
    in: start,
    out: end,
    note: note ? String(note).trim() : '',
  });

  // An open entry means they are on the clock, so the board has to agree.
  if (!end) {
    user.status = 'in';
    user.lastSeenAt = start;
    await user.save();
  }

  await record(req, {
    category: 'attendance',
    action: 'entry.create',
    targetType: 'entry',
    target: entry._id,
    targetName: user.name,
    targetRole: user.role,
    changes: diff({}, entrySnapshot(entry), ENTRY_FIELDS),
    summary: `added an attendance record for ${user.name}`,
  });

  res.status(201).json({ entry });
});

/** Correct or delete a record. */
export const updateEntry = asyncHandler(async (req, res) => {
  const entry = await Entry.findById(req.params.id).populate('user', 'name role');
  if (!entry) return res.status(404).json({ message: 'Entry not found' });

  const before = entrySnapshot(entry);
  if (req.body.in) entry.in = new Date(req.body.in);
  if (req.body.out !== undefined) entry.out = req.body.out ? new Date(req.body.out) : null;
  if (req.body.note !== undefined) entry.note = String(req.body.note).trim();

  if (entry.out && entry.out < entry.in) {
    return res.status(400).json({ message: 'Punch-out cannot precede punch-in' });
  }

  await entry.save();

  const changes = diff(before, entrySnapshot(entry), ENTRY_FIELDS);
  if (changes.length) {
    await record(req, {
      category: 'attendance',
      action: 'entry.update',
      targetType: 'entry',
      target: entry._id,
      targetName: entry.user?.name || 'Unknown',
      targetRole: entry.user?.role || '',
      changes,
      summary: summarise(`corrected ${entry.user?.name || 'a'}'s`, changes),
    });
  }

  res.json({ entry });
});

export const deleteEntry = asyncHandler(async (req, res) => {
  const entry = await Entry.findById(req.params.id).populate('user', 'name role');
  if (!entry) return res.status(404).json({ message: 'Entry not found' });

  const owner = entry.user;
  // Captured before deletion so the trail keeps what the record contained.
  const was = entrySnapshot(entry);
  await entry.deleteOne();

  await record(req, {
    category: 'attendance',
    action: 'entry.delete',
    targetType: 'entry',
    target: req.params.id,
    targetName: owner?.name || 'Unknown',
    targetRole: owner?.role || '',
    // Rendered client-side in the reader's timezone, so no raw ISO in the text.
    changes: diff(was, {}, ENTRY_FIELDS),
    summary: `deleted an attendance record for ${owner?.name || 'an account'}`,
  });

  res.json({ message: 'Entry deleted' });
});
