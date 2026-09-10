/**
 * Escrow tools (37 tools)
 * Reads: xpr_get_job, xpr_list_jobs, xpr_list_open_jobs, xpr_get_milestones,
 *        xpr_get_job_dispute, xpr_list_arbitrators, xpr_list_bids,
 *        xpr_get_job_messages, xpr_get_service, xpr_list_services,
 *        xpr_get_service_input
 * Writes: xpr_create_job, xpr_fund_job, xpr_accept_job, xpr_start_job,
 *         xpr_deliver_job, xpr_deliver_job_nft, xpr_revise_job,
 *         xpr_approve_delivery, xpr_raise_dispute,
 *         xpr_claim_timeout, xpr_cancel_job, xpr_agent_cancel_job,
 *         xpr_submit_milestone, xpr_arbitrate, xpr_resolve_timeout,
 *         xpr_submit_bid, xpr_select_bid, xpr_withdraw_bid,
 *         xpr_ask_client, xpr_answer_agent,
 *         xpr_list_service, xpr_update_service, xpr_delist_service,
 *         xpr_relist_service, xpr_set_service_input,
 *         xpr_buy_service, xpr_boost_service
 */
import type { PluginApi, PluginConfig } from '../types';
export declare function registerEscrowTools(api: PluginApi, config: PluginConfig): void;
//# sourceMappingURL=escrow.d.ts.map