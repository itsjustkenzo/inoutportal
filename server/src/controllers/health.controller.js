import os from 'node:os';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Entry from '../models/Entry.js';
import Schedule from '../models/Schedule.js';
import Media from '../models/Media.js';
import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../middleware/error.js';

/** Mongoose readyState is an integer; these are its meanings, in order. */
const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

const MB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/** Collections whose size is worth breaking out, largest-first in the UI. */
const TRACKED_COLLECTIONS = ['media', 'entries', 'auditlogs', 'users', 'schedules'];

/**
 * Per-collection storage via $collStats. Wrapped because it needs privileges
 * some deployments withhold, and a refused breakdown must not cost us the
 * headline totals.
 */
async function collectionSizes(db) {
  const rows = [];
  for (const name of TRACKED_COLLECTIONS) {
    try {
      const [stats] = await db
        .collection(name)
        .aggregate([{ $collStats: { storageStats: {} } }])
        .toArray();
      if (!stats) continue;
      const s = stats.storageStats;
      rows.push({
        name,
        documents: s.count,
        dataMb: MB(s.size),
        storageMb: MB(s.storageSize),
        indexMb: MB(s.totalIndexSize),
        totalMb: MB(s.storageSize + s.totalIndexSize),
      });
    } catch {
      // Collection missing or stats not permitted — skip it.
    }
  }
  return rows.sort((a, b) => b.totalMb - a.totalMb);
}

/**
 * Server manager: a live health snapshot. Deliberately tolerant — if the
 * database is down this must still answer, because "the database is down" is
 * exactly the thing it exists to report.
 */
export const serverHealth = asyncHandler(async (req, res) => {
  const conn = mongoose.connection;
  const connected = conn.readyState === 1;

  // Round-trip time to the cluster, which catches a link that is technically
  // open but unusably slow.
  let pingMs = null;
  let error = null;
  if (connected) {
    const started = process.hrtime.bigint();
    try {
      await conn.db.admin().ping();
      pingMs = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10;
    } catch (err) {
      error = err.message;
    }
  }

  let storage = null;
  if (connected && !error) {
    try {
      const s = await conn.db.stats();
      // storageSize is what the data occupies on disk; dataSize is the
      // uncompressed logical size, which is usually the larger number.
      storage = {
        dataMb: MB(s.dataSize),
        storageMb: MB(s.storageSize),
        indexMb: MB(s.indexSize),
        totalMb: MB(s.storageSize + s.indexSize),
        objects: s.objects,
        collections: s.collections,
        avgObjBytes: Math.round(s.avgObjSize || 0),
        // Optional ceiling (an Atlas M0 is 512MB); shown as a usage bar when set.
        limitMb: Number(process.env.DB_STORAGE_LIMIT_MB) || null,
        byCollection: await collectionSizes(conn.db),
      };
    } catch (err) {
      error = err.message;
    }
  }

  let collections = null;
  if (connected && !error) {
    try {
      const [users, entries, schedules, media, logs] = await Promise.all([
        User.estimatedDocumentCount(),
        Entry.estimatedDocumentCount(),
        Schedule.estimatedDocumentCount(),
        Media.estimatedDocumentCount(),
        AuditLog.estimatedDocumentCount(),
      ]);
      collections = { users, entries, schedules, media, logs };
    } catch (err) {
      error = err.message;
    }
  }

  const mem = process.memoryUsage();

  res.json({
    api: {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      node: process.version,
      pid: process.pid,
      hostname: os.hostname(),
      environment: process.env.NODE_ENV || 'development',
      memory: { rssMb: MB(mem.rss), heapUsedMb: MB(mem.heapUsed), heapTotalMb: MB(mem.heapTotal) },
    },
    database: {
      state: DB_STATES[conn.readyState] ?? 'unknown',
      connected,
      host: conn.host || null,
      name: conn.name || null,
      pingMs,
      error,
    },
    collections,
    storage,
    checkedAt: new Date(),
  });
});
