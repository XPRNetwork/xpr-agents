/**
 * Agent Core tools (11 tools)
 * Reads: xpr_get_agent, xpr_list_agents, xpr_get_trust_score,
 *        xpr_get_agent_plugins, xpr_list_plugins, xpr_get_core_config
 * Writes: xpr_register_agent, xpr_update_agent, xpr_set_agent_status,
 *         xpr_manage_plugin, xpr_approve_claim
 */
import type { PluginApi, PluginConfig } from '../types';
export declare function registerAgentTools(api: PluginApi, config: PluginConfig): void;
//# sourceMappingURL=agent.d.ts.map