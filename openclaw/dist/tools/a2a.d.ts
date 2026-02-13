/**
 * A2A (Agent-to-Agent) tools (5 tools)
 *
 * xpr_a2a_discover   — Look up agent on-chain, fetch their Agent Card
 * xpr_a2a_send_message — Send A2A message to remote agent
 * xpr_a2a_get_task    — Get task status from remote agent
 * xpr_a2a_cancel_task — Cancel running task on remote agent
 * xpr_a2a_delegate_job — High-level: delegate job context to another agent
 */
import type { PluginApi, PluginConfig } from '../types';
export declare function registerA2ATools(api: PluginApi, config: PluginConfig): void;
//# sourceMappingURL=a2a.d.ts.map