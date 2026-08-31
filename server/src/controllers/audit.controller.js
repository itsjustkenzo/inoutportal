import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../middleware/error.js';

/**
 * Server manager: the change trail, newest first.
 * Supports ?category=&targetRole=&q=&page=&limit=
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

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));

  const [logs, total, categories] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
    // Counts are over the whole trail, not the current filter, so the tabs
    // do not renumber themselves as you click between them.
    AuditLog.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }]),
  ]);

  res.json({
    logs,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    counts: Object.fromEntries(categories.map((c) => [c._id, c.n])),
  });
});
