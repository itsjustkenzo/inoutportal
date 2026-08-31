import dns from 'dns';

/*
 * Workaround for Node's bundled c-ares resolver failing to read the Windows DNS
 * configuration: dns.getServers() comes back as ['127.0.0.1'] even when the
 * adapter is correctly pointed at a real server. Nothing listens on loopback, so
 * every SRV lookup fails with ECONNREFUSED and `mongodb+srv://` URIs cannot
 * resolve. Plain `mongodb://` URIs are unaffected — they use getaddrinfo.
 *
 * Only applied when the resolver is visibly broken, so a healthy host (CI, a
 * Linux container, production) keeps using its own DNS untouched.
 */
const FALLBACK = ['8.8.8.8', '8.8.4.4'];

export function ensureUsableDnsServers() {
  let servers = [];
  try {
    servers = dns.getServers();
  } catch {
    servers = [];
  }

  const broken = servers.length === 0 || servers.every((s) => s === '127.0.0.1' || s === '::1');
  if (!broken) return null;

  dns.setServers(FALLBACK);
  console.warn(`DNS resolver reported [${servers.join(', ') || 'none'}]; falling back to ${FALLBACK.join(', ')}`);
  return FALLBACK;
}
