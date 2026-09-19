/**
 * SSRF guard for outbound A2A discovery/calls.
 *
 * An agent's A2A endpoint is attacker-controlled: anyone can register an agent
 * on-chain with `endpoint: "http://127.0.0.1:port"` or a public host that
 * redirects to an internal one, and the on-chain check only validates the URL
 * scheme/length. Discovering such an agent makes this process fetch the internal
 * target. Resolve the host and refuse any private/loopback/link-local/ULA/CGNAT/
 * metadata address before we hand the endpoint to the A2A client.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
    const [a, b, c] = p;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return (
      s === '::1' || s === '::' ||
      s.startsWith('::ffff:') ||
      s.startsWith('64:ff9b') ||
      /^fe[89a-f]/.test(s) ||
      s.startsWith('fc') || s.startsWith('fd')
    );
  }
  return true;
}

/** Throw unless `urlStr` is an http(s) URL whose host resolves only to public addresses. */
export async function assertPublicHttpUrl(urlStr: string): Promise<void> {
  let host: string;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`endpoint must be http(s), got ${u.protocol}`);
    }
    host = u.hostname;
  } catch (e) {
    throw new Error(`invalid endpoint URL: ${(e as Error).message}`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`endpoint resolves to a non-public address: ${host}`);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`endpoint host does not resolve: ${host}`);
  }
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) {
    throw new Error(`endpoint host resolves to a non-public address: ${host}`);
  }
}
