import { describe, it, expect } from 'vitest';
import { isPrivateAddress, isPublicHttpUrl } from '../src/net-guard';

describe('isPrivateAddress', () => {
  it('flags IPv4 loopback, private, link-local, CGNAT and metadata ranges', () => {
    for (const ip of [
      '127.0.0.1', '127.5.5.5', '10.0.0.1', '10.255.255.255',
      '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '169.254.169.254',           // cloud metadata / link-local
      '100.64.0.1', '100.127.255.255', // CGNAT
      '0.0.0.0', '224.0.0.1', '255.255.255.255',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('flags IPv6 loopback, ULA, link-local and mapped addresses', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows a public IPv6 address', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('refuses anything that is not a valid IP', () => {
    for (const s of ['', 'not-an-ip', '999.1.1.1', '10.0.0']) {
      expect(isPrivateAddress(s), s).toBe(true);
    }
  });
});

describe('isPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    expect(await isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicHttpUrl('ftp://example.com')).toBe(false);
    expect(await isPublicHttpUrl('gopher://example.com')).toBe(false);
  });

  it('rejects a private IP literal without any DNS lookup', async () => {
    expect(await isPublicHttpUrl('http://127.0.0.1/x')).toBe(false);
    expect(await isPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(await isPublicHttpUrl('https://[::1]/x')).toBe(false);
    expect(await isPublicHttpUrl('http://192.168.0.5:8080/hook')).toBe(false);
  });

  it('accepts a public IP literal', async () => {
    expect(await isPublicHttpUrl('https://1.1.1.1/hook')).toBe(true);
  });

  it('rejects a malformed URL', async () => {
    expect(await isPublicHttpUrl('http://')).toBe(false);
    expect(await isPublicHttpUrl('not a url')).toBe(false);
  });

  it('rejects a hostname that does not resolve', async () => {
    expect(await isPublicHttpUrl('https://this-host-does-not-exist.invalid/x')).toBe(false);
  });
});
