/**
 * SSRF guard for skill fetches.
 *
 * These fetches are steered by agent/job-controlled URLs, and the runner sits
 * inside a private network with cloud metadata and internal services reachable.
 * Resolve the host and refuse any loopback / private / link-local / ULA / CGNAT /
 * metadata address, and follow redirects MANUALLY so a public host that
 * 3xx-redirects to an internal one is re-validated at every hop.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for loopback, private, link-local, ULA, CGNAT, multicast and unparseable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
    const [a, b] = p;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||               // link-local + cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||     // CGNAT
      a >= 224                                    // multicast / reserved
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('::ffff:');
  }
  return true;
}

/** Resolve a URL's host and throw unless every address it maps to is public http(s). */
export async function assertPublicUrl(urlStr: string): Promise<void> {
  let host: string;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`Blocked non-http(s) URL: ${u.protocol}`);
    }
    host = u.hostname;
  } catch (e) {
    throw new Error(`Blocked invalid URL: ${(e as Error).message}`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Blocked private address: ${host}`);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`Blocked host that does not resolve: ${host}`);
  }
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) {
    throw new Error(`Blocked host resolving to a private address: ${host}`);
  }
}

/**
 * fetch() with an SSRF guard on every hop. Redirects are followed manually (up to
 * maxRedirects) so each Location is re-validated — a public host cannot 302 to an
 * internal one. Throws if a hop targets a private address or the redirect chain is
 * too long.
 */
export async function guardedFetch(url: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const resp = await fetch(current, { ...init, redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      current = new URL(loc, current).toString();
      continue;
    }
    return resp;
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}
