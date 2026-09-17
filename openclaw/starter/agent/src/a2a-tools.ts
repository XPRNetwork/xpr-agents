/**
 * Which tool names are safe to expose to A2A peers in read-only mode.
 *
 * SECURITY: this is the allowlist that gates inbound A2A callers away from
 * mutating on-chain tools. It is prefix-based, so a few MUTATING tools whose names
 * happen to match a read prefix must be excluded explicitly — otherwise they leak
 * into the "readonly" set. Kept pure and separate from index.ts so it is unit
 * tested (a2a-tools.test.ts).
 */

/** Mutating tools whose names match a read prefix and must never be read-only. */
export const READONLY_PREFIX_WRITE_EXCEPTIONS = new Set<string>([
  'xpr_list_service',   // listsvc — publishes a service listing
  'nft_list_for_sale',  // announcesale + createoffer — lists an NFT for sale
]);

const READONLY_PREFIXES = [
  'xpr_get_', 'xpr_list_', 'xpr_search_',
  'defi_get_', 'defi_list_',
  'nft_get_', 'nft_list_', 'nft_search_',
  'tax_',
  'loan_list_', 'loan_get_',
  'gov_list_', 'gov_get_',
  'xmd_get_', 'xmd_list_',
  'sc_get_',
  'shell_list_',
];

const READONLY_EXACT = new Set<string>([
  'xpr_indexer_health',
  'sc_read_table',
  'shell_get_comments', 'shell_search', 'shell_get_profile',
]);

export function isReadonlyToolName(name: string): boolean {
  if (READONLY_PREFIX_WRITE_EXCEPTIONS.has(name)) return false;
  if (READONLY_EXACT.has(name)) return true;
  return READONLY_PREFIXES.some(p => name.startsWith(p));
}
