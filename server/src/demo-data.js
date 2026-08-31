/**
 * Demo data, for previewing how the portal looks with a full roster.
 *
 *   npm run demo:add     insert the demo accounts and their history
 *   npm run demo:clear   remove every trace of them
 *
 * Every demo account is tagged by its `@demo.local` email domain, which is the
 * only thing `clear` matches on. Real accounts use `@inout.local`, so this can
 * never touch them — unlike a seed script, nothing here deletes by wildcard.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { ensureUsableDnsServers } from './config/dns.js';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Entry from './models/Entry.js';
import Media from './models/Media.js';
import Schedule from './models/Schedule.js';
import AuditLog from './models/AuditLog.js';

const DEMO_DOMAIN = 'demo.local';
const DEMO_EMAIL = new RegExp(`@${DEMO_DOMAIN}$`, 'i');
const PASSWORD = 'demo1234';

/** Seeded PRNG, so re-running produces the same roster rather than new noise. */
let seed = 20260826;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (min, max) => min + rnd() * (max - min);

const DEPARTMENTS = ['Content Moderation', 'Trust & Safety', 'Community', 'Operations'];

/* 18 moderators spread across regions, with a few deliberately revoked so the
   access pills and the "inactive" avatar styling both have something to show. */
const PEOPLE = [
  ['Amara Chukwu', 'achukwu', 'Global', true],
  ['Riko Matsuda', 'rmatsuda', 'East Asia', true],
  ['Diego Alonso', 'dalonso', 'Europe', true],
  ['Sana Nakamura', 'snakamura', 'East Asia', true],
  ['Jonas Verlaine', 'jverlaine', 'Europe', true],
  ['Priya Wickramasinghe', 'pwickrama', 'South Asia', true],
  ['Mikael Korhonen', 'mkorhonen', 'Europe', true],
  ['Theo Hallberg', 'thallberg', 'Europe', true],
  ['Elif Yildiz', 'eyildiz', 'Europe', false],
  ['Noah Bergstrom', 'nbergstrom', 'North America', true],
  ['Wei Ling Tan', 'wltan', 'Southeast Asia', true],
  ['Aisha Rahman', 'arahman', 'South Asia', true],
  ['Carlos Mendoza', 'cmendoza', 'North America', true],
  ['Hana Kobayashi', 'hkobayashi', 'East Asia', true],
  ['Liam O’Connor', 'loconnor', 'Oceania', true],
  ['Fatima Al-Sayed', 'falsayed', 'Global', false],
  ['Nguyen Minh Anh', 'nmanh', 'Southeast Asia', true],
  ['Sofia Rossi', 'srossi', 'Europe', false],
];

const DAY = 24 * 60 * 60 * 1000;

async function add() {
  const existing = await User.countDocuments({ email: DEMO_EMAIL });
  if (existing) {
    console.log('%d demo accounts already present — run demo:clear first.', existing);
    return;
  }

  const created = [];
  for (const [name, username, region, active] of PEOPLE) {
    // Sequential, so the password-hashing hook runs cleanly for each.
    created.push(
      await User.create({
        name,
        username,
        email: `${username}@${DEMO_DOMAIN}`,
        password: PASSWORD,
        role: 'employee',
        region,
        department: pick(DEPARTMENTS),
        active,
      })
    );
  }
  console.log('Created %d demo accounts', created.length);

  // ---- attendance: five weeks of weekday shifts ----
  const now = Date.now();
  let entries = 0;

  for (const user of created) {
    if (!user.active) continue; // revoked accounts stopped clocking in

    // Each person keeps a rough daily start time and shift length.
    const startHour = Math.floor(between(6, 15));
    const shiftHours = between(6.5, 9);
    // Attendance rate varies, so the contribution report has a real spread.
    const showsUp = between(0.62, 0.98);

    for (let d = 35; d >= 1; d--) {
      const day = new Date(now - d * DAY);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      if (rnd() > showsUp) continue; // absent that day

      const start = new Date(day);
      start.setHours(startHour, Math.floor(rnd() * 55), 0, 0);
      const end = new Date(start.getTime() + shiftHours * 60 * 60 * 1000 + rnd() * 40 * 60 * 1000);

      await Entry.create({ user: user._id, in: start, out: end, note: '' });
      entries++;
    }
  }

  // A few left on the clock right now, so the board has live rows.
  const live = created.filter((u) => u.active).slice(0, 3);
  for (const user of live) {
    const start = new Date(now - between(0.5, 5) * 60 * 60 * 1000);
    await Entry.create({ user: user._id, in: start, out: null, note: 'On shift' });
    user.status = 'in';
    user.lastSeenAt = start;
    user.statusNote = 'On shift';
    await user.save();
    entries++;
  }
  console.log('Created %d attendance records (%d currently on duty)', entries, live.length);

  // ---- schedules for most of the roster ----
  let shifts = 0;
  for (const user of created.filter((u) => u.active).slice(0, 13)) {
    const start = Math.floor(between(0, 20)) * 60;
    const end = (start + 8 * 60) % 1440;
    // Mostly Mon-Fri, with a couple of weekend rotations.
    const days = rnd() > 0.8 ? [0, 6, 5] : [1, 2, 3, 4, 5];
    await Schedule.findOneAndUpdate(
      { user: user._id },
      { start, end, days: days.sort((a, b) => a - b) },
      { upsert: true }
    );
    shifts++;
  }
  console.log('Assigned %d shifts', shifts);

  // ---- activity trail, so the log has something to page through ----
  const admin = await User.findOne({ role: { $in: ['admin', 'manager'] } }).sort({ role: 1 });
  const trail = [];
  const stamp = (daysAgo) => new Date(now - daysAgo * DAY - rnd() * DAY);

  for (const user of created) {
    trail.push({
      actor: admin?._id ?? null,
      actorName: admin?.name ?? 'System',
      actorRole: admin?.role ?? 'system',
      category: 'account',
      action: 'user.create',
      targetType: 'user',
      target: user._id,
      targetName: user.name,
      targetRole: 'employee',
      summary: `created a moderator account (@${user.username})`,
      at: stamp(between(30, 40)),
    });
  }

  for (const user of created.filter((u) => !u.active)) {
    trail.push({
      actor: admin?._id ?? null,
      actorName: admin?.name ?? 'System',
      actorRole: admin?.role ?? 'system',
      category: 'account',
      action: 'user.update',
      targetType: 'user',
      target: user._id,
      targetName: user.name,
      targetRole: 'employee',
      changes: [{ field: 'active', from: 'yes', to: 'no' }],
      summary: `changed @${user.username}'s access`,
      at: stamp(between(1, 12)),
    });
  }

  for (const user of created.slice(0, 6)) {
    const from = user.region;
    const to = pick(['Europe', 'East Asia', 'Global', 'Oceania']);
    if (from === to) continue;
    trail.push({
      actor: admin?._id ?? null,
      actorName: admin?.name ?? 'System',
      actorRole: admin?.role ?? 'system',
      category: 'account',
      action: 'user.update',
      targetType: 'user',
      target: user._id,
      targetName: user.name,
      targetRole: 'employee',
      changes: [{ field: 'region', from, to }],
      summary: `changed @${user.username}'s region`,
      at: stamp(between(2, 20)),
    });
  }

  for (const user of created.slice(6, 11)) {
    trail.push({
      actor: admin?._id ?? null,
      actorName: admin?.name ?? 'System',
      actorRole: admin?.role ?? 'system',
      category: 'security',
      action: 'user.password_reset',
      targetType: 'user',
      target: user._id,
      targetName: user.name,
      targetRole: 'employee',
      summary: `reset the password for @${user.username}`,
      at: stamp(between(1, 15)),
    });
  }

  await AuditLog.insertMany(trail);
  console.log('Added %d activity-log entries', trail.length);
}

async function clear() {
  const users = await User.find({ email: DEMO_EMAIL }).select('_id name').lean();
  if (!users.length) {
    console.log('No demo accounts found.');
    return;
  }

  const ids = users.map((u) => u._id);
  const [entries, schedules, media, logs] = await Promise.all([
    Entry.deleteMany({ user: { $in: ids } }),
    Schedule.deleteMany({ user: { $in: ids } }),
    Media.deleteMany({ user: { $in: ids } }),
    AuditLog.deleteMany({ target: { $in: ids } }),
  ]);
  await User.deleteMany({ _id: { $in: ids } });

  console.log(
    'Removed %d demo accounts, %d entries, %d schedules, %d media, %d log entries',
    ids.length, entries.deletedCount, schedules.deletedCount, media.deletedCount, logs.deletedCount
  );
}

const mode = process.argv[2];
if (!['add', 'clear'].includes(mode)) {
  console.error('Usage: node src/demo-data.js <add|clear>');
  process.exit(1);
}

ensureUsableDnsServers();
await connectDB(process.env.MONGO_URI);
await (mode === 'add' ? add() : clear());

const remaining = await User.countDocuments({ email: DEMO_EMAIL });
console.log('Demo accounts now in the database: %d', remaining);
console.log('Real accounts untouched: %d', await User.countDocuments({ email: { $not: DEMO_EMAIL } }));

await mongoose.connection.close();
