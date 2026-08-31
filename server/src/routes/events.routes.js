import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addClient, removeClient, clientCount } from '../utils/events.js';

const router = Router();

/**
 * Server-sent events. The response is deliberately never ended — it stays open
 * and the server writes frames into it as things happen.
 */
router.get('/', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform stops compression middleware buffering the stream.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx not to buffer, which would otherwise delay every frame.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const id = addClient(res, req.user);

  res.write(`event: hello\ndata: ${JSON.stringify({
    role: req.user.role,
    listeners: clientCount(),
    at: new Date(),
  })}\n\n`);

  // The socket closing is the only reliable signal the client has gone.
  req.on('close', () => removeClient(id));
});

export default router;
