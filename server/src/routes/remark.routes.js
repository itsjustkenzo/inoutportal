import { Router } from 'express';
import { listRemarks, setRemark } from '../controllers/remark.controller.js';
import { requireAuth, requireAdmin, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Finance reads remarks alongside the hours it is reconciling, but only an
// admin or a manager writes them.
router.get('/', requireRole('admin', 'manager', 'audit'), listRemarks);
router.put('/', requireAdmin, setRemark);

export default router;
