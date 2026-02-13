/**
 * XPR Agents OpenClaw Plugin
 *
 * Registers 56 tools for interacting with the XPR Network Trustless Agent Registry:
 * - 11 Agent Core tools (registration, profile, plugins, trust scores, ownership)
 * - 7 Feedback tools (ratings, disputes, scores)
 * - 9 Validation tools (validators, validations, challenges)
 * - 20 Escrow tools (jobs, milestones, disputes, arbitration, bidding)
 * - 4 Indexer tools (search, events, stats, health)
 * - 5 A2A tools (discover, message, task status, cancel, delegate)
 */
import type { PluginApi } from './types';
export type { SkillManifest, SkillApi, LoadedSkill } from './skill-types';
export type { ToolDefinition, PluginApi } from './types';
export default function xprAgentsPlugin(api: PluginApi): void;
//# sourceMappingURL=index.d.ts.map