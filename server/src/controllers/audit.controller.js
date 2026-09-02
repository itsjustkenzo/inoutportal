import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../middleware/error.js';

/**
 * Server manager: the change trail, newest first.
 * Supports ?category=&targetRole=&q=&from=&to=&page=&limit=
 */
export const listAudit = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
  if (req.query.targetRole && req.query.targetRole !== 'all') filter.targetRole = req.query.targetRole;

  if (req.query.q) {
    // Escaped: a name may legitimately contain regex punctuation.
    const needle = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ actorName: needle }, { targetName: needle }, { summary: needle }];
  }

  /*
   * Time window. The client sends instants, so "today" means today wherever the
   * reader is sitting rather than wherever the server runs. A value that is not
   * a date is rejected rather than dropped: silently ignoring it would show the
   * whole trail while the console claimed a window was applied.
   */
  const at = {};
  for (const [key, op] of [['from', '$gte'], ['to', '$lte']]) {
    if (!req.query[key]) continue;
    const when = new Date(req.query[key]);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ message: `${key} must be a date` });
    }
    at[op] = when;
  }
  if (Object.keys(at).length) filter.at = at;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));

  /*
   * The per-category counts use every filter except the category itself. That
   * keeps the chips from renumbering as you click between them, while still
   * answering "how many of these are in the window I am looking at" — a chip
   * reading 42 above three rows would just look broken.
   */
  const { category, ...countFilter } = filter;

  const [logs, total, categories] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
    AuditLog.aggregate([{ $match: countFilter }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
  ]);

  res.json({
    logs,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    counts: Object.fromEntries(categories.map((c) => [c._id, c.n])),
  });
});
