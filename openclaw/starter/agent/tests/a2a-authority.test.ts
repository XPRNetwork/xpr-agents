import { describe, it, expect } from 'vitest';
import { parseAuthPermissions, isKeyAuthorized } from '../src/a2a-auth';

/**
 * A2A authority-threshold handling (audit round 2, codex #7). A2A auth is a single
 * signature, so it may authenticate an account only if the recovered key satisfies a
 * permission's threshold ON ITS OWN. Previously any key under `active` was accepted
 * regardless of weight/threshold (a lone key of a multisig could impersonate the whole
 * account) and the documented isolated `a2a` permission was never consulted.
 */

const K1 = 'PUB_K1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const K2 = 'PUB_K1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
const KA = 'PUB_K1_ccccccccccccccccccccccccccccccccccccccccccccccccc3';

const perm = (perm_name: string, threshold: number, keys: Array<[string, number]>) => ({
  perm_name,
  required_auth: { threshold, keys: keys.map(([key, weight]) => ({ key, weight })), accounts: [], waits: [] },
});

describe('parseAuthPermissions + isKeyAuthorized', () => {
  it('authorizes a normal single-key active account', () => {
    const perms = parseAuthPermissions([perm('active', 1, [[K1, 1]]), perm('owner', 1, [[K2, 1]])]);
    expect(isKeyAuthorized(perms, K1)).to.equal(true);
    expect(isKeyAuthorized(perms, K2)).to.equal(false); // owner is not an accepted A2A permission
  });

  it('rejects a lone key of a 2-of-2 multisig active account (weight below threshold)', () => {
    const perms = parseAuthPermissions([perm('active', 2, [[K1, 1], [K2, 1]])]);
    expect(isKeyAuthorized(perms, K1)).to.equal(false);
    expect(isKeyAuthorized(perms, K2)).to.equal(false);
  });

  it('authorizes a key that meets the threshold alone in a weighted multisig', () => {
    // K1 weight 2 meets threshold 2 by itself; K2 weight 1 does not.
    const perms = parseAuthPermissions([perm('active', 2, [[K1, 2], [K2, 1]])]);
    expect(isKeyAuthorized(perms, K1)).to.equal(true);
    expect(isKeyAuthorized(perms, K2)).to.equal(false);
  });

  it('honors the documented isolated a2a permission', () => {
    const perms = parseAuthPermissions([perm('active', 1, [[K1, 1]]), perm('a2a', 1, [[KA, 1]])]);
    expect(isKeyAuthorized(perms, KA)).to.equal(true); // isolated signing key works
    expect(isKeyAuthorized(perms, K1)).to.equal(true); // active still works
    expect(parseAuthPermissions([]).length).to.equal(0);
  });

  it('ignores non-accepted permissions (owner, custom)', () => {
    const perms = parseAuthPermissions([perm('owner', 1, [[K1, 1]]), perm('custom', 1, [[K2, 1]])]);
    expect(perms.length).to.equal(0);
    expect(isKeyAuthorized(perms, K1)).to.equal(false);
  });

  it('defaults a missing/zero threshold to 1', () => {
    const perms = parseAuthPermissions([{ perm_name: 'active', required_auth: { keys: [{ key: K1, weight: 1 }] } }]);
    expect(perms[0].threshold).to.equal(1);
    expect(isKeyAuthorized(perms, K1)).to.equal(true);
  });
});
