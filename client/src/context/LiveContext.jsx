import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TOKEN_KEY } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const LiveContext = createContext(null);

/*
 * EventSource cannot send an Authorization header, so the stream is read with
 * fetch + a ReadableStream instead. That keeps the existing Bearer auth (no
 * token in the URL, where it would land in logs and history) at the cost of
 * writing the reconnect loop by hand — which is below.
 */
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

export function LiveProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | connecting | live | offline
  const [lastEvent, setLastEvent] = useState(null);

  // A ref, so subscribing does not re-open the stream.
  const listeners = useRef(new Set());

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    if (!user) {
      setStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    let attempt = 0;
    let stopped = false;
    let retryTimer = null;

    const emit = (event) => {
      setLastEvent(event);
      for (const fn of listeners.current) {
        try {
          fn(event);
        } catch (err) {
          console.error('[live] listener failed', err);
        }
      }
    };

    /** Parses the `event:`/`data:` lines of one SSE frame. */
    const handleFrame = (raw) => {
      let name = 'message';
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) continue; // heartbeat comment
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (!data.length) return;
      try {
        emit({ name, ...JSON.parse(data.join('\n')) });
      } catch {
        // A frame we cannot parse is not worth tearing the stream down for.
      }
    };

    async function connect() {
      if (stopped) return;
      setStatus(attempt === 0 ? 'connecting' : 'offline');

      try {
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream refused (${res.status})`);

        setStatus('live');
        attempt = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Frames are separated by a blank line; anything after the last one is
        // a partial frame and stays in the buffer until the rest arrives.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            handleFrame(buffer.slice(0, split));
            buffer = buffer.slice(split + 2);
          }
        }
        throw new Error('stream closed');
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        setStatus('offline');
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retryTimer = setTimeout(connect, wait);
      }
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [user]);

  return (
    <LiveContext.Provider value={{ status, lastEvent, subscribe }}>
      {children}
    </LiveContext.Provider>
  );
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside a LiveProvider');
  return ctx;
}

/**
 * Run `handler` for each incoming event, optionally narrowed to some
 * categories. The handler is held in a ref so callers need not memoise it.
 */
export function useLiveEvent(handler, categories = null) {
  const { subscribe } = useLive();
  const saved = useRef(handler);
  saved.current = handler;

  const key = categories ? categories.join(',') : '*';

  useEffect(
    () =>
      subscribe((event) => {
        if (event.name === 'hello') return;
        if (categories && !categories.includes(event.category)) return;
        saved.current(event);
      }),
    [subscribe, key] // eslint-disable-line react-hooks/exhaustive-deps
  );
}
