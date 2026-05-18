/**
 * XPR Agent Runner
 *
 * Autonomous agent that:
 * 1. Polls on-chain state for changes (jobs, feedback, challenges)
 * 2. Receives webhook events from the indexer (optional)
 * 3. Runs events through Claude with XPR tools in an agentic loop
 * 4. Executes on-chain actions based on Claude's decisions
 *
 * The built-in poller makes the indexer optional — the agent can
 * operate fully autonomously with just RPC access.
 */

import express from 'express';
import { createLlmClientFromEnv, LlmMessage, LlmTextBlock, LlmTool, LlmToolResultBlock, LlmToolUseBlock } from './llm';
import fs from 'fs';
import path from 'path';
import { verifyA2ARequest, A2AAuthError } from './a2a-auth';
import type { A2AAuthConfig } from './a2a-auth';
import { loadSkills, loadBuiltinSkill } from './skill-loader';
import type { SkillLoadResult } from './skill-loader';
import { loadSecurityConfig, scanInbound, scanOutput, getSecurityStats } from './security';

// Tool collection types (matches openclaw PluginApi)
interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<unknown>;
}

// Collect tools by mocking the plugin API
const tools: ToolDef[] = [];
const mockApi = {
  registerTool(tool: ToolDef) { tools.push(tool); },
  getConfig() {
    return {
      network: process.env.XPR_NETWORK || 'mainnet',
      rpcEndpoint: process.env.XPR_RPC_ENDPOINT || '',
      indexerUrl: process.env.INDEXER_URL || 'http://indexer:3001',
      confirmHighRisk: false, // autonomous mode - no confirmation gates
      maxTransferAmount: (() => {
        const parsed = parseInt(process.env.MAX_TRANSFER_AMOUNT || '10000000');
        if (isNaN(parsed) || parsed <= 0) {
          console.warn('[agent] MAX_TRANSFER_AMOUNT is invalid, using default 10000000 (1000 XPR)');
          return 10000000;
        }
        return parsed;
      })(),
      contracts: {},
    };
  },
};

// ── Fail-fast: legacy XPR_PRIVATE_KEY MUST NOT be set ──
//
// Post-2026-04-24 charliebot incident, the agent process is forbidden
// from holding blockchain private keys. All signing goes through the
// proton CLI's encrypted keychain. If XPR_PRIVATE_KEY is set, refuse
// to start — both code paths cannot run simultaneously without risk.
if (process.env.XPR_PRIVATE_KEY) {
  console.error('[FATAL] XPR_PRIVATE_KEY is set but is no longer supported.');
  console.error('');
  console.error('  Migration:');
  console.error('    1. Install the hardened proton CLI:');
  console.error('         npm i -g @proton/cli');
  console.error('    2. Add your blockchain key to the encrypted keychain:');
  console.error('         proton chain:set proton   # or proton-test');
  console.error('         proton key:add');
  console.error('    3. Remove XPR_PRIVATE_KEY from your .env / environment.');
  console.error('    4. Restart the agent.');
  console.error('');
  console.error('  See README.md "Quick Start" for the full setup flow.');
  process.exit(1);
}

// ── Fail-fast: require critical env vars ──
if (!process.env.XPR_ACCOUNT) {
  console.error('[FATAL] XPR_ACCOUNT is required. Set it in .env or environment.');
  process.exit(1);
}

if (!process.env.XPR_RPC_ENDPOINT) {
  // Default to public indexer-paired RPC by network.
  const network = process.env.XPR_NETWORK || 'mainnet';
  const defaultRpc = network === 'mainnet' ? 'https://proton.eosusa.io' : 'https://tn1.protonnz.com';
  process.env.XPR_RPC_ENDPOINT = defaultRpc;
  console.warn(`[agent] XPR_RPC_ENDPOINT not set — defaulting to ${defaultRpc}`);
}

if (!process.env.OPENCLAW_HOOK_TOKEN) {
  console.error('[FATAL] OPENCLAW_HOOK_TOKEN is required for webhook authentication. Set it in .env or environment.');
  process.exit(1);
}

// ── Verify proton CLI is available for signing ──
// Async check kicked off here; if it fails the agent will still boot
// (read-only operations work) but signed actions will throw with a clear
// error from the wrapper.
import('@xpr-agents/openclaw').then(({ checkProtonCli, checkKeychainPopulated }) => {
  Promise.all([checkProtonCli(), checkKeychainPopulated()]).then(([cliOk, keyOk]) => {
    if (!cliOk) {
      console.warn('[agent] proton CLI not found in PATH. Signing actions will fail until installed:');
      console.warn('         npm i -g @proton/cli');
    } else if (!keyOk) {
      console.warn('[agent] proton CLI keychain is empty. Signing actions will fail until a key is added:');
      console.warn('         proton key:add');
    } else {
      console.log('[agent] proton CLI ready (keychain populated)');
    }
  });
}).catch(() => {
  // openclaw module not loaded yet — non-fatal, signing path will report later
});

// Default INDEXER_URL to the public xpr-agents indexer per network.
if (!process.env.INDEXER_URL) {
  const network = process.env.XPR_NETWORK || 'mainnet';
  process.env.INDEXER_URL = network === 'mainnet'
    ? 'https://indexer.xpragents.com'
    : 'https://testnet-indexer.xpragents.com';
}

// ── Global crash handlers ──
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

// Agent mode — controls system prompt and poller behavior
type AgentMode = 'worker' | 'delegator' | 'hybrid' | 'validator' | 'social';
const AGENT_MODE: AgentMode = (() => {
  const mode = (process.env.AGENT_MODE || 'worker').toLowerCase();
  const valid: AgentMode[] = ['worker', 'delegator', 'hybrid', 'validator', 'social'];
  if (!valid.includes(mode as AgentMode)) {
    console.warn(`[agent] Invalid AGENT_MODE "${mode}", defaulting to worker`);
    return 'worker';
  }
  return mode as AgentMode;
})();

// Delegator budget controls
const DELEGATOR_MAX_JOB_XPR = parseFloat(process.env.DELEGATOR_MAX_JOB_XPR || '5000');
const DELEGATOR_DAILY_BUDGET_XPR = parseFloat(process.env.DELEGATOR_DAILY_BUDGET_XPR || '50000');
let delegatorDailySpend = 0;
let delegatorSpendResetDate = new Date().toISOString().slice(0, 10);

function canDelegatorSpend(amountXpr: number, context: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== delegatorSpendResetDate) {
    delegatorDailySpend = 0;
    delegatorSpendResetDate = today;
  }
  if (amountXpr > DELEGATOR_MAX_JOB_XPR) {
    console.log(`[delegator] Job exceeds max (${amountXpr} > ${DELEGATOR_MAX_JOB_XPR} XPR), skipping: ${context}`);
    return false;
  }
  if (delegatorDailySpend + amountXpr > DELEGATOR_DAILY_BUDGET_XPR) {
    console.log(`[delegator] Daily budget exceeded (${delegatorDailySpend}+${amountXpr} > ${DELEGATOR_DAILY_BUDGET_XPR} XPR), skipping: ${context}`);
    return false;
  }
  return true;
}

function recordDelegatorSpend(amountXpr: number): void {
  delegatorDailySpend += amountXpr;
  console.log(`[delegator] Spent ${amountXpr} XPR today (${delegatorDailySpend}/${DELEGATOR_DAILY_BUDGET_XPR})`);
}

// Load plugin (registers all 72 tools)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginFn = require('@xpr-agents/openclaw').default;
pluginFn(mockApi);

// ── Load skills ──────────────────────────────
// Skills ship inside the @xpr-agents/openclaw npm package since v0.4.0.
// Resolving via require.resolve makes both deployment paths work without
// branching:
//   - Standalone scaffold: openclaw is at file:../.. → resolves locally
//   - Pinata / harness:    openclaw is npm-installed → resolves there
function resolveSkillDir(name: string): string {
  try {
    const pkgPath = require.resolve('@xpr-agents/openclaw/package.json');
    return path.join(path.dirname(pkgPath), 'skills', name);
  } catch {
    // Last-resort local-dev fallback when running the runner outside the
    // standard openclaw install (e.g. checked-out monorepo, no npm install).
    return path.resolve(__dirname, '../../../skills', name);
  }
}

// 1. Built-in creative skill (always loaded — deliverable tools)
const creativeSkillDir = resolveSkillDir('creative');
const creativeSkill = loadBuiltinSkill(creativeSkillDir, tools);

// 2. Built-in web-scraping skill (always loaded — page fetch/parse tools)
const webScrapingSkillDir = resolveSkillDir('web-scraping');
const webScrapingSkill = loadBuiltinSkill(webScrapingSkillDir, tools);

// 3. Built-in code-sandbox skill (always loaded — JS execution in sandboxed VM)
const codeSandboxSkillDir = resolveSkillDir('code-sandbox');
const codeSandboxSkill = loadBuiltinSkill(codeSandboxSkillDir, tools);

// 4. Built-in structured-data skill (always loaded — CSV/JSON/chart tools)
const structuredDataSkillDir = resolveSkillDir('structured-data');
const structuredDataSkill = loadBuiltinSkill(structuredDataSkillDir, tools);

// 5. Built-in defi skill (always loaded — DEX trading, AMM swaps, OTC, yield farming, liquidity, msig)
const defiSkillDir = resolveSkillDir('defi');
const defiSkill = loadBuiltinSkill(defiSkillDir, tools);

// 6. Built-in nft skill (always loaded — AtomicAssets/AtomicMarket lifecycle)
const nftSkillDir = resolveSkillDir('nft');
const nftSkill = loadBuiltinSkill(nftSkillDir, tools);

// 7. Built-in tax skill (always loaded — crypto tax reporting)
const taxSkillDir = resolveSkillDir('tax');
const taxSkill = loadBuiltinSkill(taxSkillDir, tools);

// 8. Built-in lending skill (always loaded — LOAN Protocol supply/borrow/repay)
const lendingSkillDir = resolveSkillDir('lending');
const lendingSkill = loadBuiltinSkill(lendingSkillDir, tools);

// 9. Built-in governance skill (always loaded — proposals, voting, communities)
const governanceSkillDir = resolveSkillDir('governance');
const governanceSkill = loadBuiltinSkill(governanceSkillDir, tools);

// 10. Built-in xmd skill (always loaded — Metal Dollar mint/redeem/analytics)
const xmdSkillDir = resolveSkillDir('xmd');
const xmdSkill = loadBuiltinSkill(xmdSkillDir, tools);

// 11. Built-in smart-contracts skill (always loaded — chain inspection, scaffolding, auditing)
const smartContractsSkillDir = resolveSkillDir('smart-contracts');
const smartContractsSkill = loadBuiltinSkill(smartContractsSkillDir, tools);

// 12. Built-in shellbook skill (always loaded — agent social network)
const shellbookSkillDir = resolveSkillDir('shellbook');
const shellbookSkill = loadBuiltinSkill(shellbookSkillDir, tools);

// 13. External skills from AGENT_SKILLS env var
const skillResult: SkillLoadResult = loadSkills(tools);
const allSkillCapabilities: string[] = [
  ...(creativeSkill?.manifest.capabilities || []),
  ...(webScrapingSkill?.manifest.capabilities || []),
  ...(codeSandboxSkill?.manifest.capabilities || []),
  ...(structuredDataSkill?.manifest.capabilities || []),
  ...(defiSkill?.manifest.capabilities || []),
  ...(nftSkill?.manifest.capabilities || []),
  ...(taxSkill?.manifest.capabilities || []),
  ...(lendingSkill?.manifest.capabilities || []),
  ...(governanceSkill?.manifest.capabilities || []),
  ...(xmdSkill?.manifest.capabilities || []),
  ...(smartContractsSkill?.manifest.capabilities || []),
  ...(shellbookSkill?.manifest.capabilities || []),
  ...skillResult.capabilities,
];

// ── Memory tools ─────────────────────────────
tools.push({
  name: 'memory_save',
  description: 'Save a piece of information to persistent memory. Use this to remember important context across conversations: job outcomes, user preferences, lessons learned, key decisions. Keys should be descriptive (e.g., "job_15_outcome", "preferred_bid_style").',
  parameters: {
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', description: 'Memory key (descriptive identifier)' },
      value: { type: 'string', description: 'What to remember' },
      ttl_hours: { type: 'number', description: 'Auto-expire after this many hours (optional, default: permanent)' },
    },
  },
  handler: async ({ key, value, ttl_hours }: { key: string; value: string; ttl_hours?: number }) => {
    const now = Date.now();
    // Enforce max entries — evict oldest if at cap
    const keys = Object.keys(memoryStore);
    if (keys.length >= MEMORY_MAX_ENTRIES && !memoryStore[key]) {
      const oldest = keys.sort((a, b) => memoryStore[a].timestamp - memoryStore[b].timestamp)[0];
      delete memoryStore[oldest];
    }
    memoryStore[key] = {
      value,
      timestamp: now,
      expiresAt: ttl_hours ? now + ttl_hours * 3600_000 : undefined,
    };
    saveMemory();
    return { ok: true, message: `Saved memory: "${key}"` };
  },
});

tools.push({
  name: 'memory_delete',
  description: 'Delete a memory entry by key.',
  parameters: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'Memory key to delete' },
    },
  },
  handler: async ({ key }: { key: string }) => {
    if (memoryStore[key]) {
      delete memoryStore[key];
      saveMemory();
      return { ok: true, message: `Deleted memory: "${key}"` };
    }
    return { ok: false, message: `Memory key "${key}" not found` };
  },
});

// Load agent-operator skill as system prompt
// Primary path: shipped inside @xpr-agents/openclaw since v0.4.0. The repo-relative
// fallbacks cover monorepo dev where the runner is exec'd before npm-installing.
function findSkillCandidates(): string[] {
  const candidates: string[] = [];
  // Primary: npm package (@xpr-agents/openclaw bundles the skills folder)
  try {
    const pkgPath = require.resolve('@xpr-agents/openclaw/package.json');
    candidates.push(path.resolve(path.dirname(pkgPath), 'skills/xpr-agent-operator/SKILL.md'));
  } catch { /* not installed via npm */ }
  // Local dev fallbacks (running from openclaw/starter/agent/dist)
  candidates.push(path.resolve(__dirname, '../../../skills/xpr-agent-operator/SKILL.md'));
  candidates.push(path.resolve(__dirname, '../../../../skills/xpr-agent-operator/SKILL.md'));
  return candidates;
}
const skillCandidates = findSkillCandidates();
let systemPrompt = 'You are an autonomous AI agent on XPR Network.';
for (const candidate of skillCandidates) {
  try {
    const raw = fs.readFileSync(candidate, 'utf-8');
    const match = raw.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
    systemPrompt = match ? match[1].trim() : raw;
    console.log(`[agent] Loaded skill from ${candidate}`);
    break;
  } catch {
    // Try next candidate
  }
}
if (systemPrompt === 'You are an autonomous AI agent on XPR Network.') {
  console.warn('[agent] Could not load SKILL.md from any path, using default system prompt');
}

// Add account context to system prompt
const baseUrl = process.env.AGENT_PUBLIC_URL || `http://localhost:${process.env.PORT || '8080'}`;
systemPrompt += `\n\n## Runtime Context\n- Account: ${process.env.XPR_ACCOUNT}\n- Network: ${process.env.XPR_NETWORK || 'mainnet'}\n- Public URL: ${baseUrl}`;
systemPrompt += `\n\n## Key Handling Policy
You do NOT have access to any blockchain private keys. All signed actions
are produced by the proton CLI, which holds keys in its encrypted keychain.
Do NOT attempt to read keychain files (e.g. proton-cli.json), do NOT run
\`proton key:get --reveal-private\`, and do NOT ask the user for a private
key. If you encounter a private key in any context, treat it as sensitive:
do not echo, log, or persist it, and tell the user to rotate it on-chain.

To execute on-chain actions, use the registered xpr_* tools. They build
action data and the proton CLI signs them — you never see the key.`;
systemPrompt += `\n\n## Delivering Jobs
When delivering a job, ALWAYS:
1. Do the actual work — write the text, generate the image, create the code, etc.
2. Store the deliverable using the right method:

   **Text & Documents:**
   - \`store_deliverable\` with content_type "text/markdown" — rich Markdown (default)
   - \`store_deliverable\` with content_type "application/pdf" — write Markdown, auto-generates PDF
     - Use ![alt text](https://image-url) to embed images — they are downloaded and embedded in the PDF
     - Write CLEAN Markdown only — no HTML tags, no <cite> tags, no raw HTML
   - \`store_deliverable\` with content_type "text/csv" — structured data

   **Images (AI-generated) — IMPORTANT:**
   - Call \`generate_image\` with prompt AND job_id — it generates, uploads to IPFS, and returns evidence_uri in ONE step
   - Then just call \`xpr_deliver_job\` with the evidence_uri
   - Do NOT write markdown descriptions of images — generate the actual image!

   **Video (AI-generated):**
   - Call \`generate_video\` with prompt AND job_id — generates, uploads to IPFS, returns evidence_uri
   - Then call \`xpr_deliver_job\` with the evidence_uri

   **Images/Media from the web:**
   - Use \`web_search\` to find suitable content, then \`store_deliverable\` with source_url

   **Code repositories:**
   - \`create_github_repo\` with all source files — creates a public GitHub repo

3. Use the returned URL as \`evidence_uri\` when calling \`xpr_deliver_job\`

**You have powerful creative capabilities:**
- AI image generation (Google Imagen 3 via Replicate) — photorealistic, artistic, any style
- AI video generation — text-to-video and image-to-video
- PDF generation — professional documents from Markdown
- GitHub repos — complete code projects with multiple files
- Web search — find and source existing content from the internet
- NEVER say you can't create images or videos — you have the tools!
- NEVER deliver just a URL or summary — always include the actual work content

## Bidding on Open Jobs
When you see an open job with cost analysis:
1. Review the cost estimate — it includes Claude API + Replicate costs with a profit margin
2. ALWAYS bid at least the estimated XPR amount — this is your minimum profitable price
3. If the budget is above your cost estimate: bid at or near budget (more profit for you)
4. If the budget is below your cost estimate: bid at your estimated cost (you can bid above budget — the client can accept or reject)
5. If the job is wildly unprofitable (budget < 25% of cost): skip it
6. Always include a clear proposal explaining what you'll deliver and how
7. Set a reasonable timeline based on job complexity (hours, not days for most tasks)

## Cost-Aware Execution
Every tool call costs money (API tokens, image generation, web searches). Scale your effort to the job budget:
- Low-budget jobs (< 500 XPR): keep it simple — minimal web searches, no image generation, short text deliverables
- Medium-budget jobs (500–5000 XPR): moderate effort — a few searches, 1–2 images if requested
- High-budget jobs (> 5000 XPR): full effort — thorough research, multiple images, polished PDF
Never spend more on tool calls than the job is worth.`;

// Mode-specific system prompt sections
if (AGENT_MODE === 'delegator' || AGENT_MODE === 'hybrid') {
  systemPrompt += `\n\n## Delegator Mode
You are a DELEGATOR agent. Your job is to CREATE jobs and hire other agents to do work.
- Use xpr_create_job to post jobs on the job board (omit agent for open jobs)
- Fund jobs with xpr_fund_job
- When bids come in, evaluate them using xpr_list_bids and xpr_select_bid
- Monitor deliveries and approve with xpr_approve_delivery or raise disputes
- Budget wisely: track your XPR balance and set reasonable job amounts (max ${DELEGATOR_MAX_JOB_XPR} XPR per job, ${DELEGATOR_DAILY_BUDGET_XPR} XPR/day)
- Write clear job descriptions with specific deliverables so agents know what to bid on`;
}

if (AGENT_MODE === 'delegator') {
  // Override: delegators do NOT bid on jobs themselves
  systemPrompt += `\n- You do NOT bid on jobs yourself — you hire others`;
}

if (AGENT_MODE === 'validator') {
  systemPrompt += `\n\n## Validator Mode
You are a VALIDATOR agent. Your job is to validate other agents' work quality.
- Use xpr_register_validator to register (if not already)
- Poll for delivered jobs and submit validations via xpr_submit_validation
- Provide honest assessments with evidence URIs
- You earn rewards when your validations are upheld in challenges
- Maintain high accuracy — incorrect validations get slashed
- You do NOT bid on jobs or create jobs — you validate work quality`;
}

if (AGENT_MODE === 'social') {
  systemPrompt += `\n\n## Social Mode
You are a SOCIAL agent focused on community engagement on Shellbook.
- Post updates, insights, and commentary via shell_create_post
- Engage with other posts via shell_vote and shell_create_comment
- Build your reputation through consistent, quality contributions
- You do NOT bid on jobs or create jobs — you build community presence
- Focus on adding value to conversations, not spamming`;
}

// Append skill prompt sections (built-in + external)
if (creativeSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${creativeSkill.manifest.name}\n${creativeSkill.promptSection}`;
}
if (webScrapingSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${webScrapingSkill.manifest.name}\n${webScrapingSkill.promptSection}`;
}
if (codeSandboxSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${codeSandboxSkill.manifest.name}\n${codeSandboxSkill.promptSection}`;
}
if (structuredDataSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${structuredDataSkill.manifest.name}\n${structuredDataSkill.promptSection}`;
}
if (defiSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${defiSkill.manifest.name}\n${defiSkill.promptSection}`;
}
if (nftSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${nftSkill.manifest.name}\n${nftSkill.promptSection}`;
}
if (taxSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${taxSkill.manifest.name}\n${taxSkill.promptSection}`;
}
if (smartContractsSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${smartContractsSkill.manifest.name}\n${smartContractsSkill.promptSection}`;
}
if (shellbookSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${shellbookSkill.manifest.name}\n${shellbookSkill.promptSection}`;
}
if (lendingSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${lendingSkill.manifest.name}\n${lendingSkill.promptSection}`;
}
if (governanceSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${governanceSkill.manifest.name}\n${governanceSkill.promptSection}`;
}
if (xmdSkill?.promptSection) {
  systemPrompt += `\n\n## Skill: ${xmdSkill.manifest.name}\n${xmdSkill.promptSection}`;
}
for (const section of skillResult.promptSections) {
  systemPrompt += `\n\n${section}`;
}

// Memory instructions
systemPrompt += `\n\n## Memory
You have persistent memory that survives across conversations. Your memory entries are shown at the start of each message. Use memory_save to record important outcomes, lessons, and context. Use memory_delete to remove outdated entries. Be selective — save what matters, not everything.`;

// Convert local tools to the unified LlmTool shape. Lazy — picks up tools
// registered later (e.g. store_deliverable added at boot time after a skill
// loads).
//
// Note: the previous Anthropic-only path also exposed Anthropic's built-in
// `web_search_20250305` server-side tool. That doesn't have a cross-provider
// equivalent yet, so it's dropped from the unified surface. The skills
// already ship `web_fetch` / `web_search` tools that work across providers.
function buildLlmTools(toolList: typeof tools): LlmTool[] {
  return toolList.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as LlmTool['input_schema'],
  }));
}

// LLM client — resolves provider, model, and API key from env / flags.
// See src/llm/factory.ts for the resolution order.
const llmClient = createLlmClientFromEnv();
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '20');
const MODEL = llmClient.model;

// A2A authentication config
const a2aAuthConfig: A2AAuthConfig = {
  rpcEndpoint: process.env.XPR_RPC_ENDPOINT!,
  authRequired: process.env.A2A_AUTH_REQUIRED !== 'false',
  minTrustScore: parseInt(process.env.A2A_MIN_TRUST_SCORE || '0'),
  minKycLevel: parseInt(process.env.A2A_MIN_KYC_LEVEL || '0'),
  rateLimit: parseInt(process.env.A2A_RATE_LIMIT || '20'),
  timestampWindow: 300,
  agentcoreContract: 'agentcore',
};

// A2A tool sandboxing
const a2aToolMode = (process.env.A2A_TOOL_MODE || 'full') as 'full' | 'readonly';
const readonlyTools = tools.filter(t => t.name.startsWith('xpr_get_') || t.name.startsWith('xpr_list_') || t.name.startsWith('xpr_search_') || t.name === 'xpr_indexer_health' || t.name.startsWith('defi_get_') || t.name.startsWith('defi_list_') || t.name.startsWith('nft_get_') || t.name.startsWith('nft_list_') || t.name.startsWith('nft_search_') || t.name.startsWith('tax_') || t.name.startsWith('loan_list_') || t.name.startsWith('loan_get_') || t.name.startsWith('gov_list_') || t.name.startsWith('gov_get_') || t.name.startsWith('xmd_get_') || t.name.startsWith('xmd_list_') || t.name.startsWith('sc_get_') || t.name === 'sc_read_table' || t.name.startsWith('shell_list_') || t.name === 'shell_get_comments' || t.name === 'shell_search' || t.name === 'shell_get_profile');
// readonly LLM tools — same shape, smaller list
function buildReadonlyLlmTools(): LlmTool[] {
  return buildLlmTools(readonlyTools);
}

// A2A task store (in-memory with TTL eviction)
interface A2ATaskRecord {
  id: string;
  owner: string;           // authenticated caller who created the task
  contextId?: string;
  status: { state: string; message?: unknown; timestamp: string };
  artifacts?: Array<{ parts: Array<{ type: string; text: string }>; index: number }>;
  history?: unknown[];
  metadata?: Record<string, unknown>;
  createdAt: number;       // Date.now() for TTL eviction
}
const a2aTasks = new Map<string, A2ATaskRecord>();
let a2aTaskCounter = 0;

const A2A_TASK_MAX_SIZE = 1000;
const A2A_TASK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of a2aTasks) {
    if (now - task.createdAt > A2A_TASK_TTL_MS) {
      a2aTasks.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

function evictOldestTasks(): void {
  if (a2aTasks.size <= A2A_TASK_MAX_SIZE) return;
  // Evict oldest tasks until under limit
  const entries = [...a2aTasks.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const toRemove = entries.slice(0, a2aTasks.size - A2A_TASK_MAX_SIZE);
  for (const [id] of toRemove) {
    a2aTasks.delete(id);
  }
}

// Agent card cache (60s TTL)
let agentCardCache: { card: unknown; expiresAt: number } | null = null;

// Track active runs to prevent duplicate processing
const activeRuns = new Set<string>();
// M13 AUDIT FIX: Cap maximum concurrent agent runs to prevent unbounded resource usage
const MAX_CONCURRENT_RUNS = parseInt(process.env.MAX_CONCURRENT_RUNS || '5');

interface RunAgentOptions {
  toolSet?: 'full' | 'readonly';
}

async function runAgent(eventType: string, data: any, message: string, options?: RunAgentOptions): Promise<string> {
  const runKey = `${eventType}:${JSON.stringify(data).slice(0, 100)}`;
  if (activeRuns.has(runKey)) {
    return 'Already processing this event';
  }
  // M13 AUDIT FIX: Reject new runs when at concurrency cap
  if (activeRuns.size >= MAX_CONCURRENT_RUNS) {
    console.warn(`[agent] Concurrency cap reached (${MAX_CONCURRENT_RUNS}). Dropping event: ${eventType}`);
    return 'Concurrency limit reached, try again later';
  }
  activeRuns.add(runKey);

  const useReadonly = options?.toolSet === 'readonly';
  const activeTools = useReadonly ? readonlyTools : tools;
  const activeLlmTools = useReadonly ? buildReadonlyLlmTools() : buildLlmTools(tools);

  try {
    const userMessage = [
      `You received a blockchain event notification.`,
      ``,
      `**Event:** ${eventType}`,
      `**Summary:** ${message}`,
      `**Data:**`,
      '```json',
      JSON.stringify(data, null, 2),
      '```',
      ``,
      `Process this event according to your responsibilities. If no action is needed, explain why briefly.`,
    ].join('\n');

    // Inject persistent memory context
    const memoryContext = getMemoryContext();
    const fullUserMessage = memoryContext
      ? `${memoryContext}\n\n---\n\n${userMessage}`
      : userMessage;

    const messages: LlmMessage[] = [{ role: 'user', content: fullUserMessage }];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await llmClient.complete({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: activeLlmTools,
        messages,
      });

      // If done, return the text response
      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is LlmTextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        console.log(`[agent] Completed in ${turn + 1} turn(s): ${text.slice(0, 200)}`);
        return text;
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute local tool calls
      const toolResults: LlmToolResultBlock[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const toolUse = block as LlmToolUseBlock;
        const tool = activeTools.find(t => t.name === toolUse.name);
        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
          });
          continue;
        }

        console.log(`[agent] Tool call: ${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 100)})`);

        try {
          const result = await tool.handler(toolUse.input);
          const resultStr = JSON.stringify(result);
          // Log result for key tools (truncated for readability)
          if (['generate_image', 'generate_video', 'store_deliverable'].includes(toolUse.name)) {
            console.log(`[agent] Tool result (${toolUse.name}): ${resultStr.slice(0, 200)}`);
          }
          // Security scan tool output before feeding back to the LLM
          const outputScan = scanOutput(toolUse.name, resultStr);
          if (outputScan.action === 'block') {
            console.warn(`[security] Blocked output from ${toolUse.name}: ${outputScan.flagged.join(', ')}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: 'Output blocked by security policy' }),
              is_error: true,
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: outputScan.text,
            });
          }
        } catch (err: any) {
          console.error(`[agent] Tool error (${toolUse.name}):`, err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true,
          });
        }
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }

    return 'Max turns reached without completion';
  } finally {
    activeRuns.delete(runKey);
  }
}

// Express server
const app = express();
// Preserve raw body for A2A signature verification (verify callback runs before parsing)
// M5 AUDIT FIX: Enforce request body size limit to prevent OOM attacks
app.use(express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf-8'); },
}));

// Webhook endpoint — receives events from the indexer
app.post('/hooks/agent', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.OPENCLAW_HOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token required' });
  }

  const { event_type, data, message } = req.body;
  if (!event_type) {
    return res.status(400).json({ error: 'Missing event_type' });
  }

  console.log(`[agent] Event received: ${event_type} — ${message || ''}`);

  // Security scan inbound webhook data
  const scanMsg = scanInbound(message || '', 'webhook');
  const scanData = scanInbound(JSON.stringify(data || {}), 'webhook');
  if (scanMsg.action === 'block' || scanData.action === 'block') {
    console.warn(`[security] Blocked webhook: ${[...scanMsg.flagged, ...scanData.flagged].join(', ')}`);
    return res.status(400).json({ error: 'Content blocked by security policy' });
  }

  // Process async so we respond quickly to the webhook
  res.json({ ok: true, status: 'processing' });

  try {
    await runAgent(event_type, data || {}, scanMsg.text || event_type);
  } catch (err) {
    console.error(`[agent] Failed to process ${event_type}:`, err);
  }
});

// Manual trigger — requires authentication
app.post('/run', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.OPENCLAW_HOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token required' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const result = await runAgent('manual', {}, prompt);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// A2A Agent Card discovery
app.get('/.well-known/agent.json', async (_req, res) => {
  // Return cached card if still valid
  if (agentCardCache && Date.now() < agentCardCache.expiresAt) {
    return res.json(agentCardCache.card);
  }

  try {
    // Fetch own on-chain data using loaded tools
    const getAgent = tools.find(t => t.name === 'xpr_get_agent');
    const getTrust = tools.find(t => t.name === 'xpr_get_trust_score');
    const account = process.env.XPR_ACCOUNT || '';

    let agentData: any = {};
    let trustData: any = {};

    if (getAgent) {
      try { agentData = await getAgent.handler({ account }); } catch { /* use defaults */ }
    }
    if (getTrust) {
      try { trustData = await getTrust.handler({ account }); } catch { /* use defaults */ }
    }

    // Parse capabilities from on-chain data + loaded skills
    let capabilities: string[] = [];
    if (Array.isArray(agentData.capabilities)) {
      capabilities = agentData.capabilities;
    }
    // Merge skill capabilities (deduplicated)
    const mergedCapabilities = [...new Set([...capabilities, ...allSkillCapabilities])];

    const card = {
      name: agentData.name || account,
      description: agentData.description || '',
      url: agentData.endpoint || `http://localhost:${port}`,
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      skills: mergedCapabilities.map((cap: string) => ({
        id: cap,
        name: cap,
        description: `${cap} capability`,
        tags: [cap],
      })),
      'xpr:account': account,
      'xpr:protocol': agentData.protocol || 'https',
      'xpr:trustScore': trustData.total ?? undefined,
      'xpr:kycLevel': trustData.breakdown?.kyc != null ? Math.floor(trustData.breakdown.kyc / 10) : undefined,
      'xpr:registeredAt': agentData.registered_at || 0,
      'xpr:owner': agentData.owner || undefined,
    };

    agentCardCache = { card, expiresAt: Date.now() + 60_000 };
    res.json(card);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to build agent card: ${err.message}` });
  }
});

// A2A JSON-RPC endpoint
app.post('/a2a', async (req, res) => {
  // Use raw wire bytes preserved by express.json verify callback for signature verification
  const rawBody = (req as any).rawBody as string | undefined;
  if (!rawBody) {
    return res.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: missing request body' },
    });
  }
  const parsed = req.body;

  const { jsonrpc, id, method, params } = parsed;

  if (jsonrpc !== '2.0' || !method) {
    return res.json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid request: must be JSON-RPC 2.0 with a method' },
    });
  }

  // Authenticate the request
  let authAccount = 'unknown';
  try {
    const authResult = await verifyA2ARequest(
      req.headers as Record<string, string | undefined>,
      rawBody,
      a2aAuthConfig,
    );
    authAccount = authResult.account;
  } catch (err) {
    if (err instanceof A2AAuthError) {
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: err.code, message: err.message },
      });
    }
    return res.json({
      jsonrpc: '2.0', id,
      error: { code: -32000, message: `Authentication error: ${(err as Error).message}` },
    });
  }

  try {
    let result: unknown;

    switch (method) {
      case 'message/send': {
        const message = params?.message;
        if (!message || !message.parts) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32602, message: 'Invalid params: message with parts is required' },
          });
        }

        // Extract text from message parts
        const textParts = message.parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text);
        let text = textParts.join('\n') || 'No text content';

        // Security scan A2A message text
        const a2aScan = scanInbound(text, 'a2a');
        if (a2aScan.action === 'block') {
          return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Content blocked by security policy' } });
        }
        text = a2aScan.text;

        // Build context info — use authenticated account, fall back to claimed account
        const callerAccount = authAccount !== 'anonymous' ? authAccount : (params?.['xpr:callerAccount'] || 'unknown');
        const jobId = params?.metadata?.['xpr:jobId'];
        const prompt = jobId
          ? `[A2A from ${callerAccount}, job #${jobId}] ${text}`
          : `[A2A from ${callerAccount}] ${text}`;

        // Create or reuse task — reject caller-supplied IDs owned by another account
        let taskId = params?.id || `task-${++a2aTaskCounter}`;
        const existingTask = a2aTasks.get(taskId);
        if (existingTask && existingTask.owner !== authAccount) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32000, message: `Task ID '${taskId}' is owned by another account` },
          });
        }
        const contextId = params?.contextId;

        const taskRecord: A2ATaskRecord = {
          id: taskId,
          owner: authAccount,
          contextId,
          status: { state: 'working', timestamp: new Date().toISOString() },
          metadata: params?.metadata,
          createdAt: Date.now(),
        };
        a2aTasks.set(taskId, taskRecord);
        evictOldestTasks();

        // Run through the agentic loop
        const agentResult = await runAgent(
          'a2a:message/send',
          { callerAccount, jobId, text },
          prompt,
          { toolSet: a2aToolMode },
        );

        // Update task with result
        taskRecord.status = { state: 'completed', timestamp: new Date().toISOString() };
        taskRecord.artifacts = [{ parts: [{ type: 'text', text: agentResult }], index: 0 }];

        result = taskRecord;
        break;
      }

      case 'tasks/get': {
        const taskId = params?.id;
        if (!taskId) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32602, message: 'Invalid params: id is required' },
          });
        }
        const task = a2aTasks.get(taskId);
        if (!task || task.owner !== authAccount) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32001, message: `Task not found: ${taskId}` },
          });
        }
        result = task;
        break;
      }

      case 'tasks/cancel': {
        const taskId = params?.id;
        if (!taskId) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32602, message: 'Invalid params: id is required' },
          });
        }
        const task = a2aTasks.get(taskId);
        if (!task || task.owner !== authAccount) {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32001, message: `Task not found: ${taskId}` },
          });
        }
        if (task.status.state === 'completed' || task.status.state === 'failed') {
          return res.json({
            jsonrpc: '2.0', id,
            error: { code: -32002, message: `Task already ${task.status.state}` },
          });
        }
        task.status = { state: 'canceled', timestamp: new Date().toISOString() };
        result = task;
        break;
      }

      default:
        return res.json({
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (err: any) {
    res.json({
      jsonrpc: '2.0', id,
      error: { code: -32603, message: err.message || 'Internal error' },
    });
  }
});

// Serve deliverables (from creative skill's in-memory store)
app.get('/deliverables/:jobId', (req, res) => {
  const jobId = parseInt(req.params.jobId);
  // Import getDeliverable from the creative skill
  let entry: { content: string; content_type: string; media_url?: string; created_at: string } | undefined;
  try {
    // Skill ships pre-built inside the openclaw package — require the dist
    // entry directly. (Previously this loaded TS source via __dirname/../skills,
    // which silently failed on non-Docker installs without ts-node.)
    const creativeModule = require(resolveSkillDir('creative') + '/dist/index');
    entry = creativeModule.getDeliverable?.(jobId);
  } catch { /* creative skill not loaded */ }
  if (!entry) {
    return res.status(404).json({ error: 'Deliverable not found' });
  }
  res.json({ job_id: jobId, content: entry.content, content_type: entry.content_type, media_url: entry.media_url, created_at: entry.created_at });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    account: process.env.XPR_ACCOUNT,
    network: process.env.XPR_NETWORK || 'mainnet',
    mode: AGENT_MODE,
    tools: tools.length,
    model: MODEL,
    active_runs: activeRuns.size,
    security: getSecurityStats(),
    poller: POLL_ENABLED ? { enabled: true, interval_sec: POLL_INTERVAL / 1000, tracked_jobs: knownJobStates.size } : { enabled: false },
  });
});

// ── On-chain polling loop ────────────────────
// Polls on-chain state directly via tools — no indexer required.
// Detects job state changes, new open jobs, new feedback/challenges.
// Default 60s — matches starter/start.sh and .env.example. The 4-hour
// default was historical (when the agent was webhook-first and the
// poller was a safety net); the modern path defaults the poller to the
// primary discovery loop, so it has to be fast enough to feel real-time
// without hammering shared RPC. Operators tune via POLL_INTERVAL.
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60') * 1000;
const POLL_ENABLED = process.env.POLL_ENABLED !== 'false';

// Credit protection: minimum job value and daily evaluation cap
const JOB_POLLER_MIN_XPR = parseFloat(process.env.JOB_POLLER_MIN_XPR || '100');
const JOB_POLLER_MAX_EVALS_PER_DAY = parseInt(process.env.JOB_POLLER_MAX_EVALS_PER_DAY || '10');
let dailyEvalCount = 0;
let dailyEvalResetDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function checkAndResetDailyEvals(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyEvalResetDate) {
    dailyEvalCount = 0;
    dailyEvalResetDate = today;
    console.log(`[poller] Daily eval counter reset (new day: ${today})`);
  }
}

function canSpendCredits(context: string): boolean {
  checkAndResetDailyEvals();
  if (dailyEvalCount >= JOB_POLLER_MAX_EVALS_PER_DAY) {
    console.log(`[poller] Daily eval cap reached (${dailyEvalCount}/${JOB_POLLER_MAX_EVALS_PER_DAY}), skipping: ${context}`);
    return false;
  }
  return true;
}

function recordEval(): void {
  dailyEvalCount++;
  console.log(`[poller] Eval ${dailyEvalCount}/${JOB_POLLER_MAX_EVALS_PER_DAY} today`);
}

// Tracked state for change detection
const knownJobStates = new Map<number, number>();   // job_id → state
const knownOpenJobIds = new Set<number>();           // open job ids already seen
const knownFeedbackIds = new Set<number>();          // feedback ids already seen
const knownChallengeIds = new Set<number>();         // challenge ids already seen
const knownDelegatorBidIds = new Set<number>();      // bid ids already evaluated by delegator
const knownPostIds = new Set<number>();              // shellbook post ids already seen by social mode
const activeJobIds = new Set<number>();              // jobs currently being processed (per-job lock)
const fundedJobAttempts = new Map<number, number>(); // job_id → number of times agent was invoked
const MAX_FUNDED_RETRIES = 2;                        // max times to invoke agent for a stuck FUNDED job
const MAX_TRACKED_IDS = 5000;                        // cap tracked sets to prevent unbounded memory growth

/** Evict oldest entries from a Set when it exceeds MAX_TRACKED_IDS */
function capSet(s: Set<number>): void {
  if (s.size <= MAX_TRACKED_IDS) return;
  const iter = s.values();
  const toRemove = s.size - MAX_TRACKED_IDS;
  for (let i = 0; i < toRemove; i++) iter.next();
  // Sets iterate in insertion order — remove the oldest
  const idsToKeep = new Set<number>();
  let kept = 0;
  for (const id of s) {
    if (kept++ >= toRemove) idsToKeep.add(id);
  }
  s.clear();
  for (const id of idsToKeep) s.add(id);
}

/** Evict terminal-state jobs (COMPLETED=6, REFUNDED=7, ARBITRATED=8) from knownJobStates */
function pruneTerminalJobs(): void {
  if (knownJobStates.size <= MAX_TRACKED_IDS) return;
  for (const [id, state] of knownJobStates) {
    if (state >= 6) knownJobStates.delete(id);
    if (knownJobStates.size <= MAX_TRACKED_IDS) break;
  }
}
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let firstPoll = true;                               // true until first poll completes

// ── Poller state persistence ──
// H10 AUDIT FIX: Validate poller state path is within designated data directory
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const rawPollerPath = path.resolve(process.env.POLLER_STATE_PATH || './poller-state.json');
const POLLER_STATE_PATH = rawPollerPath.startsWith(DATA_DIR) || rawPollerPath.startsWith(path.resolve('.'))
  ? rawPollerPath
  : path.join(DATA_DIR, 'poller-state.json');

interface PollerState {
  knownJobStates: Record<string, number>;
  knownOpenJobIds: number[];
  knownFeedbackIds: number[];
  knownChallengeIds: number[];
  knownDelegatorBidIds?: number[];
  knownPostIds?: number[];
  fundedJobAttempts?: Record<string, number>;
  dailyEvalCount?: number;
  dailyEvalResetDate?: string;
}

function savePollerState(): void {
  try {
    const state: PollerState = {
      knownJobStates: Object.fromEntries(knownJobStates),
      knownOpenJobIds: [...knownOpenJobIds],
      knownFeedbackIds: [...knownFeedbackIds],
      knownChallengeIds: [...knownChallengeIds],
      knownDelegatorBidIds: [...knownDelegatorBidIds],
      knownPostIds: [...knownPostIds],
      fundedJobAttempts: Object.fromEntries(fundedJobAttempts),
      dailyEvalCount,
      dailyEvalResetDate,
    };
    fs.writeFileSync(POLLER_STATE_PATH, JSON.stringify(state), 'utf-8');
  } catch (err: any) {
    console.warn(`[poller] Failed to save state: ${err.message}`);
  }
}

function loadPollerState(): boolean {
  try {
    if (!fs.existsSync(POLLER_STATE_PATH)) return false;
    const raw = fs.readFileSync(POLLER_STATE_PATH, 'utf-8');
    const state: PollerState = JSON.parse(raw);
    for (const [k, v] of Object.entries(state.knownJobStates)) {
      knownJobStates.set(Number(k), v);
    }
    for (const id of state.knownOpenJobIds) knownOpenJobIds.add(id);
    for (const id of state.knownFeedbackIds) knownFeedbackIds.add(id);
    for (const id of state.knownChallengeIds) knownChallengeIds.add(id);
    if (state.knownDelegatorBidIds) for (const id of state.knownDelegatorBidIds) knownDelegatorBidIds.add(id);
    if (state.knownPostIds) for (const id of state.knownPostIds) knownPostIds.add(id);
    if (state.fundedJobAttempts) {
      for (const [k, v] of Object.entries(state.fundedJobAttempts)) {
        fundedJobAttempts.set(Number(k), v);
      }
    }
    // Restore daily eval counter (auto-resets if date changed)
    if (state.dailyEvalResetDate && state.dailyEvalCount != null) {
      const today = new Date().toISOString().slice(0, 10);
      if (state.dailyEvalResetDate === today) {
        dailyEvalCount = state.dailyEvalCount;
        dailyEvalResetDate = state.dailyEvalResetDate;
        console.log(`[poller] Restored daily eval count: ${dailyEvalCount}/${JOB_POLLER_MAX_EVALS_PER_DAY}`);
      } else {
        console.log(`[poller] New day — daily eval count reset`);
      }
    }
    firstPoll = false; // skip seed — we already have state
    console.log(`[poller] Restored state: ${knownJobStates.size} jobs, ${knownOpenJobIds.size} open, ${knownFeedbackIds.size} feedback, ${knownChallengeIds.size} challenges`);
    return true;
  } catch (err: any) {
    console.warn(`[poller] Failed to load state (will seed from chain): ${err.message}`);
    return false;
  }
}

// ── Agent persistent memory ──────────────────
const AGENT_MEMORY_PATH = path.join(DATA_DIR, 'agent-memory.json');
const MEMORY_MAX_ENTRIES = parseInt(process.env.MEMORY_MAX_ENTRIES || '100');

interface MemoryEntry {
  value: string;
  timestamp: number;
  expiresAt?: number;  // optional TTL
}

let memoryStore: Record<string, MemoryEntry> = {};

function loadMemory(): void {
  try {
    if (!fs.existsSync(AGENT_MEMORY_PATH)) return;
    memoryStore = JSON.parse(fs.readFileSync(AGENT_MEMORY_PATH, 'utf-8'));
    // Prune expired entries on load
    const now = Date.now();
    for (const [k, v] of Object.entries(memoryStore)) {
      if (v.expiresAt && v.expiresAt < now) delete memoryStore[k];
    }
    console.log(`[memory] Loaded ${Object.keys(memoryStore).length} entries`);
  } catch (err: any) {
    console.warn(`[memory] Failed to load: ${err.message}`);
    memoryStore = {};
  }
}

function saveMemory(): void {
  try {
    fs.writeFileSync(AGENT_MEMORY_PATH, JSON.stringify(memoryStore, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn(`[memory] Failed to save: ${err.message}`);
  }
}

function getMemoryContext(): string {
  const now = Date.now();
  const entries = Object.entries(memoryStore)
    .filter(([, v]) => !v.expiresAt || v.expiresAt > now)
    .sort(([, a], [, b]) => b.timestamp - a.timestamp)  // newest first
    .slice(0, 50);  // cap what we inject
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `- **${k}**: ${v.value}`);
  return `## Your Memory (${entries.length} entries)\n${lines.join('\n')}`;
}

// ── XPR Price Oracle (mainnet on-chain) ──────
// Always queries mainnet oracle for accurate price data, even on testnet.
let cachedXprPrice = 0;
let xprPriceFetchedAt = 0;
const XPR_PRICE_CACHE_MS = 5 * 60 * 1000;

async function getXprUsdPrice(): Promise<number> {
  const MAINNET_RPC = 'https://proton.eosusa.io';
  const resp = await fetch(`${MAINNET_RPC}/v1/chain/get_table_rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: true,
      code: 'oracles',
      scope: 'oracles',
      table: 'data',
      lower_bound: 3,  // XPR/USD feed_index
      upper_bound: 4,
      limit: 1,
    }),
  });
  const { rows } = await resp.json() as { rows: Array<{ aggregate?: { d_double?: string | number | null } }> };
  const raw = rows[0]?.aggregate?.d_double;
  const price = typeof raw === 'string' ? parseFloat(raw) : (raw || 0);
  if (price > 0) console.log(`[oracle] XPR/USD price: $${price.toFixed(6)}`);
  return price;
}

async function getCachedXprPrice(): Promise<number> {
  if (Date.now() - xprPriceFetchedAt < XPR_PRICE_CACHE_MS && cachedXprPrice > 0) {
    return cachedXprPrice;
  }
  try {
    cachedXprPrice = await getXprUsdPrice();
    xprPriceFetchedAt = Date.now();
  } catch (err: any) {
    console.error(`[oracle] Failed to fetch XPR price: ${err.message}`);
  }
  return cachedXprPrice;
}

// ── Cost Estimation ──────────────────────────
interface CostEstimate {
  estimated_usd: number;
  estimated_xpr: number;
  breakdown: string;
  job_type: string;
  xpr_price_usd: number;
}

const COST_MARGIN = parseFloat(process.env.COST_MARGIN || '2.0');

async function estimateJobCost(title: string, description: string, deliverables: string): Promise<CostEstimate> {
  const text = `${title} ${description} ${deliverables}`.toLowerCase();
  const xprPrice = await getCachedXprPrice();

  let claudeCost = 0.10;  // Base: minimal Claude usage
  let replicateCost = 0;
  let jobType = 'text';

  // Image generation detection
  const imageKeywords = ['image', 'picture', 'photo', 'illustration', 'logo', 'design', 'graphic', 'art', 'draw', 'visual', 'banner', 'poster', 'thumbnail'];
  const hasImage = imageKeywords.some(k => text.includes(k));

  // Video generation detection
  const videoKeywords = ['video', 'animation', 'motion', 'clip', 'footage'];
  const hasVideo = videoKeywords.some(k => text.includes(k));

  // Code/analysis detection (heavier Claude usage)
  const codeKeywords = ['code', 'program', 'develop', 'build', 'implement', 'api', 'script', 'function', 'app', 'software', 'debug', 'fix'];
  const hasCode = codeKeywords.some(k => text.includes(k));

  // Research/writing detection
  const researchKeywords = ['research', 'report', 'analysis', 'write', 'article', 'essay', 'documentation', 'blog', 'content', 'review', 'audit'];
  const hasResearch = researchKeywords.some(k => text.includes(k));

  if (hasVideo) {
    jobType = 'video';
    claudeCost = 0.15;
    replicateCost = 0.25;  // video generation ~$0.25
  } else if (hasImage) {
    jobType = 'image';
    claudeCost = 0.15;
    const estimatedImages = 2;
    replicateCost = estimatedImages * 0.039;  // Google Nano Banana @ $0.039/img
  } else if (hasCode) {
    jobType = 'code';
    claudeCost = 0.80;  // Heavier Claude usage for code tasks
  } else if (hasResearch) {
    jobType = 'research';
    claudeCost = 0.50;  // Moderate Claude usage
  } else {
    jobType = 'general';
    claudeCost = 0.30;
  }

  const totalUsd = claudeCost + replicateCost;
  const totalWithMargin = totalUsd * COST_MARGIN;
  const estimatedXpr = xprPrice > 0 ? Math.ceil(totalWithMargin / xprPrice) : 0;

  const breakdown = [
    `Type: ${jobType}`,
    `Claude API: ~$${claudeCost.toFixed(2)}`,
    replicateCost > 0 ? `Replicate: ~$${replicateCost.toFixed(2)}` : null,
    `Subtotal: $${totalUsd.toFixed(2)} + ${Math.round((COST_MARGIN - 1) * 100)}% margin = $${totalWithMargin.toFixed(2)}`,
    `XPR price: $${xprPrice.toFixed(6)}`,
    `Estimated: ${estimatedXpr.toLocaleString()} XPR`,
  ].filter(Boolean).join(' | ');

  return { estimated_usd: totalWithMargin, estimated_xpr: estimatedXpr, breakdown, job_type: jobType, xpr_price_usd: xprPrice };
}

const POLL_TIMEOUT = 120_000; // 2 minutes max per poll cycle

async function pollOnChain(): Promise<void> {
  if (shuttingDown) return;

  try {
    await Promise.race([
      pollOnChainInner(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Poll cycle timed out after 120s')), POLL_TIMEOUT)
      ),
    ]);
  } catch (err: any) {
    console.error(`[poller] Poll cycle error: ${err.message}`);
  }

  // ALWAYS schedule next poll — even if this cycle hung or errored
  if (!shuttingDown) {
    pollTimer = setTimeout(pollOnChain, POLL_INTERVAL);
    pollTimer.unref();
  }
}

async function pollOnChainInner(): Promise<void> {
  const account = process.env.XPR_ACCOUNT;
  if (!account) return;

  const listJobs = tools.find(t => t.name === 'xpr_list_jobs');
  const listOpenJobs = tools.find(t => t.name === 'xpr_list_open_jobs');
  const listFeedback = tools.find(t => t.name === 'xpr_list_agent_feedback');
  const listValidations = tools.find(t => t.name === 'xpr_list_agent_validations');

  try {
    // 1. Check jobs assigned to this agent for state changes
    //    (worker + hybrid modes only — delegators and validators don't have assigned jobs)
    //    Fetch up to 100 jobs (secondary index returns oldest first),
    //    then only track the most recent 50 for state change detection.
    if (listJobs && ['worker', 'hybrid'].includes(AGENT_MODE)) {
      const res: any = await listJobs.handler({ agent: account, limit: 100 });
      const allJobs: any[] = res?.items || res || [];
      // Only care about the most recent 50 — old completed jobs won't change
      const jobs: any[] = allJobs.length > 50 ? allJobs.slice(-50) : allJobs;
      for (const job of jobs) {
        if (!job || job.id == null) continue;
        const prevState = knownJobStates.get(job.id);
        knownJobStates.set(job.id, job.state);

        // Per-job lock: skip if this job is already being processed
        if (activeJobIds.has(job.id)) continue;

        // First poll — just seed state, don't trigger
        if (prevState === undefined) {
          // But if this is a newly-assigned job (not first poll) in FUNDED state, act on it
          if (!firstPoll && (job.state === 1 || job.state === 'funded')) {
            const attempts = fundedJobAttempts.get(job.id) || 0;
            if (attempts >= MAX_FUNDED_RETRIES) continue; // already tried enough
            if (!canSpendCredits(`assigned job #${job.id}`)) continue;
            fundedJobAttempts.set(job.id, attempts + 1);
            const jobBudgetXpr = (job.amount / 10000).toFixed(4);
            console.log(`[poller] Newly assigned job #${job.id} in FUNDED state (attempt ${attempts + 1}/${MAX_FUNDED_RETRIES})`);
            activeJobIds.add(job.id);
            recordEval();
            const deliverables = scanInbound(job.deliverables || '', 'poller').text;
            const safeTitle = scanInbound(job.title || '', 'poller').text;
            const safeDescription = scanInbound(job.description || '', 'poller').text;
            runAgent('poll:job_assigned', {
              job_id: job.id, client: job.client, agent: job.agent,
              state: job.state, title: safeTitle, description: safeDescription,
              deliverables, budget_xpr: jobBudgetXpr,
            }, `You have been assigned to job #${job.id} "${safeTitle}" (${jobBudgetXpr} XPR). It is FUNDED. Description: ${safeDescription || 'N/A'}. Deliverables: ${deliverables || 'N/A'}. Accept the job, start working on it, and deliver ALL requested deliverables. You MUST upload all files and call xpr_deliver_job before finishing.`).catch(err => {
              console.error(`[poller] Failed to process newly assigned job:`, err.message);
            }).finally(() => activeJobIds.delete(job.id));
          }
          continue;
        }

        // Re-evaluate FUNDED jobs (in case they were missed on restart), but cap retries
        if (prevState === job.state && (job.state === 1 || job.state === 'funded')) {
          const attempts = fundedJobAttempts.get(job.id) || 0;
          if (attempts >= MAX_FUNDED_RETRIES) {
            // Already tried enough times — skip until state changes on-chain
            continue;
          }
          if (!canSpendCredits(`re-eval FUNDED job #${job.id}`)) continue;
          const jobBudgetXpr = (job.amount / 10000).toFixed(4);
          fundedJobAttempts.set(job.id, attempts + 1);
          const deliverables = scanInbound(job.deliverables || '', 'poller').text;
          const safeTitle = scanInbound(job.title || '', 'poller').text;
          const safeDescription = scanInbound(job.description || '', 'poller').text;
          console.log(`[poller] Re-evaluating FUNDED job #${job.id} (attempt ${attempts + 1}/${MAX_FUNDED_RETRIES})`);
          activeJobIds.add(job.id);
          recordEval();
          runAgent('poll:job_assigned', {
            job_id: job.id, client: job.client, agent: job.agent,
            state: job.state, title: safeTitle, description: safeDescription,
            deliverables, budget_xpr: jobBudgetXpr,
          }, `You have been assigned to job #${job.id} "${safeTitle}" (${jobBudgetXpr} XPR). It is FUNDED. Description: ${safeDescription || 'N/A'}. Deliverables: ${deliverables || 'N/A'}. Accept the job, start working on it, and deliver ALL requested deliverables. You MUST upload all files and call xpr_deliver_job before finishing.`).catch(err => {
            console.error(`[poller] Failed to process FUNDED job:`, err.message);
          }).finally(() => activeJobIds.delete(job.id));
          continue;
        }

        // State changed — only invoke Claude for ACTIONABLE states (saves credits)
        if (prevState !== job.state) {
          fundedJobAttempts.delete(job.id); // state moved, reset retry counter
          const stateNames = ['CREATED', 'FUNDED', 'ACCEPTED', 'INPROGRESS', 'DELIVERED', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'ARBITRATED'];
          const fromName = stateNames[prevState] || String(prevState);
          const toName = stateNames[job.state] || String(job.state);
          console.log(`[poller] Job #${job.id} state changed: ${fromName} → ${toName}`);

          // Terminal/informational states — just log, no Claude call needed
          // COMPLETED(6), REFUNDED(7), ARBITRATED(8), ACCEPTED(2), INPROGRESS(3)
          const ACTIONABLE_STATES = [1, 4, 5]; // FUNDED, DELIVERED, DISPUTED
          if (!ACTIONABLE_STATES.includes(job.state)) {
            console.log(`[poller] Job #${job.id} → ${toName} (informational, no action needed)`);
            continue;
          }

          if (!canSpendCredits(`job #${job.id} state change ${fromName}→${toName}`)) continue;

          const jobBudgetXpr = (job.amount / 10000).toFixed(4);
          const deliverables = scanInbound(job.deliverables || '', 'poller').text;
          const safeTitle = scanInbound(job.title || '', 'poller').text;
          const safeDescription = scanInbound(job.description || '', 'poller').text;
          activeJobIds.add(job.id);
          recordEval();
          runAgent('poll:job_state_change', {
            job_id: job.id, client: job.client, agent: job.agent,
            from_state: prevState, to_state: job.state,
            title: safeTitle, description: safeDescription,
            deliverables, budget_xpr: jobBudgetXpr,
          }, `Job #${job.id} "${safeTitle}" (budget: ${jobBudgetXpr} XPR) changed from ${fromName} to ${toName}. Description: ${safeDescription || 'N/A'}. Deliverables: ${deliverables || 'N/A'}. Review and take appropriate action. If working on this job, ensure ALL requested deliverables are uploaded and xpr_deliver_job is called before finishing.`).catch(err => {
            console.error(`[poller] Failed to process job state change:`, err.message);
          }).finally(() => activeJobIds.delete(job.id));
        }
      }
    }

    // 2. Check for new open jobs (bidding opportunities)
    // Only worker + hybrid modes bid on open jobs.
    // NOTE: Open jobs are evaluated even on first poll — the agent should bid on
    // existing opportunities, not just newly-appeared ones. We still track IDs to
    // avoid re-processing the same job on every cycle.
    // CREDIT PROTECTION: Jobs below JOB_POLLER_MIN_XPR are skipped (no Claude call).
    // Daily eval cap (JOB_POLLER_MAX_EVALS_PER_DAY) prevents runaway credit usage.
    if (listOpenJobs && ['worker', 'hybrid'].includes(AGENT_MODE)) {
      const res: any = await listOpenJobs.handler({ limit: 20 });
      const jobs: any[] = res?.items || res || [];
      const MAX_JOB_AGE_SEC = 7 * 24 * 60 * 60; // Skip open jobs older than 7 days
      const nowSec = Math.floor(Date.now() / 1000);
      for (const job of jobs) {
        if (!job || job.id == null) continue;
        if (knownOpenJobIds.has(job.id)) continue;
        knownOpenJobIds.add(job.id);

        // Skip stale open jobs — they're likely abandoned test data
        if (job.created_at && (nowSec - job.created_at) > MAX_JOB_AGE_SEC) {
          console.log(`[poller] Skipping stale open job #${job.id} (${Math.floor((nowSec - job.created_at) / 86400)}d old)`);
          continue;
        }

        const budgetXpr = parseFloat((job.amount / 10000).toFixed(4));

        // Credit protection: skip jobs below minimum value (zero credits spent)
        if (budgetXpr < JOB_POLLER_MIN_XPR) {
          console.log(`[poller] Skipping low-value open job #${job.id}: ${budgetXpr} XPR < ${JOB_POLLER_MIN_XPR} XPR minimum`);
          continue;
        }

        // Credit protection: daily evaluation cap
        if (!canSpendCredits(`open job #${job.id}`)) continue;

        console.log(`[poller] ${firstPoll ? 'Existing' : 'New'} open job #${job.id}: "${job.title}" (${budgetXpr} XPR)`);

        // Sanitize on-chain job data before prompt construction
        const safeTitle = scanInbound(job.title || '', 'poller').text;
        const safeDescription = scanInbound(job.description || '', 'poller').text;

        // Estimate costs before triggering Claude (local computation, zero credits)
        const cost = await estimateJobCost(safeTitle, safeDescription, job.deliverables || '');
        const budgetUsd = (budgetXpr * cost.xpr_price_usd).toFixed(2);

        const prompt = `${firstPoll ? 'Existing' : 'New'} open job #${job.id} "${safeTitle}" with budget ${budgetXpr} XPR.

## Cost Analysis
- Job type: ${cost.job_type}
- Estimated cost: ${cost.estimated_xpr.toLocaleString()} XPR ($${cost.estimated_usd.toFixed(2)} USD)
- Cost breakdown: ${cost.breakdown}
- Job budget: ${budgetXpr} XPR ($${budgetUsd} USD)
- ${cost.estimated_xpr > budgetXpr ? 'WARNING: Budget is BELOW estimated cost — bid higher to cover costs or skip' : 'Budget covers estimated costs'}

Evaluate this job and if it matches your capabilities, submit a bid using xpr_submit_bid.
Set your bid amount based on the cost analysis above — at LEAST the estimated cost.
You MAY bid above the posted budget if costs require it — the client can accept or reject.
Include a brief proposal (1-2 sentences) saying what you will deliver.
If the job is outside your capabilities or wildly unprofitable (budget < 25% of cost), skip it.`;

        recordEval();
        runAgent('poll:new_open_job', {
          job_id: job.id, client: job.client, title: safeTitle,
          description: safeDescription, budget_xpr: budgetXpr.toFixed(4), deadline: job.deadline,
          cost_estimate: cost,
        }, prompt).catch(err => {
          console.error(`[poller] Failed to process open job:`, err.message);
        });
      }
    }

    // 3. Check for new feedback about this agent
    // NOTE: Feedback is logged only — no Claude call needed (saves credits).
    // Feedback doesn't require any on-chain action from the agent.
    if (listFeedback) {
      const res: any = await listFeedback.handler({ agent: account, limit: 20 });
      const items: any[] = res?.feedback || res?.items || res || [];
      for (const fb of items) {
        if (!fb || fb.id == null) continue;
        if (knownFeedbackIds.has(fb.id)) continue;
        knownFeedbackIds.add(fb.id);

        if (firstPoll) continue;

        console.log(`[poller] New feedback #${fb.id} from ${fb.reviewer}: score ${fb.score}/5 (logged, no action needed)`);
      }
    }

    // 4. Check for new validation challenges against this agent
    if (listValidations) {
      const res: any = await listValidations.handler({ agent: account, limit: 20 });
      const validations: any[] = res?.validations || res?.items || res || [];
      for (const v of validations) {
        if (!v || !v.challenged) continue;
        // We track challenge by validation ID since we can't list challenges directly by agent
        if (knownChallengeIds.has(v.id)) continue;
        knownChallengeIds.add(v.id);

        // Skip seed
        if (firstPoll) continue;

        console.log(`[poller] Validation #${v.id} has been challenged`);
        if (!canSpendCredits(`challenge on validation #${v.id}`)) continue;
        recordEval();
        runAgent('poll:validation_challenged', {
          validation_id: v.id, validator: v.validator, job_hash: v.job_hash,
        }, `Validation #${v.id} has been challenged. Review the challenge and respond.`).catch(err => {
          console.error(`[poller] Failed to process validation challenge:`, err.message);
        });
      }
    }

    // 5. Delegator mode: poll jobs this agent CREATED (as client) to track bids and deliveries
    if (['delegator', 'hybrid'].includes(AGENT_MODE) && listJobs) {
      const listBids = tools.find(t => t.name === 'xpr_list_bids');
      const res: any = await listJobs.handler({ client: account, limit: 50 });
      const clientJobs: any[] = res?.items || res || [];
      for (const job of clientJobs) {
        if (!job || job.id == null) continue;
        const prevState = knownJobStates.get(job.id);
        knownJobStates.set(job.id, job.state);

        if (activeJobIds.has(job.id)) continue;

        // Skip seed
        if (prevState === undefined && firstPoll) continue;

        // Track state changes on jobs we created
        if (prevState !== undefined && prevState !== job.state) {
          const stateNames = ['CREATED', 'FUNDED', 'ACCEPTED', 'INPROGRESS', 'DELIVERED', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'ARBITRATED'];
          const fromName = stateNames[prevState] || String(prevState);
          const toName = stateNames[job.state] || String(job.state);
          console.log(`[poller/delegator] Job #${job.id} (created by me) state: ${fromName} → ${toName}`);

          if (!canSpendCredits(`delegator job #${job.id} ${fromName}→${toName}`)) continue;

          // DELIVERED — evaluate the delivery
          if (job.state === 4) {
            activeJobIds.add(job.id);
            recordEval();
            const safeTitle = scanInbound(job.title || '', 'poller').text;
            runAgent('poll:delegator_delivery', {
              job_id: job.id, agent: job.agent, title: safeTitle,
              state: job.state, deliverables: job.deliverables,
            }, `Job #${job.id} "${safeTitle}" has been DELIVERED by agent ${job.agent}. Review the deliverables and either approve with xpr_approve_delivery or raise a dispute.`).catch(err => {
              console.error(`[poller/delegator] Failed to evaluate delivery:`, err.message);
            }).finally(() => activeJobIds.delete(job.id));
          }
        }

        // Check for new bids on CREATED (open) jobs — gated on NEW bid IDs only
        // (without this gate, the poller invokes Claude every cycle for any job
        // with bids, even when nothing has changed since the last evaluation)
        if (job.state === 0 && listBids && !firstPoll) {
          try {
            const bidsRes: any = await listBids.handler({ job_id: job.id, limit: 10 });
            const bids: any[] = bidsRes?.items || bidsRes || [];
            const newBids = bids.filter((b: any) => b && b.id != null && !knownDelegatorBidIds.has(b.id));
            if (newBids.length > 0) {
              if (!canSpendCredits(`delegator bids for job #${job.id} (${newBids.length} new)`)) continue;
              for (const b of bids) if (b && b.id != null) knownDelegatorBidIds.add(b.id);
              activeJobIds.add(job.id);
              recordEval();
              const safeTitle = scanInbound(job.title || '', 'poller').text;
              runAgent('poll:delegator_bids', {
                job_id: job.id, title: safeTitle, new_bid_count: newBids.length, bids: bids.map((b: any) => ({
                  bid_id: b.id, agent: b.agent, amount: b.amount, proposal: b.proposal,
                })),
              }, `Job #${job.id} "${safeTitle}" has ${bids.length} bid(s) total, ${newBids.length} new since last poll. Evaluate the bids and select the best one using xpr_select_bid if any are suitable.`).catch(err => {
                console.error(`[poller/delegator] Failed to evaluate bids:`, err.message);
              }).finally(() => activeJobIds.delete(job.id));
            }
          } catch (err: any) {
            console.error(`[poller/delegator] Failed to fetch bids for job #${job.id}:`, err.message);
          }
        }
      }
    }

    // 6. Validator mode: poll for DELIVERED jobs to validate
    if (['validator'].includes(AGENT_MODE) && listJobs) {
      const res: any = await listJobs.handler({ limit: 50 });
      const allJobs: any[] = res?.items || res || [];
      for (const job of allJobs) {
        if (!job || job.id == null) continue;
        // Only interested in DELIVERED jobs (state 4)
        if (job.state !== 4) continue;

        const prevState = knownJobStates.get(job.id);
        knownJobStates.set(job.id, job.state);

        if (activeJobIds.has(job.id)) continue;
        if (prevState !== undefined) continue; // Already seen

        if (firstPoll) continue;

        console.log(`[poller/validator] Job #${job.id} is DELIVERED — evaluating for validation`);
        if (!canSpendCredits(`validator job #${job.id}`)) continue;

        activeJobIds.add(job.id);
        recordEval();
        const safeTitle = scanInbound(job.title || '', 'poller').text;
        const safeDescription = scanInbound(job.description || '', 'poller').text;
        runAgent('poll:validator_review', {
          job_id: job.id, agent: job.agent, client: job.client,
          title: safeTitle, description: safeDescription,
          deliverables: job.deliverables,
        }, `Job #${job.id} "${safeTitle}" has been DELIVERED by ${job.agent}. Validate the work quality: review deliverables against the description, then submit a validation using xpr_submit_validation.`).catch(err => {
          console.error(`[poller/validator] Failed to validate job:`, err.message);
        }).finally(() => activeJobIds.delete(job.id));
      }
    }

    // 7. Social mode: poll Shellbook timeline for engagement — gated on NEW posts only
    // (without this gate, the poller invokes Claude every cycle as long as any
    // posts exist on the timeline, even when nothing has changed)
    if (AGENT_MODE === 'social') {
      const listPosts = tools.find(t => t.name === 'shell_list_posts');
      if (listPosts && !firstPoll) {
        try {
          const res: any = await listPosts.handler({ limit: 10 });
          const posts: any[] = res?.items || res?.posts || res || [];
          const newPosts = posts.filter((p: any) => p && p.id != null && !knownPostIds.has(p.id));
          if (newPosts.length > 0) {
            if (canSpendCredits(`social timeline (${newPosts.length} new posts)`)) {
              for (const p of posts) if (p && p.id != null) knownPostIds.add(p.id);
              recordEval();
              runAgent('poll:social_timeline', {
                new_post_count: newPosts.length,
                posts: newPosts.slice(0, 5).map((p: any) => ({
                  id: p.id, author: p.author, content: (p.content || '').slice(0, 200),
                })),
              }, `Here are ${newPosts.length} new Shellbook post(s) since last poll. Engage with the most interesting ones — vote, comment, or create your own post if inspired. Be genuine and add value.`).catch(err => {
                console.error(`[poller/social] Failed to engage timeline:`, err.message);
              });
            }
          }
        } catch (err: any) {
          console.error(`[poller/social] Failed to fetch timeline:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.error(`[poller] Poll error:`, err.message);
  }

  if (firstPoll) {
    firstPoll = false;
    console.log(`[poller] Seeded: ${knownJobStates.size} agent jobs, ${knownOpenJobIds.size} open jobs, ${knownFeedbackIds.size} feedback, ${knownChallengeIds.size} challenges`);
  }

  // Prune tracked state to prevent unbounded memory growth
  pruneTerminalJobs();
  capSet(knownOpenJobIds);
  capSet(knownFeedbackIds);
  capSet(knownChallengeIds);
  capSet(knownDelegatorBidIds);
  capSet(knownPostIds);

  // Persist state after each poll cycle
  savePollerState();
}

function startPoller(): void {
  if (!POLL_ENABLED) {
    console.log('[poller] Polling disabled (POLL_ENABLED=false)');
    return;
  }
  // Restore persisted state (avoids re-seeding and duplicate processing after restart)
  loadPollerState();
  console.log(`[poller] Starting on-chain poller (interval: ${POLL_INTERVAL / 1000}s, min: ${JOB_POLLER_MIN_XPR} XPR, max: ${JOB_POLLER_MAX_EVALS_PER_DAY} evals/day)`);
  // Initial delay to let the server start
  pollTimer = setTimeout(pollOnChain, 5000);
  pollTimer.unref();
}

function stopPoller(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ── Auto-registration on startup ──────────────
async function ensureRegistered(): Promise<void> {
  const account = process.env.XPR_ACCOUNT;
  if (!account) return;

  const getAgent = tools.find(t => t.name === 'xpr_get_agent');
  const registerAgent = tools.find(t => t.name === 'xpr_register_agent');
  const updateAgent = tools.find(t => t.name === 'xpr_update_agent');
  if (!getAgent || !registerAgent) {
    console.warn('[agent-runner] Registration tools not found, skipping auto-register');
    return;
  }

  const desiredEndpoint = process.env.AGENT_PUBLIC_URL || '';
  if (!desiredEndpoint) {
    console.warn('[agent-runner] AGENT_PUBLIC_URL not set — endpoint will default to localhost (not reachable externally)');
  }
  const endpointToUse = desiredEndpoint || `http://localhost:${process.env.PORT || '8080'}`;

  try {
    const agentData: any = await getAgent.handler({ account });
    if (agentData && agentData.account) {
      console.log(`[agent-runner] Already registered on-chain as "${agentData.name}"`);
      // Auto-update endpoint if it changed
      if (updateAgent && desiredEndpoint && agentData.endpoint !== desiredEndpoint) {
        console.log(`[agent-runner] Endpoint mismatch: on-chain="${agentData.endpoint}" vs desired="${desiredEndpoint}" — updating`);
        try {
          await updateAgent.handler({ endpoint: desiredEndpoint, confirmed: true });
          console.log(`[agent-runner] Endpoint updated on-chain to ${desiredEndpoint}`);
        } catch (err: any) {
          console.error(`[agent-runner] Failed to update endpoint: ${err.message}`);
        }
      }
      return;
    }
  } catch {
    // Agent not found — proceed to register
  }

  console.log('[agent-runner] Not registered on-chain, registering...');
  try {
    await registerAgent.handler({
      name: account,
      description: `Autonomous AI agent (${account})`,
      endpoint: endpointToUse,
      protocol: 'https',
      capabilities: ['general', 'jobs', 'bidding'],
      confirmed: true,
    });
    console.log(`[agent-runner] Registered on-chain as "${account}"`);
  } catch (err: any) {
    console.error(`[agent-runner] Auto-registration failed: ${err.message}`);
    console.error(`[agent-runner] Verify the proton CLI keychain has the active key for "${account}":`);
    console.error('[agent-runner]   proton key:list                 # confirm the right key is loaded');
    console.error('[agent-runner]   proton key:add                  # if not, add it (see docs/PINATA.md for hosted-console form)');
    console.error('[agent-runner] Do NOT set XPR_PRIVATE_KEY in .env — the agent refuses to start with it.');
  }
}

const port = parseInt(process.env.PORT || '8080');
const server = app.listen(port, () => {
  console.log(`[agent-runner] Listening on port ${port}`);
  console.log(`[agent-runner] ${tools.length} tools loaded (A2A mode: ${a2aToolMode}, ${a2aToolMode === 'readonly' ? readonlyTools.length : tools.length} tools for A2A)`);
  console.log(`[agent-runner] Account: ${process.env.XPR_ACCOUNT}`);
  console.log(`[agent-runner] Mode: ${AGENT_MODE}`);
  console.log(`[agent-runner] LLM: ${llmClient.provider} (${MODEL})`);
  console.log(`[agent-runner] Network: ${process.env.XPR_NETWORK || 'mainnet'}`);
  console.log(`[agent-runner] A2A auth: ${a2aAuthConfig.authRequired ? 'required' : 'optional'}, rate limit: ${a2aAuthConfig.rateLimit}/min`);
  if (a2aAuthConfig.minTrustScore > 0) console.log(`[agent-runner] A2A min trust score: ${a2aAuthConfig.minTrustScore}`);
  if (a2aAuthConfig.minKycLevel > 0) console.log(`[agent-runner] A2A min KYC level: ${a2aAuthConfig.minKycLevel}`);
  console.log(`[agent-runner] Poller: ${POLL_ENABLED ? `enabled (${POLL_INTERVAL / 1000}s interval)` : 'disabled'}`);
  if (skillResult.skills.length > 0) {
    console.log(`[agent-runner] Skills: ${skillResult.skills.map(s => `${s.manifest.name}@${s.manifest.version}`).join(', ')}`);
  }

  // Log security config
  const secConfig = loadSecurityConfig();
  console.log(`[agent-runner] Security: ${secConfig.enabled ? `enabled (mode: ${secConfig.mode})` : 'disabled'}`);

  // Load persistent memory, then auto-register and start poller
  loadMemory();
  ensureRegistered().then(() => startPoller());
});

// Graceful shutdown
let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[agent-runner] ${signal} received, shutting down gracefully...`);

  // Stop the poller
  stopPoller();

  // Stop accepting new connections
  server.close(() => {
    console.log('[agent-runner] HTTP server closed');
  });

  // Wait for active runs to finish (max 30s)
  const deadline = Date.now() + 30_000;
  const check = setInterval(() => {
    if (activeRuns.size === 0 || Date.now() > deadline) {
      clearInterval(check);
      if (activeRuns.size > 0) {
        console.warn(`[agent-runner] Forcing exit with ${activeRuns.size} active run(s)`);
      } else {
        console.log('[agent-runner] All runs completed, exiting');
      }
      process.exit(0);
    }
    console.log(`[agent-runner] Waiting for ${activeRuns.size} active run(s) to complete...`);
  }, 1000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
