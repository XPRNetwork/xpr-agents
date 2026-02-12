/**
 * Skill Module Loader
 *
 * Discovers, validates, and loads skill modules from AGENT_SKILLS env var.
 * Each skill provides tools, system prompt sections, and A2A capabilities.
 *
 * Usage:
 *   AGENT_SKILLS=@xpr-agents/skill-web-scraping,./my-local-skill
 */

import fs from 'fs';
import path from 'path';

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<unknown>;
}

interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  tags: string[];
  capabilities: string[];
  tools: string[];
  requires?: { env?: string[] };
  pricing?: { model: string; amount?: string };
}

export interface LoadedSkill {
  manifest: SkillManifest;
  promptSection: string;
  toolCount: number;
}

export interface SkillLoadResult {
  skills: LoadedSkill[];
  tools: ToolDef[];
  promptSections: string[];
  capabilities: string[];
}

const MAX_SKILL_MD_SIZE = 10 * 1024; // 10KB limit for SKILL.md

/**
 * Strip YAML frontmatter from SKILL.md content.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Validate a skill manifest has all required fields.
 */
function validateManifest(manifest: any, skillPath: string): manifest is SkillManifest {
  const required = ['name', 'version', 'description', 'author', 'category', 'tools'];
  for (const field of required) {
    if (!manifest[field]) {
      console.error(`[skill] Invalid manifest in ${skillPath}: missing "${field}"`);
      return false;
    }
  }
  if (!Array.isArray(manifest.tools)) {
    console.error(`[skill] Invalid manifest in ${skillPath}: "tools" must be an array`);
    return false;
  }
  // Default optional arrays
  if (!Array.isArray(manifest.tags)) manifest.tags = [];
  if (!Array.isArray(manifest.capabilities)) manifest.capabilities = [];
  return true;
}

/**
 * Resolve a skill specifier to a directory path.
 * Supports npm package names and local paths (relative or absolute).
 */
function resolveSkillPath(specifier: string): string | null {
  // Local path (starts with . or /)
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const resolved = path.resolve(specifier);
    if (fs.existsSync(resolved)) return resolved;
    console.error(`[skill] Local path not found: ${resolved}`);
    return null;
  }

  // npm package — try require.resolve
  try {
    const pkgJsonPath = require.resolve(`${specifier}/package.json`);
    return path.dirname(pkgJsonPath);
  } catch {
    console.error(`[skill] npm package not found: ${specifier} (is it installed?)`);
    return null;
  }
}

/**
 * Load a single skill from a directory path.
 */
function loadSingleSkill(
  skillDir: string,
  existingToolNames: Set<string>,
  tools: ToolDef[],
): LoadedSkill | null {
  // Load manifest
  const manifestPath = path.join(skillDir, 'skill.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[skill] No skill.json found in ${skillDir}`);
    return null;
  }

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err: any) {
    console.error(`[skill] Failed to parse skill.json in ${skillDir}: ${err.message}`);
    return null;
  }

  if (!validateManifest(manifest, skillDir)) return null;

  // Check required env vars
  if (manifest.requires?.env) {
    const missing = manifest.requires.env.filter((v: string) => !process.env[v]);
    if (missing.length > 0) {
      console.warn(`[skill] "${manifest.name}" requires missing env vars: ${missing.join(', ')} — loading anyway (tools may fail)`);
    }
  }

  // Load SKILL.md
  let promptSection = '';
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    if (raw.length > MAX_SKILL_MD_SIZE) {
      console.warn(`[skill] "${manifest.name}" SKILL.md exceeds ${MAX_SKILL_MD_SIZE / 1024}KB limit, truncating`);
      promptSection = stripFrontmatter(raw.slice(0, MAX_SKILL_MD_SIZE));
    } else {
      promptSection = stripFrontmatter(raw);
    }
  }

  // Load entry point and register tools
  const toolCountBefore = tools.length;

  // Try dist/index.js first (compiled), then src/index.ts via ts-node
  let entryPath = path.join(skillDir, 'dist', 'index.js');
  if (!fs.existsSync(entryPath)) {
    entryPath = path.join(skillDir, 'src', 'index.ts');
  }
  if (!fs.existsSync(entryPath)) {
    // Try package.json main field
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(skillDir, 'package.json'), 'utf-8'));
      if (pkg.main) {
        entryPath = path.join(skillDir, pkg.main);
      }
    } catch { /* ignore */ }
  }

  if (!fs.existsSync(entryPath)) {
    console.error(`[skill] No entry point found for "${manifest.name}" in ${skillDir}`);
    return null;
  }

  // Create a skill API that wraps the tools array with collision detection
  const skillApi = {
    registerTool(tool: ToolDef) {
      if (existingToolNames.has(tool.name)) {
        console.warn(`[skill] "${manifest.name}" tried to register tool "${tool.name}" which already exists — skipped (core tools always win)`);
        return;
      }
      existingToolNames.add(tool.name);
      tools.push(tool);
    },
    getConfig() {
      return {
        network: process.env.XPR_NETWORK || 'testnet',
        rpcEndpoint: process.env.XPR_RPC_ENDPOINT || '',
        indexerUrl: process.env.INDEXER_URL || 'http://localhost:3001',
      };
    },
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(entryPath);
    const entryFn = mod.default || mod;
    if (typeof entryFn !== 'function') {
      console.error(`[skill] "${manifest.name}" entry point does not export a function`);
      return null;
    }
    entryFn(skillApi);
  } catch (err: any) {
    console.error(`[skill] Failed to load "${manifest.name}": ${err.message}`);
    return null;
  }

  const toolCount = tools.length - toolCountBefore;

  return { manifest, promptSection, toolCount };
}

/**
 * Load all skills specified in AGENT_SKILLS env var.
 *
 * @param tools - Existing tools array (core tools already registered). New skill tools are appended.
 * @returns Loaded skills metadata, prompt sections, and capabilities.
 */
export function loadSkills(tools: ToolDef[]): SkillLoadResult {
  const envSkills = process.env.AGENT_SKILLS;
  if (!envSkills || envSkills.trim() === '') {
    return { skills: [], tools: [], promptSections: [], capabilities: [] };
  }

  const specifiers = envSkills.split(',').map(s => s.trim()).filter(Boolean);
  if (specifiers.length === 0) {
    return { skills: [], tools: [], promptSections: [], capabilities: [] };
  }

  // Build set of existing tool names for collision detection
  const existingToolNames = new Set(tools.map(t => t.name));

  const loadedSkills: LoadedSkill[] = [];
  const promptSections: string[] = [];
  const capabilities: string[] = [];
  const newTools: ToolDef[] = [];

  for (const specifier of specifiers) {
    const skillDir = resolveSkillPath(specifier);
    if (!skillDir) continue;

    const toolCountBefore = tools.length;
    const skill = loadSingleSkill(skillDir, existingToolNames, tools);
    if (!skill) continue;

    loadedSkills.push(skill);

    // Collect new tools registered by this skill
    for (let i = toolCountBefore; i < tools.length; i++) {
      newTools.push(tools[i]);
    }

    if (skill.promptSection) {
      promptSections.push(`## Skill: ${skill.manifest.name}\n${skill.promptSection}`);
    }

    if (skill.manifest.capabilities) {
      capabilities.push(...skill.manifest.capabilities);
    }

    console.log(`[skill] Loaded "${skill.manifest.name}" v${skill.manifest.version}: ${skill.toolCount} tools`);
  }

  return { skills: loadedSkills, tools: newTools, promptSections, capabilities };
}

/**
 * Load a built-in skill from a local directory.
 * Used for skills bundled with the agent runner (e.g. creative tools).
 * These are always loaded regardless of AGENT_SKILLS env var.
 */
export function loadBuiltinSkill(skillDir: string, tools: ToolDef[]): LoadedSkill | null {
  if (!fs.existsSync(skillDir)) return null;

  const existingToolNames = new Set(tools.map(t => t.name));
  const skill = loadSingleSkill(skillDir, existingToolNames, tools);

  if (skill) {
    console.log(`[skill] Loaded built-in "${skill.manifest.name}": ${skill.toolCount} tools`);
  }

  return skill;
}
