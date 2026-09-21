/**
 * EOSIO signature authentication utilities for A2A requests.
 *
 * Signing (caller side):
 *   digest = SHA256(account + "\n" + timestamp + "\n" + audience + "\n" + chainId + "\n" + SHA256(requestBody))
 *   signature = PrivateKey.sign(digest)
 *
 * Verification (server side):
 *   Recover public key from signature + digest, compare against on-chain keys.
 *
 * `audience` (the recipient agent's account) and `chainId` (the network) are bound
 * into the digest so a signature made for one server on one network cannot be
 * replayed by a malicious recipient to a DIFFERENT server, or across networks
 * (audit round 2, codex #8). Both sides derive these independently: the caller from
 * the target it is sending to, the server from its own account + chain.
 */

import { Key, sha256 } from '@proton/js';

/**
 * Create the digest that is signed for A2A authentication.
 *
 * Format: SHA256(account + "\n" + timestamp + "\n" + audience + "\n" + chainId + "\n" + bodyHash)
 * where bodyHash = SHA256(requestBody), audience = recipient account, chainId = network chain id.
 */
export function createA2ADigest(
  account: string,
  timestamp: number,
  bodyHash: string,
  audience: string,
  chainId: string,
): string {
  const preimage = `${account}\n${timestamp}\n${audience}\n${chainId}\n${bodyHash}`;
  return sha256(preimage);
}

/**
 * Hash a request body for use in A2A authentication.
 */
export function hashBody(body: string): string {
  return sha256(body);
}

/**
 * Sign an A2A request.
 *
 * @param privateKeyWif - WIF-encoded private key (e.g. "5K...")
 * @param account - XPR account name of the signer
 * @param timestamp - Unix timestamp (seconds)
 * @param bodyHash - SHA256 hash of the request body
 * @returns SIG_K1_... signature string
 */
export function signA2ARequest(
  privateKeyWif: string,
  account: string,
  timestamp: number,
  bodyHash: string,
  audience: string,
  chainId: string,
): string {
  const digest = createA2ADigest(account, timestamp, bodyHash, audience, chainId);
  const privateKey = Key.PrivateKey.fromString(privateKeyWif);
  const signature = privateKey.sign(Buffer.from(digest, 'hex'));
  return signature.toString();
}

/**
 * Recover the public key from a signed A2A request.
 *
 * @param signature - SIG_K1_... signature string
 * @param account - XPR account name claimed by the signer
 * @param timestamp - Unix timestamp from the request
 * @param bodyHash - SHA256 hash of the request body
 * @returns PUB_K1_... public key string
 */
export function recoverA2APublicKey(
  signature: string,
  account: string,
  timestamp: number,
  bodyHash: string,
  audience: string,
  chainId: string,
): string {
  const digest = createA2ADigest(account, timestamp, bodyHash, audience, chainId);
  const sig = Key.Signature.fromString(signature);
  const publicKey = sig.recover(Buffer.from(digest, 'hex'));
  return publicKey.toString();
}
