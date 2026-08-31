import { Router } from 'express';
import { serverHealth } from '../controllers/health.controller.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

const router = Router();

// Infrastructure detail — host names, pid, memory — is server-manager only.
router.get('/', requireAuth, requireManager, serverHealth);

export default router;
