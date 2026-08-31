import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, try again later' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', requireAuth, me);

export default router;
