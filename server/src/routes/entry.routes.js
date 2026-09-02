import { Router } from 'express';
import {
  punchIn,
  punchOut,
  board,
  current,
  history,
  overview,
  summary,
  listAllEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  bulkDeleteEntries,
} from '../controllers/entry.controller.js';
import { requireAuth, requireAdmin, requireRole, requireManager } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/in', punchIn);
router.post('/out', punchOut);
router.get('/current', current);
router.get('/board', board);
router.get('/history', history);

router.get('/overview', requireAdmin, overview);
// Audit reads contribution totals for payroll; it still cannot touch entries.
router.get('/summary', requireRole('admin', 'audit', 'manager'), summary);
// Writing attendance by hand is a server-manager power, not an admin one.
// `/all` is declared before the :id routes so it is never read as an id.
router.get('/all', requireManager, listAllEntries);
router.post('/', requireManager, createEntry);
router.patch('/:id', requireManager, updateEntry);
// Above /:id so "bulk-delete" is never taken for a record id.
router.post('/bulk-delete', requireManager, bulkDeleteEntries);
router.delete('/:id', requireManager, deleteEntry);

export default router;
