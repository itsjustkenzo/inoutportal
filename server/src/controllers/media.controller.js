import { isValidObjectId } from 'mongoose';
import Media from '../models/Media.js';
import { asyncHandler } from '../middleware/error.js';
import { record } from '../utils/audit.js';

/** Avatars are cropped to 512px client-side; wallpapers are stored as picked. */
export const LIMITS = { avatar: 2 * 1024 * 1024, wallpaper: 8 * 1024 * 1024 };

const KINDS = Object.keys(LIMITS);

function kindOf(req, res) {
  const { kind } = req.params;
  if (!KINDS.includes(kind)) {
    res.status(400).json({ message: `kind must be one of: ${KINDS.join(', ')}` });
    return null;
  }
  return kind;
}

function sendMedia(res, media) {
  if (!media) return res.status(404).json({ message: 'Not set' });

  // setHeader/end rather than res.set/res.send: Express appends "; charset=utf-8"
  // and runs the body through its text path, which corrupts the bytes.
  const buf = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data.buffer || media.data);

  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Content-Length', buf.length);
  // Private: the response is tied to the caller's token, never a shared cache.
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  return res.end(buf);
}

export const getMedia = asyncHandler(async (req, res) => {
  const kind = kindOf(req, res);
  if (!kind) return undefined;

  return sendMedia(res, await Media.findOne({ user: req.user._id, kind }).lean());
});

/**
 * Another account's profile picture, so the admin and payroll screens can put a
 * face to each row instead of a pair of initials.
 *
 * Avatar only, and read-only. A wallpaper is decoration for its owner and the
 * console has no reason to show it, so it is not reachable through here — which
 * is why this does not simply take a `kind`.
 */
export const getUserAvatar = asyncHandler(async (req, res) => {
  // Guarded, so a malformed id answers "no picture" rather than throwing a
  // CastError out of the query and turning into a 500.
  if (!isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Not set' });

  return sendMedia(res, await Media.findOne({ user: req.params.id, kind: 'avatar' }).lean());
});

export const putMedia = asyncHandler(async (req, res) => {
  const kind = kindOf(req, res);
  if (!kind) return undefined;

  const contentType = req.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    return res.status(415).json({ message: 'Body must be an image' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'Empty image body' });
  }
  if (req.body.length > LIMITS[kind]) {
    return res.status(413).json({
      message: `${kind} must be under ${Math.round(LIMITS[kind] / 1024 / 1024)}MB`,
    });
  }

  await Media.findOneAndUpdate(
    { user: req.user._id, kind },
    { data: req.body, contentType },
    { upsert: true, new: true }
  );

  await record(req, {
    category: 'account',
    action: `media.${kind}_set`,
    targetType: 'user',
    target: req.user._id,
    targetName: req.user.name,
    targetRole: req.user.role,
    summary: `uploaded a new ${kind} (${Math.round(req.body.length / 1024)}KB)`,
  });

  res.json({ kind, bytes: req.body.length });
});

export const deleteMedia = asyncHandler(async (req, res) => {
  const kind = kindOf(req, res);
  if (!kind) return undefined;

  const { deletedCount } = await Media.deleteOne({ user: req.user._id, kind });

  if (deletedCount) {
    await record(req, {
      category: 'account',
      action: `media.${kind}_removed`,
      targetType: 'user',
      target: req.user._id,
      targetName: req.user.name,
      targetRole: req.user.role,
      summary: `removed their ${kind}`,
    });
  }

  res.json({ kind, removed: true });
});
