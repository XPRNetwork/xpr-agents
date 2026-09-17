import { describe, it, expect } from 'vitest';
import { isReadonlyToolName, READONLY_PREFIX_WRITE_EXCEPTIONS } from '../src/a2a-tools';

/**
 * The A2A read-only allowlist is prefix-based, so a mutating tool whose name
 * matches a read prefix would leak into the "readonly" set exposed to A2A peers.
 * These lock in the known exceptions and the general shape.
 */
describe('isReadonlyToolName', () => {
  it('excludes mutating tools that match a read prefix', () => {
    // xpr_list_service = listsvc (write); nft_list_for_sale = announcesale+createoffer
    expect(isReadonlyToolName('xpr_list_service')).toBe(false);
    expect(isReadonlyToolName('nft_list_for_sale')).toBe(false);
    expect(READONLY_PREFIX_WRITE_EXCEPTIONS.has('xpr_list_service')).toBe(true);
    expect(READONLY_PREFIX_WRITE_EXCEPTIONS.has('nft_list_for_sale')).toBe(true);
  });

  it('allows genuine read tools, including the confusingly-similar plural', () => {
    for (const n of [
      'xpr_get_job', 'xpr_list_jobs', 'xpr_list_services', 'xpr_search_agents',
      'xpr_indexer_health', 'defi_get_price', 'defi_list_pools',
      'nft_get_asset', 'nft_list_assets', 'nft_search_assets',
      'loan_get_market', 'gov_list_proposals', 'xmd_list_collateral',
      'sc_get_abi', 'sc_read_table', 'shell_list_posts', 'shell_get_profile', 'tax_estimate',
    ]) {
      expect(isReadonlyToolName(n), n).toBe(true);
    }
  });

  it('rejects obvious write tools', () => {
    for (const n of [
      'xpr_deliver_job', 'xpr_submit_bid', 'xpr_transfer', 'xpr_accept_job',
      'nft_transfer', 'nft_mint', 'defi_swap', 'store_deliverable', 'execute_js',
    ]) {
      expect(isReadonlyToolName(n), n).toBe(false);
    }
  });
});
