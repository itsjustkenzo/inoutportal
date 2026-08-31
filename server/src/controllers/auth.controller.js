import jwt from 'jsonwebtoken';
import User, { MIN_PASSWORD_LENGTH, PASSWORD_RULE } from '../models/User.js';
import { asyncHandler } from '../middleware/error.js';

function signToken(user) {
  return jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function publicUser(user) {
  const {
    _id, name, username, email, role, department, region, prefs,
    status, lastSeenAt, statusNote, active, createdAt, updatedAt,
  } = user;

  return {
    id: _id,
    name,
    username,
    email,
    role,
    department,
    region,
    prefs: { accent: prefs?.accent || 'white', dim: prefs?.dim ?? 45 },
    status,
    lastSeenAt,
    statusNote,
    // Needed by the moderator management screen.
    active,
    createdAt,
    updatedAt,
  };
}

export const register = asyncHandler(async (req, res) => {
  const { name, username, email, password, department } = req.body;
  if (!name || !username || !email || !password) {
    return res.status(400).json({ message: 'name, username, email and password are required' });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ message: PASSWORD_RULE });
  }

  // First account to exist becomes the admin; everyone after is an employee.
  const isFirstUser = (await User.estimatedDocumentCount()) === 0;

  const user = await User.create({
    name,
    username,
    email,
    password,
    department,
    role: isFirstUser ? 'admin' : 'employee',
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'username and password are required' });

  const user = await User.findOne({ username: String(username).trim().toLowerCase() }).select('+password');

  // Distinct messages by request. Note this makes usernames enumerable: anyone
  // can probe which accounts exist by watching for "Username does not exist".
  if (!user) return res.status(401).json({ message: 'Username does not exist' });
  if (!(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Incorrect password' });
  }
  if (!user.active) {
    return res.status(403).json({ message: 'Your access to this portal has been revoked' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export { publicUser };
