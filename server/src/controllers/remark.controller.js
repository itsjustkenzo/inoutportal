import { isValidObjectId } from 'mongoose';
import Remark from '../models/Remark.js';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/error.js';
import { record } from '../utils/audit.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Remarks for a day, or for a person over a range.
 *
 *   ?date=YYYY-MM-DD            every moderator's note for that day
 *   ?userId=…&from=…&to=…       one person's notes across a period
 *
 * Both shapes are needed: the contribution table fills a column for one day,
 * while a per-person report needs a whole month at once.
 */
export const listRemarks = asyncHandler(async (req, res) => {
  const { date, userId, from, to } = req.query;
  const filter = {};

  if (date) {
    if (!DATE.test(date)) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
    filter.date = date;
  } else if (from || to) {
    // Plain string comparison is enough: YYYY-MM-DD sorts chronologically.
    filter.date = {};
    if (from) filter.date.$gte = String(from).slice(0, 10);
    if (to) filter.date.$lte = String(to).slice(0, 10);
  }

  if (userId) {
    if (!isValidObjectId(userId)) return res.status(400).json({ message: 'Invalid userId' });
    filter.user = userId;
  }

  const remarks = await Remark.find(filter).select('user date text authorName updatedAt').lean();
  res.json({ remarks });
});

/**
 * Write (or clear) one day's remark. Blank text removes the note rather than
 * storing an empty one, so "no remark" has a single representation.
 */
export const setRemark = asyncHandler(async (req, res) => {
  const { userId, date } = req.body;
  const text = String(req.body.text ?? '').trim();

  if (!isValidObjectId(userId)) return res.status(400).json({ message: 'Invalid userId' });
  if (!DATE.test(String(date))) return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
  if (text.length > 500) return res.status(400).json({ message: 'A remark must be under 500 characters' });

  const target = await User.findById(userId).select('name role').lean();
  if (!target) return res.status(404).json({ message: 'User not found' });

  const before = await Remark.findOne({ user: userId, date }).lean();

  if (!text) {
    await Remark.deleteOne({ user: userId, date });
    if (before?.text) {
      await record(req, {
        category: 'attendance',
        action: 'remark.clear',
        targetType: 'user',
        target: userId,
        targetName: target.name,
        targetRole: target.role,
        summary: `cleared the remark on ${target.name} for ${date}`,
      });
    }
    return res.json({ remark: null });
  }

  const remark = await Remark.findOneAndUpdate(
    { user: userId, date },
    { text, author: req.user._id, authorName: req.user.name },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (before?.text !== text) {
    await record(req, {
      category: 'attendance',
      action: before ? 'remark.update' : 'remark.create',
      targetType: 'user',
      target: userId,
      targetName: target.name,
      targetRole: target.role,
      summary: `${before ? 'changed' : 'left'} a remark on ${target.name} for ${date}`,
    });
  }

  res.json({ remark });
});
