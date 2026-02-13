/**
 * Skill Module Types
 *
 * Defines the interfaces for the XPR Agent skill module system.
 * Skill authors import these types to create portable, reusable skill packages.
 */
import type { ToolDefinition, PluginApi } from './types';
/**
 * Skill manifest — metadata for discovery, A2A cards, and future on-chain marketplace.
 * Lives in skill.json at the package root.
 */
export interface SkillManifest {
    /** Skill identifier, e.g. "web-scraping" */
    name: string;
    /** Semver version string */
    version: string;
    /** Human-readable description (for A2A card + on-chain listing) */
    description: string;
    /** Author — npm org or XPR account name */
    author: string;
    /** Category: compute | storage | oracle | payment | messaging | ai */
    category: string;
    /** Search/filter tags */
    tags: string[];
    /** Capabilities exposed (maps to A2A card skills) */
    capabilities: string[];
    /** Tool names this skill registers (for transparency) */
    tools: string[];
    /** Optional requirements */
    requires?: {
        /** Required environment variables */
        env?: string[];
    };
    /** Future: on-chain skill exchange pricing */
    pricing?: {
        model: 'free' | 'one-time' | 'subscription';
        amount?: string;
    };
}
/**
 * API passed to skill entry functions for registering tools.
 * Extends PluginApi with convenience accessors for RPC and session.
 */
export interface SkillApi extends PluginApi {
    /** Register a tool (same interface as OpenClaw core tools) */
    registerTool(tool: ToolDefinition): void;
    /** Get plugin config values */
    getConfig(): Record<string, unknown>;
}
/**
 * A fully loaded skill — returned by the skill loader after successful loading.
 */
export interface LoadedSkill {
    /** Parsed manifest from skill.json */
    manifest: SkillManifest;
    /** Behavioral instructions from SKILL.md (frontmatter stripped) */
    promptSection: string;
    /** Number of tools successfully registered */
    toolCount: number;
}
//# sourceMappingURL=skill-types.d.ts.map