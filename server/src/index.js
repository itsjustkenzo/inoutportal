import 'dotenv/config';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';

import { ensureUsableDnsServers } from './config/dns.js';
import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import entryRoutes from './routes/entry.routes.js';
import userRoutes from './routes/user.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import auditRoutes from './routes/audit.routes.js';
import healthRoutes from './routes/health.routes.js';
import eventRoutes from './routes/events.routes.js';
import dbImportRoutes from './routes/dbimport.routes.js';

const app = express();
const PORT = process.env.PORT || 5000;

/*
 * Hosts like Render terminate TLS at a proxy and pass the caller on in
 * X-Forwarded-For. Without this the login rate limiter would see the proxy's
 * address for everyone — one person hitting the limit would lock out the rest.
 */
if (process.env.TRUST_PROXY !== 'false') app.set('trust proxy', 1);

/*
 * A frontend hosted elsewhere calls this API cross-origin, so its address has to
 * be named explicitly. CLIENT_ORIGIN takes a comma-separated list, which is what
 * lets a production URL and a preview URL both be allowed.
 *
 * An unlisted origin gets no CORS header rather than an error: the browser then
 * blocks it as a CORS failure, which is what a developer expects to see, instead
 * of a 500 that looks like the API is broken.
 */
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // No Origin header at all: a same-origin page, curl, or a health check.
      cb(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  })
);
/*
 * Mounted before express.json: an import arrives as a raw body, and the JSON
 * parser would otherwise consume it (and reject anything over its 100kb cap).
 */
app.use('/api/db/import', dbImportRoutes);

app.use(express.json({ limit: '100kb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' })
);

app.use('/api/auth', authRoutes);
app.use('/api/entries', entryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/server-health', healthRoutes);
app.use('/api/events', eventRoutes);

/*
 * In a deployed build this same server hands out the compiled client, so the
 * browser calls /api on its own origin. That is what the client expects — it
 * uses a relative baseURL, and the live event stream does too — and it means
 * there is no cross-origin hop to configure for either.
 *
 * Skipped when client/dist is absent, which is the case in development: there
 * Vite serves the client on :5173 and proxies /api here.
 */
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));

  // Every other GET is a client-side route, so React Router gets index.html and
  // works it out. Anything under /api falls through to notFound instead, so a
  // mistyped endpoint still answers JSON rather than a page.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(fileURLToPath(new URL('../../client/dist/index.html', import.meta.url)));
  });
}

app.use(notFound);
app.use(errorHandler);

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('Missing MONGO_URI or JWT_SECRET. Copy server/.env.example to server/.env first.');
  process.exit(1);
}

ensureUsableDnsServers();

connectDB(process.env.MONGO_URI)
  .then(() => {
    const server = app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

    const shutdown = async () => {
      server.close();
      await mongoose.connection.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

export default app;
