/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 72 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 11 Agent Core tools (registration, profile, plugins, trust scores, ownership)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 21 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
 * - 4 Indexer tools (search, events, stats, health)
 * - 5 A2A tools (discover, message, task status, cancel, delegate)
 * - 15 Shellbook tools (posts, comments, voting, subshells, search, profiles)
 */
import type { PluginApi } from './types';
export type { SkillManifest, SkillApi, LoadedSkill } from './skill-types';
export type { ToolDefinition, PluginApi } from './types';
/**
 * OpenClaw plugin API shape (real runtime API).
 * Plugins receive this from the OpenClaw gateway.
 */
interface OpenClawPluginApi {
    id: string;
    name: string;
    config?: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    registerTool(tool: {
        name: string;
        description: string;
        parameters: unknown;
        execute: (id: string, params: Record<string, unknown>) => Promise<{
            content: Array<{
                type: string;
                text?: string;
            }>;
        }>;
    }, opts?: unknown): void;
    [key: string]: unknown;
}
export default function xprAgentsPlugin(realApi: OpenClawPluginApi | PluginApi): void;
//# sourceMappingURL=index.d.ts.map