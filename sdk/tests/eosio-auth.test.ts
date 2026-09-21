import { Key, sha256 } from '@proton/js';
import {
  createA2ADigest,
  hashBody,
  signA2ARequest,
  recoverA2APublicKey,
} from '../src/eosio-auth';

// Generate a fresh keypair for tests
const privateKey = Key.PrivateKey.fromString('5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3');
const publicKey = privateKey.getPublicKey().toString();

// Audience (recipient account) and chain id are bound into the digest (codex #8).
const AUD = 'bob';                                 // recipient agent account
const CHAIN = '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0'; // a chain id

describe('eosio-auth', () => {
  describe('createA2ADigest', () => {
    it('produces a deterministic hex digest', () => {
      const digest = createA2ADigest('alice', 1704067200, 'abc123', AUD, CHAIN);
      expect(typeof digest).toBe('string');
      expect(digest.length).toBe(64); // SHA256 hex = 64 chars

      // Same inputs → same output
      const digest2 = createA2ADigest('alice', 1704067200, 'abc123', AUD, CHAIN);
      expect(digest2).toBe(digest);
    });

    it('different inputs produce different digests', () => {
      const d1 = createA2ADigest('alice', 1704067200, 'abc', AUD, CHAIN);
      const d2 = createA2ADigest('bob', 1704067200, 'abc', AUD, CHAIN);
      const d3 = createA2ADigest('alice', 1704067201, 'abc', AUD, CHAIN);
      expect(d1).not.toBe(d2);
      expect(d1).not.toBe(d3);
    });

    it('different audience or chain id produce different digests (replay binding)', () => {
      const base = createA2ADigest('alice', 1704067200, 'abc', AUD, CHAIN);
      const otherAud = createA2ADigest('alice', 1704067200, 'abc', 'carol', CHAIN);
      const otherChain = createA2ADigest('alice', 1704067200, 'abc', AUD, 'deadbeef');
      expect(otherAud).not.toBe(base);
      expect(otherChain).not.toBe(base);
    });
  });

  describe('hashBody', () => {
    it('returns SHA256 hex hash', () => {
      const hash = hashBody('{"jsonrpc":"2.0"}');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('is deterministic', () => {
      const body = '{"test":true}';
      expect(hashBody(body)).toBe(hashBody(body));
    });
  });

  describe('signA2ARequest / recoverA2APublicKey round-trip', () => {
    const account = 'alice';
    const timestamp = 1704067200;
    const bodyHash = sha256('{"jsonrpc":"2.0","method":"message/send"}');
    const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';

    it('sign → recover yields the same public key', () => {
      const signature = signA2ARequest(wif, account, timestamp, bodyHash, AUD, CHAIN);
      expect(signature).toMatch(/^SIG_K1_/);
      const recovered = recoverA2APublicKey(signature, account, timestamp, bodyHash, AUD, CHAIN);
      expect(recovered).toBe(publicKey);
    });

    it('wrong account during recovery yields different key', () => {
      const signature = signA2ARequest(wif, account, timestamp, bodyHash, AUD, CHAIN);
      const recovered = recoverA2APublicKey(signature, 'bob', timestamp, bodyHash, AUD, CHAIN);
      expect(recovered).not.toBe(publicKey);
    });

    it('wrong timestamp during recovery yields different key', () => {
      const signature = signA2ARequest(wif, account, timestamp, bodyHash, AUD, CHAIN);
      const recovered = recoverA2APublicKey(signature, account, timestamp + 1, bodyHash, AUD, CHAIN);
      expect(recovered).not.toBe(publicKey);
    });

    it('CROSS-RECIPIENT replay: a signature for one audience does not verify for another (codex #8)', () => {
      // Alice signs a request destined for `bob`. A malicious `bob` forwards the same
      // body + headers to `carol`'s server, which verifies with audience=carol.
      const signature = signA2ARequest(wif, account, timestamp, bodyHash, 'bob', CHAIN);
      const recoveredAtCarol = recoverA2APublicKey(signature, account, timestamp, bodyHash, 'carol', CHAIN);
      expect(recoveredAtCarol).not.toBe(publicKey); // carol's server rejects (key mismatch)
      // Sanity: it still verifies at the intended recipient.
      expect(recoverA2APublicKey(signature, account, timestamp, bodyHash, 'bob', CHAIN)).toBe(publicKey);
    });

    it('CROSS-NETWORK replay: a signature for one chain does not verify on another (codex #8)', () => {
      const signature = signA2ARequest(wif, account, timestamp, bodyHash, AUD, CHAIN);
      const recoveredOtherChain = recoverA2APublicKey(signature, account, timestamp, bodyHash, AUD, 'a'.repeat(64));
      expect(recoveredOtherChain).not.toBe(publicKey);
    });

    it('throws on invalid private key', () => {
      expect(() => signA2ARequest('invalid-key', account, timestamp, bodyHash, AUD, CHAIN)).toThrow();
    });

    it('throws on invalid signature string', () => {
      expect(() => recoverA2APublicKey('invalid-sig', account, timestamp, bodyHash, AUD, CHAIN)).toThrow();
    });
  });
});
