import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicHttpUrl } from '../src/util/ssrf';

/**
 * A2A discovery fetches an agent's on-chain endpoint, which anyone can set to an
 * internal address. resolveEndpoint() calls assertPublicHttpUrl before any fetch.
 */
describe('A2A discovery SSRF guard', () => {
  it('flags private/loopback/metadata/NAT64 addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '64:ff9b::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('rejects a non-http scheme, a private IP literal, and a bad URL', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://127.0.0.1:8080/a2a')).rejects.toThrow(/non-public/);
    await expect(assertPublicHttpUrl('http://169.254.169.254/')).rejects.toThrow(/non-public/);
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/invalid/);
    await expect(assertPublicHttpUrl('https://[::1]/a2a')).rejects.toThrow();
  });

  it('accepts a public IP literal endpoint', async () => {
    await expect(assertPublicHttpUrl('https://1.1.1.1/.well-known/agent.json')).resolves.toBeUndefined();
  });
});
