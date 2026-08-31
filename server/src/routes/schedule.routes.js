import { Router } from 'express';
import { listSchedules, upsertSchedule, deleteSchedule } from '../controllers/schedule.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// The roster is an admin concern. Audit sees payroll totals, not scheduling.
router.get('/', requireAdmin, listSchedules);
router.put('/:userId', requireAdmin, upsertSchedule);
router.delete('/:userId', requireAdmin, deleteSchedule);

export default router;
