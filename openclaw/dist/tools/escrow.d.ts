/**
 * Escrow tools (20 tools)
 * Reads: xpr_get_job, xpr_list_jobs, xpr_list_open_jobs, xpr_get_milestones,
 *        xpr_get_job_dispute, xpr_list_arbitrators, xpr_list_bids
 * Writes: xpr_create_job, xpr_fund_job, xpr_accept_job, xpr_start_job,
 *         xpr_deliver_job, xpr_approve_delivery, xpr_raise_dispute,
 *         xpr_submit_milestone, xpr_arbitrate, xpr_resolve_timeout,
 *         xpr_submit_bid, xpr_select_bid, xpr_withdraw_bid
 */
import type { PluginApi, PluginConfig } from '../types';
export declare function registerEscrowTools(api: PluginApi, config: PluginConfig): void;
//# sourceMappingURL=escrow.d.ts.map