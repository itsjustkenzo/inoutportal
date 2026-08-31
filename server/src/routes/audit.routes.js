import { Router } from 'express';
import { listAudit } from '../controllers/audit.controller.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// The trail is read-only and manager-only: nothing may edit or erase it.
router.get('/', requireManager, listAudit);

export default router;
