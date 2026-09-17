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

/**
 * Resolve a URL's host and confirm every address it maps to is public.
 *
 * Validated at request time (not registration), so DNS rebinding — a hostname that
 * passed a string check but now resolves to an internal address — is caught. Callers
 * must also refuse redirects, since a public host can 302 to a private one.
 */
export async function isPublicHttpUrl(urlStr: string): Promise<boolean> {
  let host: string;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname;
  } catch {
    return false;
  }
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every(a => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}
