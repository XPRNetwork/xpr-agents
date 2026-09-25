import { describe, it, expect, afterEach } from 'vitest';
import { assertTrustedArbitrator, trustedArbitrators } from '../src/tools/escrow';

// #92: a client colluding with the arbitrator it named can rule the escrow back after
// delivery. Agents only accept or bid under no arbitrator or a trusted one.
describe('trusted arbitrator guard (xpr_accept_job / xpr_submit_bid)', () => {
  const saved = process.env.TRUSTED_ARBITRATORS;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUSTED_ARBITRATORS;
    else process.env.TRUSTED_ARBITRATORS = saved;
  });

  it('accepts jobs with no arbitrator (owner fallback)', () => {
    expect(() => assertTrustedArbitrator({ id: 1, arbitrator: '' }, 1)).not.toThrow();
  });

  it('defaults to trusting protonnz only', () => {
    delete process.env.TRUSTED_ARBITRATORS;
    expect(trustedArbitrators()).toEqual(['protonnz']);
    expect(() => assertTrustedArbitrator({ id: 1, arbitrator: 'protonnz' }, 1)).not.toThrow();
    expect(() => assertTrustedArbitrator({ id: 1, arbitrator: 'secuattack2' }, 1)).toThrow(/not in TRUSTED_ARBITRATORS/);
  });

  it('honors an operator list', () => {
    process.env.TRUSTED_ARBITRATORS = 'magicguy, protonnz';
    expect(() => assertTrustedArbitrator({ id: 1, arbitrator: 'magicguy' }, 1)).not.toThrow();
    process.env.TRUSTED_ARBITRATORS = '';
    expect(() => assertTrustedArbitrator({ id: 1, arbitrator: 'protonnz' }, 1)).toThrow();
  });

  it('refuses a job it cannot read', () => {
    expect(() => assertTrustedArbitrator(null, 7)).toThrow(/not found/);
  });
});
