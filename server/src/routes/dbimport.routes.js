import { Router } from 'express';
import express from 'express';
import { previewImport, commitImport, discardImport } from '../controllers/dbimport.controller.js';
import { requireAuth, requireManager } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireManager);

// Dumps arrive as a raw body rather than multipart — no upload dependency, and
// the parsers want the text anyway. 12MB covers a sizeable export.
const rawDump = express.text({
  type: ['text/plain', 'application/json', 'application/sql', 'application/octet-stream'],
  limit: '12mb',
});

router.post('/preview', rawDump, previewImport);
// This router sits ahead of the app-wide JSON parser, so commit brings its own.
router.post('/commit', express.json({ limit: '1mb' }), commitImport);
router.delete('/:id', discardImport);

export default router;
