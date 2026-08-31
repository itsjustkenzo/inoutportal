import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/error.js';
import { record } from '../utils/audit.js';

/** Minutes worked, counting a shift that crosses midnight. */
const durationOf = (start, end) => (end > start ? end - start : 1440 - start + end);

function shape(doc) {
  const u = doc.user;
  return {
    id: doc._id,
    userId: u?._id || doc.user,
    name: u?.name || null,
    username: u?.username || null,
    region: u?.region || null,
    start: doc.start,
    end: doc.end,
    days: [...doc.days].sort((a, b) => a - b),
    minutes: durationOf(doc.start, doc.end),
    updatedAt: doc.updatedAt,
  };
}

/** Admin: every assigned shift, moderators only. */
export const listSchedules = asyncHandler(async (req, res) => {
  const schedules = await Schedule.find().populate('user', 'name username region role active').lean();

  const rows = schedules
    // Drop rows whose moderator was deleted or promoted since assignment.
    .filter((s) => s.user && s.user.role === 'employee')
    .map(shape)
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ schedules: rows });
});

/** Admin: assign or replace one moderator's shift. */
export const upsertSchedule = asyncHandler(async (req, res) => {
  const { start, end, days } = req.body;

  const user = await User.findById(req.params.userId);
  if (!user) return res.status(404).json({ message: 'Moderator not found' });
  if (user.role !== 'employee') {
    return res.status(400).json({ message: 'Only moderators can be given a shift' });
  }

  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 1439 || e < 0 || e > 1439) {
    return res.status(400).json({ message: 'start and end must be minutes from midnight (0–1439)' });
  }
  if (s === e) return res.status(400).json({ message: 'Start and end cannot be the same time' });

  const clean = [...new Set((Array.isArray(days) ? days : []).map(Number))].filter(
    (n) => Number.isInteger(n) && n >= 0 && n <= 6
  );
  if (!clean.length) return res.status(400).json({ message: 'Pick at least one working day' });

  const doc = await Schedule.findOneAndUpdate(
    { user: user._id },
    { start: s, end: e, days: clean },
    { upsert: true, new: true, runValidators: true }
  ).populate('user', 'name username region role active');

  const shaped = shape(doc);
  const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  await record(req, {
    category: 'schedule',
    action: 'schedule.assign',
    targetType: 'schedule',
    target: doc._id,
    targetName: user.name,
    targetRole: user.role,
    changes: [
      { field: 'start', from: null, to: clock(s) },
      { field: 'end', from: null, to: clock(e) },
      { field: 'days', from: null, to: clean.sort((a, b) => a - b).join(', ') },
    ],
    summary: `assigned ${user.name} a ${clock(s)}–${clock(e)} shift`,
  });

  res.json({ schedule: shaped });
});

export const deleteSchedule = asyncHandler(async (req, res) => {
  const removed = await Schedule.findOneAndDelete({ user: req.params.userId });
  if (!removed) return res.status(404).json({ message: 'No shift assigned' });

  const owner = await User.findById(req.params.userId).select('name role').lean();
  await record(req, {
    category: 'schedule',
    action: 'schedule.remove',
    targetType: 'schedule',
    target: removed._id,
    targetName: owner?.name || 'Unknown',
    targetRole: owner?.role || '',
    summary: `removed ${owner?.name || 'a moderator'}'s shift`,
  });

  res.json({ message: 'Shift removed' });
});
