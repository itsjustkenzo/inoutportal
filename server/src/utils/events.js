import { randomUUID } from 'node:crypto';

/**
 * In-process registry of open SSE connections.
 *
 * The API is the only writer to this database, so events are emitted directly
 * from the controllers rather than watched off a change stream — simpler, and
 * it does not tie the app to a replica set.
 */
const clients = new Map();

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 25000;

/** Who may receive each category of event. */
export const AUDIENCE = {
  attendance: ['admin', 'manager'],
  account: ['admin', 'manager'],
  schedule: ['admin', 'manager'],
  security: ['manager'],
};

function frame(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function addClient(res, user) {
  const id = randomUUID();
  clients.set(id, { res, role: user.role, userId: String(user._id) });
  return id;
}

export function removeClient(id) {
  clients.delete(id);
}

export function clientCount() {
  return clients.size;
}

/**
 * Fan an event out to every connection allowed to see it.
 *
 * `roles` restricts by role; `userId` restricts to one person's own connections
 * (so a moderator can be told about their own record being corrected without
 * being told about anyone else's).
 */
export function publish(event, data, { roles = null, userId = null } = {}) {
  for (const [id, client] of clients) {
    if (roles && !roles.includes(client.role)) continue;
    if (userId && client.userId !== String(userId)) continue;
    try {
      frame(client.res, event, data);
    } catch {
      // Write failed — the peer is gone.
      clients.delete(id);
    }
  }
}

// unref so an idle heartbeat never holds the process open on shutdown.
setInterval(() => {
  for (const [id, client] of clients) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      clients.delete(id);
    }
  }
}, HEARTBEAT_MS).unref();
