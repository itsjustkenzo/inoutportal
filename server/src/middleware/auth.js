import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ message: 'Account unavailable' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/**
 * Admin-level access. Server managers outrank admins, so anything an admin can
 * reach they can reach too — this gate is "admin or higher", not "role == admin".
 */
export function requireAdmin(req, res, next) {
  if (!['admin', 'manager'].includes(req.user?.role)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

/** Server manager only: privileged account changes and attendance rewrites. */
export function requireManager(req, res, next) {
  if (req.user?.role !== 'manager') {
    return res.status(403).json({ message: 'Server manager access required' });
  }
  next();
}

/** Roles an admin may hand out; anything above this is manager-only. */
export const ADMIN_ASSIGNABLE_ROLES = ['employee'];

/** True when `actor` is allowed to modify the account `target`. */
export function canManageAccount(actor, target) {
  if (actor.role === 'manager') return true;
  // Admins may only touch moderators, never each other or a manager.
  return actor.role === 'admin' && target.role === 'employee';
}

/** Gate a route on a set of roles, e.g. requireRole('admin', 'audit'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ message: 'You do not have access to this' });
    }
    next();
  };
}
