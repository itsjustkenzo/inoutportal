import 'dotenv/config';
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

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
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
