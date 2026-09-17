import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateAddress, assertPublicUrl, guardedFetch } from '../skills/web-scraping/src/ssrf';

/**
 * SSRF guard for skill fetches (web-scraping + creative share this module).
 * The web-scraping and creative skills fetch agent/job-controlled URLs from
 * inside a private network, so the guard must refuse internal targets and
 * re-validate every redirect hop.
 */
describe('isPrivateAddress', () => {
  it('flags IPv4 loopback / private / link-local / CGNAT / metadata', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public IPv4', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it('flags IPv6 loopback / ULA / link-local / mapped', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('refuses non-IP strings', () => {
    expect(isPrivateAddress('nope')).toBe(true);
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('ftp://example.com')).rejects.toThrow();
  });
  it('rejects private IP literals without DNS', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/')).rejects.toThrow();
    await expect(assertPublicUrl('https://[::1]/x')).rejects.toThrow();
  });
  it('accepts a public IP literal', async () => {
    await expect(assertPublicUrl('https://1.1.1.1/x')).resolves.toBeUndefined();
  });
});

describe('guardedFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches a public IP host with redirect:manual', async () => {
    const spy = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', spy);
    const res: any = await guardedFetch('https://1.1.1.1/ok');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].redirect).toBe('manual');
  });

  it('refuses to follow a redirect into a private address', async () => {
    // Public host 302s to the cloud metadata endpoint; the second hop must be
    // re-validated and rejected before any fetch to it.
    const spy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
    });
    vi.stubGlobal('fetch', spy);
    await expect(guardedFetch('https://1.1.1.1/redir')).rejects.toThrow(/private address/i);
    expect(spy).toHaveBeenCalledTimes(1); // only the first hop was fetched
  });

  it('never fetches a private target at all', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(guardedFetch('http://192.168.0.9/hook')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives up after too many redirects', async () => {
    // Always redirects to another public IP → exhausts the hop budget.
    const spy = vi.fn().mockResolvedValue({
      status: 301,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://8.8.8.8/next' : null) },
    });
    vi.stubGlobal('fetch', spy);
    await expect(guardedFetch('https://1.1.1.1/loop', {}, 2)).rejects.toThrow(/too many redirects/i);
  });
});
