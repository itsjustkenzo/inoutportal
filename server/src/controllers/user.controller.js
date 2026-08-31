import crypto from 'crypto';
import User, { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../models/User.js';
import Entry from '../models/Entry.js';
import Media from '../models/Media.js';
import Schedule from '../models/Schedule.js';
import Remark from '../models/Remark.js';
import { asyncHandler } from '../middleware/error.js';
import { publicUser } from './auth.controller.js';
import { canManageAccount } from '../middleware/auth.js';
import { record, diff, summarise } from '../utils/audit.js';

const ROLES = ['employee', 'admin', 'audit', 'manager'];

/** What each role is called in the trail, rather than its internal id. */
const ROLE_NAMES = { employee: 'moderator', admin: 'admin', audit: 'finance', manager: 'server manager' };
const roleName = (r) => ROLE_NAMES[r] || r;
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** Account fields the trail watches. */
const TRACKED = ['name', 'username', 'role', 'region', 'department', 'active'];

const snapshot = (u) => ({
  name: u.name,
  username: u.username,
  role: u.role,
  region: u.region,
  department: u.department,
  active: u.active,
});

/** Readable temp password: no look-alike characters, always passes the 8-char rule. */
function generatePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(length))
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

/** Admin: list accounts, optionally narrowed with ?role=employee. */
export const listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;

  const users = await User.find(filter).sort({ name: 1 });
  res.json({ users: users.map(publicUser) });
});

/**
 * Create an account. Email is derived from the username — the model requires
 * one, but the form has no reason to ask for it. Admins may only create
 * moderators; a server manager may create any role.
 */
export const createUser = asyncHandler(async (req, res) => {
  const { name, username, region, department, password, role } = req.body;
  if (!name || !username) {
    return res.status(400).json({ message: 'name and username are required' });
  }

  const wanted = role ? String(role) : 'employee';
  if (!ROLES.includes(wanted)) {
    return res.status(400).json({ message: 'Unknown role' });
  }
  if (wanted !== 'employee' && req.user.role !== 'manager') {
    return res.status(403).json({ message: 'Only a server manager can create privileged accounts' });
  }

  const clean = String(username).trim().toLowerCase();
  if (await User.findOne({ username: clean })) {
    return res.status(409).json({ message: 'That username is already taken' });
  }

  const temp = password ? String(password) : generatePassword();
  if (temp.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ message: PASSWORD_RULE });
  }

  const user = await User.create({
    name: String(name).trim(),
    username: clean,
    email: `${clean}@inout.local`,
    password: temp,
    region: region ? String(region).trim() : undefined,
    department: department ? String(department).trim() : undefined,
    role: wanted,
  });

  await record(req, {
    category: 'account',
    action: 'user.create',
    targetType: 'user',
    target: user._id,
    targetName: user.name,
    targetRole: user.role,
    summary: `created ${article(roleName(user.role))} ${roleName(user.role)} account (@${user.username})`,
  });

  // The plaintext is returned once, so the admin can pass it on.
  res.status(201).json({ user: publicUser(user), tempPassword: temp });
});

/** Issue a new temporary password and return it once. */
export const resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!canManageAccount(req.user, user)) {
    return res.status(403).json({ message: 'Only a server manager can manage this account' });
  }

  const temp = generatePassword();
  user.password = temp;
  await user.save();

  await record(req, {
    category: 'security',
    action: 'user.password_reset',
    targetType: 'user',
    target: user._id,
    targetName: user.name,
    targetRole: user.role,
    summary: `reset the password for @${user.username}`,
  });

  res.json({ user: publicUser(user), tempPassword: temp });
});

/** Admin: remove an account along with its attendance and stored media. */
export const deleteUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!canManageAccount(req.user, user)) {
    return res.status(403).json({ message: 'Only a server manager can delete this account' });
  }

  // Everything that points at the account goes first, so a failure never leaves
  // orphans behind. The rota belongs here too: the schedule list hides rows
  // whose moderator is gone, so a stray one is invisible rather than harmless.
  const [entries] = await Promise.all([
    Entry.deleteMany({ user: user._id }),
    Media.deleteMany({ user: user._id }),
    Schedule.deleteMany({ user: user._id }),
    Remark.deleteMany({ user: user._id }),
  ]);
  await user.deleteOne();

  await record(req, {
    category: 'account',
    action: 'user.delete',
    targetType: 'user',
    target: user._id,
    targetName: user.name,
    targetRole: user.role,
    summary: `deleted the ${roleName(user.role)} account @${user.username} and ${entries.deletedCount} attendance record${entries.deletedCount === 1 ? '' : 's'}`,
  });

  res.json({ message: 'Account deleted', entriesRemoved: entries.deletedCount });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, department, region } = req.body;
  const before = {
    ...snapshot(req.user),
    'prefs.accent': req.user.prefs?.accent,
    'prefs.dim': req.user.prefs?.dim,
  };
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ message: 'Name cannot be empty' });
    req.user.name = trimmed;
  }
  if (department !== undefined) req.user.department = String(department).trim();
  if (region !== undefined) req.user.region = String(region).trim();

  if (req.body.prefs) {
    const { accent, dim } = req.body.prefs;
    if (accent !== undefined) req.user.set('prefs.accent', String(accent).trim());
    if (dim !== undefined) {
      const n = Number(dim);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ message: 'dim must be between 0 and 100' });
      }
      req.user.set('prefs.dim', Math.round(n));
    }
  }

  await req.user.save();

  const changes = diff(
    before,
    { ...snapshot(req.user), 'prefs.accent': req.user.prefs?.accent, 'prefs.dim': req.user.prefs?.dim },
    [...TRACKED, 'prefs.accent', 'prefs.dim']
  );
  if (changes.length) {
    await record(req, {
      category: 'account',
      action: 'user.profile_update',
      targetType: 'user',
      target: req.user._id,
      targetName: req.user.name,
      targetRole: req.user.role,
      changes,
      summary: summarise('updated their own', changes),
    });
  }

  res.json({ user: publicUser(req.user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required' });
  }
  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ message: PASSWORD_RULE });
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    return res.status(401).json({ message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  await record(req, {
    category: 'security',
    action: 'user.password_change',
    targetType: 'user',
    target: user._id,
    targetName: user.name,
    targetRole: user.role,
    summary: 'changed their own password',
  });

  res.json({ message: 'Password updated' });
});

/** Change a user's details, role, or active state. */
export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (!canManageAccount(req.user, user)) {
    return res.status(403).json({ message: 'Only a server manager can manage this account' });
  }

  const before = snapshot(user);
  const self = String(user._id) === String(req.user._id);
  if (self && ((req.body.role && req.body.role !== user.role) || req.body.active === false)) {
    return res.status(400).json({ message: 'You cannot change your own role or deactivate yourself' });
  }

  if (req.body.role && req.body.role !== user.role) {
    if (!ROLES.includes(req.body.role)) {
      return res.status(400).json({ message: 'Unknown role' });
    }
    // Promoting into a privileged role is a server-manager decision.
    if (req.user.role !== 'manager') {
      return res.status(403).json({ message: 'Only a server manager can change roles' });
    }
    // The last manager must not be able to strip the system of its owner.
    if (user.role === 'manager' && (await User.countDocuments({ role: 'manager' })) <= 1) {
      return res.status(400).json({ message: 'This is the only server manager — promote another one first' });
    }
    user.role = req.body.role;
  }
  if (req.body.department !== undefined) user.department = String(req.body.department).trim();
  if (req.body.region !== undefined) user.region = String(req.body.region).trim();
  if (req.body.name !== undefined) {
    const trimmed = String(req.body.name).trim();
    if (!trimmed) return res.status(400).json({ message: 'Name cannot be empty' });
    user.name = trimmed;
  }
  if (req.body.active !== undefined) user.active = Boolean(req.body.active);

  await user.save();

  const changes = diff(before, snapshot(user), TRACKED);
  if (changes.length) {
    await record(req, {
      category: 'account',
      action: 'user.update',
      targetType: 'user',
      target: user._id,
      targetName: user.name,
      targetRole: user.role,
      changes,
      summary: summarise(`changed @${user.username}'s`, changes),
    });
  }

  res.json({ user: publicUser(user) });
});
