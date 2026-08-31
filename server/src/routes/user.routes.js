import { Router } from 'express';
import express from 'express';
import {
  listUsers,
  createUser,
  updateProfile,
  changePassword,
  updateUser,
  resetUserPassword,
  deleteUser,
} from '../controllers/user.controller.js';
import { getMedia, getUserAvatar, putMedia, deleteMedia, LIMITS } from '../controllers/media.controller.js';
import { requireAuth, requireAdmin, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.patch('/me', updateProfile);
router.post('/me/password', changePassword);

// Raw binary rather than multipart or base64 — no upload dependency, and no
// 33% size penalty from base64 on a multi-MB wallpaper.
const rawImage = express.raw({ type: 'image/*', limit: Math.max(...Object.values(LIMITS)) });

router.get('/me/media/:kind', getMedia);
router.put('/me/media/:kind', rawImage, putMedia);
router.delete('/me/media/:kind', deleteMedia);

// Below the /me routes, so "me" is never taken for an account id. Audit is
// included because the contribution report lists moderators by face too.
router.get('/:id/media/avatar', requireRole('admin', 'manager', 'audit'), getUserAvatar);

router.get('/', requireAdmin, listUsers);
router.post('/', requireAdmin, createUser);
router.patch('/:id', requireAdmin, updateUser);
router.post('/:id/reset-password', requireAdmin, resetUserPassword);
router.delete('/:id', requireAdmin, deleteUser);

export default router;
