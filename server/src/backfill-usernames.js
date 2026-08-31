/**
 * One-off migration: gives every pre-existing user a username.
 *
 * Username became the login identifier, and the field is required — without a
 * value these accounts cannot sign in and any user.save() (a punch, a profile
 * edit) would fail validation. Safe to re-run; users that already have one are
 * left alone.
 *
 *   npm run backfill:usernames
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { ensureUsableDnsServers } from './config/dns.js';
import { connectDB } from './config/db.js';
import User from './models/User.js';

/** "Ada.Lovelace+work@x.com" -> "ada.lovelace" */
function baseFrom(user) {
  const local = String(user.email || '').split('@')[0];
  const cleaned = local.toLowerCase().replace(/\+.*$/, '').replace(/[^a-z0-9._-]/g, '');
  return cleaned.length >= 3 ? cleaned.slice(0, 32) : `user${String(user._id).slice(-6)}`;
}

async function run() {
  ensureUsableDnsServers();
  await connectDB(process.env.MONGO_URI);

  const pending = await User.find({ $or: [{ username: { $exists: false } }, { username: null }] });
  if (!pending.length) {
    console.log('Nothing to backfill — every user already has a username.');
    await mongoose.connection.close();
    return;
  }

  const taken = new Set(
    (await User.find({ username: { $type: 'string' } }).select('username')).map((u) => u.username)
  );

  for (const user of pending) {
    const base = baseFrom(user);
    let username = base;
    for (let n = 2; taken.has(username); n++) username = `${base.slice(0, 29)}${n}`;
    taken.add(username);

    // updateOne so we neither re-hash the password nor trip other validators.
    await User.updateOne({ _id: user._id }, { $set: { username } });
    console.log(`${user.email} -> ${username}`);
  }

  console.log(`Backfilled ${pending.length} user(s)`);
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
