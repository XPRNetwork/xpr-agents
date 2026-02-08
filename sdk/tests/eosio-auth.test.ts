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

describe('eosio-auth', () => {
  describe('createA2ADigest', () => {
    it('produces a deterministic hex digest', () => {
      const digest = createA2ADigest('alice', 1704067200, 'abc123');
      expect(typeof digest).toBe('string');
      expect(digest.length).toBe(64); // SHA256 hex = 64 chars

      // Same inputs → same output
      const digest2 = createA2ADigest('alice', 1704067200, 'abc123');
      expect(digest2).toBe(digest);
    });

    it('different inputs produce different digests', () => {
      const d1 = createA2ADigest('alice', 1704067200, 'abc');
      const d2 = createA2ADigest('bob', 1704067200, 'abc');
      const d3 = createA2ADigest('alice', 1704067201, 'abc');
      expect(d1).not.toBe(d2);
      expect(d1).not.toBe(d3);
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

    it('sign → recover yields the same public key', () => {
      const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
      const signature = signA2ARequest(wif, account, timestamp, bodyHash);

      expect(signature).toMatch(/^SIG_K1_/);

      const recovered = recoverA2APublicKey(signature, account, timestamp, bodyHash);
      expect(recovered).toBe(publicKey);
    });

    it('wrong account during recovery yields different key', () => {
      const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
      const signature = signA2ARequest(wif, account, timestamp, bodyHash);

      // Recover with wrong account → digest differs → different key
      const recovered = recoverA2APublicKey(signature, 'bob', timestamp, bodyHash);
      expect(recovered).not.toBe(publicKey);
    });

    it('wrong timestamp during recovery yields different key', () => {
      const wif = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
      const signature = signA2ARequest(wif, account, timestamp, bodyHash);

      const recovered = recoverA2APublicKey(signature, account, timestamp + 1, bodyHash);
      expect(recovered).not.toBe(publicKey);
    });

    it('throws on invalid private key', () => {
      expect(() => signA2ARequest('invalid-key', account, timestamp, bodyHash))
        .toThrow();
    });

    it('throws on invalid signature string', () => {
      expect(() => recoverA2APublicKey('invalid-sig', account, timestamp, bodyHash))
        .toThrow();
    });
  });
});
