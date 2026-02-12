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
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { verifyA2ARequest, A2AAuthError } from './a2a-auth';
import type { A2AAuthConfig } from './a2a-auth';
import { loadSkills, loadBuiltinSkill } from './skill-loader';
import type { SkillLoadResult } from './skill-loader';

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
      network: process.env.XPR_NETWORK || 'testnet',
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

// ── Fail-fast: require critical env vars ──
if (!process.env.XPR_RPC_ENDPOINT) {
  console.error('[FATAL] XPR_RPC_ENDPOINT is required. Set it in .env or environment.');
  process.exit(1);
}

if (!process.env.OPENCLAW_HOOK_TOKEN) {
  console.error('[FATAL] OPENCLAW_HOOK_TOKEN is required for webhook authentication. Set it in .env or environment.');
  process.exit(1);
}

// Load plugin (registers all 55 tools)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginFn = require('@xpr-agents/openclaw').default;
pluginFn(mockApi);

// ── Load skills ──────────────────────────────
// 1. Built-in creative skill (always loaded — deliverable tools)
const creativeSkillDir = path.resolve(__dirname, '../skills/creative');
const creativeSkill = loadBuiltinSkill(creativeSkillDir, tools);

// 2. Built-in web-scraping skill (always loaded — page fetch/parse tools)
const webScrapingSkillDir = path.resolve(__dirname, '../skills/web-scraping');
const webScrapingSkill = loadBuiltinSkill(webScrapingSkillDir, tools);

// 3. Built-in code-sandbox skill (always loaded — JS execution in sandboxed VM)
const codeSandboxSkillDir = path.resolve(__dirname, '../skills/code-sandbox');
const codeSandboxSkill = loadBuiltinSkill(codeSandboxSkillDir, tools);

// 4. Built-in structured-data skill (always loaded — CSV/JSON/chart tools)
const structuredDataSkillDir = path.resolve(__dirname, '../skills/structured-data');
const structuredDataSkill = loadBuiltinSkill(structuredDataSkillDir, tools);

// 5. External skills from AGENT_SKILLS env var
const skillResult: SkillLoadResult = loadSkills(tools);
const allSkillCapabilities: string[] = [
  ...(creativeSkill?.manifest.capabilities || []),
  ...(webScrapingSkill?.manifest.capabilities || []),
  ...(codeSandboxSkill?.manifest.capabilities || []),
  ...(structuredDataSkill?.manifest.capabilities || []),
  ...skillResult.capabilities,
];

// Load agent-operator skill as system prompt
// Resolve from npm package or repo-relative paths for local dev
function findSkillCandidates(): string[] {
  const candidates: string[] = [];
  // npm install: find package root via require.resolve, then locate skill
  try {
    const pkgPath = require.resolve('@xpr-agents/openclaw/package.json');
    candidates.push(path.resolve(path.dirname(pkgPath), 'skills/xpr-agent-operator/SKILL.md'));
  } catch { /* not installed via npm */ }
  // Local dev paths (running from openclaw/starter/agent/dist)
  candidates.push(path.resolve(__dirname, '../../../../skills/xpr-agent-operator/SKILL.md'));
  candidates.push(path.resolve(__dirname, '../../../skills/xpr-agent-operator/SKILL.md'));
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
systemPrompt += `\n\n## Runtime Context\n- Account: ${process.env.XPR_ACCOUNT}\n- Network: ${process.env.XPR_NETWORK || 'testnet'}\n- Public URL: ${baseUrl}`;
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
for (const section of skillResult.promptSections) {
  systemPrompt += `\n\n${section}`;
}

// Convert tools to Anthropic API format (lazy — picks up tools added later like store_deliverable)
// Includes Anthropic's built-in web search tool for real-time internet access
function getAnthropicTools(): Anthropic.Messages.Tool[] {
  return [
    // Built-in web search — Claude handles it server-side, no custom handler needed
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as unknown as Anthropic.Messages.Tool,
    ...tools.map(t => ({
      type: 'custom' as const,
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    })),
  ];
}

const anthropic = new Anthropic();
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '20');
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-20250514';

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
const readonlyTools = tools.filter(t => t.name.startsWith('xpr_get_') || t.name.startsWith('xpr_list_') || t.name.startsWith('xpr_search_') || t.name === 'xpr_indexer_health');
function getReadonlyAnthropicTools(): Anthropic.Messages.Tool[] {
  return [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as unknown as Anthropic.Messages.Tool,
    ...readonlyTools.map(t => ({
      type: 'custom' as const,
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    })),
  ];
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

interface RunAgentOptions {
  toolSet?: 'full' | 'readonly';
}

async function runAgent(eventType: string, data: any, message: string, options?: RunAgentOptions): Promise<string> {
  const runKey = `${eventType}:${JSON.stringify(data).slice(0, 100)}`;
  if (activeRuns.has(runKey)) {
    return 'Already processing this event';
  }
  activeRuns.add(runKey);

  const useReadonly = options?.toolSet === 'readonly';
  const activeTools = useReadonly ? readonlyTools : tools;
  const activeAnthropicTools = useReadonly ? getReadonlyAnthropicTools() : getAnthropicTools();

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

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: activeAnthropicTools,
        messages,
      });

      // If done, return the text response
      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        console.log(`[agent] Completed in ${turn + 1} turn(s): ${text.slice(0, 200)}`);
        return text;
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content as any });

      // Handle pause_turn (long-running server tool like web search)
      // Just continue the loop — pass the response back to let Claude continue
      if ((response.stop_reason as string) === 'pause_turn') {
        console.log(`[agent] pause_turn — continuing`);
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
        continue;
      }

      // Execute local tool calls (skip server_tool_use — handled by API)
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const tool = activeTools.find(t => t.name === block.name);
          if (!tool) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
            });
            continue;
          }

          console.log(`[agent] Tool call: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);

          try {
            const result = await tool.handler(block.input);
            const resultStr = JSON.stringify(result);
            // Log result for key tools (truncated for readability)
            if (['generate_image', 'generate_video', 'store_deliverable'].includes(block.name)) {
              console.log(`[agent] Tool result (${block.name}): ${resultStr.slice(0, 200)}`);
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultStr,
            });
          } catch (err: any) {
            console.error(`[agent] Tool error (${block.name}):`, err.message);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message }),
              is_error: true,
            });
          }
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
app.use(express.json({
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

  // Process async so we respond quickly to the webhook
  res.json({ ok: true, status: 'processing' });

  try {
    await runAgent(event_type, data || {}, message || event_type);
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
        const text = textParts.join('\n') || 'No text content';

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
    const creativeModule = require(path.resolve(__dirname, '../skills/creative/src/index'));
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
    network: process.env.XPR_NETWORK || 'testnet',
    tools: tools.length,
    model: MODEL,
    active_runs: activeRuns.size,
    poller: POLL_ENABLED ? { enabled: true, interval_sec: POLL_INTERVAL / 1000, tracked_jobs: knownJobStates.size } : { enabled: false },
  });
});

// ── On-chain polling loop ────────────────────
// Polls on-chain state directly via tools — no indexer required.
// Detects job state changes, new open jobs, new feedback/challenges.
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30') * 1000;
const POLL_ENABLED = process.env.POLL_ENABLED !== 'false';

// Tracked state for change detection
const knownJobStates = new Map<number, number>();   // job_id → state
const knownOpenJobIds = new Set<number>();           // open job ids already seen
const knownFeedbackIds = new Set<number>();          // feedback ids already seen
const knownChallengeIds = new Set<number>();         // challenge ids already seen
const activeJobIds = new Set<number>();              // jobs currently being processed (per-job lock)
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let firstPoll = true;                               // true until first poll completes

// ── Poller state persistence ──
const POLLER_STATE_PATH = path.resolve(process.env.POLLER_STATE_PATH || './poller-state.json');

interface PollerState {
  knownJobStates: Record<string, number>;
  knownOpenJobIds: number[];
  knownFeedbackIds: number[];
  knownChallengeIds: number[];
}

function savePollerState(): void {
  try {
    const state: PollerState = {
      knownJobStates: Object.fromEntries(knownJobStates),
      knownOpenJobIds: [...knownOpenJobIds],
      knownFeedbackIds: [...knownFeedbackIds],
      knownChallengeIds: [...knownChallengeIds],
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
    firstPoll = false; // skip seed — we already have state
    console.log(`[poller] Restored state: ${knownJobStates.size} jobs, ${knownOpenJobIds.size} open, ${knownFeedbackIds.size} feedback, ${knownChallengeIds.size} challenges`);
    return true;
  } catch (err: any) {
    console.warn(`[poller] Failed to load state (will seed from chain): ${err.message}`);
    return false;
  }
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

async function pollOnChain(): Promise<void> {
  if (shuttingDown) return;
  const account = process.env.XPR_ACCOUNT;
  if (!account) return;

  const listJobs = tools.find(t => t.name === 'xpr_list_jobs');
  const listOpenJobs = tools.find(t => t.name === 'xpr_list_open_jobs');
  const listFeedback = tools.find(t => t.name === 'xpr_list_agent_feedback');
  const listValidations = tools.find(t => t.name === 'xpr_list_agent_validations');

  try {
    // 1. Check jobs assigned to this agent for state changes
    if (listJobs) {
      const res: any = await listJobs.handler({ agent: account, limit: 50 });
      const jobs: any[] = res?.items || res || [];
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
            const jobBudgetXpr = (job.amount / 10000).toFixed(4);
            console.log(`[poller] Newly assigned job #${job.id} in FUNDED state`);
            activeJobIds.add(job.id);
            runAgent('poll:job_assigned', {
              job_id: job.id, client: job.client, agent: job.agent,
              state: job.state, title: job.title, budget_xpr: jobBudgetXpr,
            }, `You have been assigned to job #${job.id} "${job.title}" (${jobBudgetXpr} XPR). It is FUNDED. Accept the job, start working on it, and deliver the result.`).catch(err => {
              console.error(`[poller] Failed to process newly assigned job:`, err.message);
            }).finally(() => activeJobIds.delete(job.id));
          }
          continue;
        }

        // Re-evaluate FUNDED jobs on every cycle (in case they were missed on restart)
        if (prevState === job.state && (job.state === 1 || job.state === 'funded')) {
          const jobBudgetXpr = (job.amount / 10000).toFixed(4);
          console.log(`[poller] Re-evaluating FUNDED job #${job.id}`);
          activeJobIds.add(job.id);
          runAgent('poll:job_assigned', {
            job_id: job.id, client: job.client, agent: job.agent,
            state: job.state, title: job.title, budget_xpr: jobBudgetXpr,
          }, `You have been assigned to job #${job.id} "${job.title}" (${jobBudgetXpr} XPR). It is FUNDED. Accept the job, start working on it, and deliver the result.`).catch(err => {
            console.error(`[poller] Failed to process FUNDED job:`, err.message);
          }).finally(() => activeJobIds.delete(job.id));
          continue;
        }

        // State changed — notify the agent
        if (prevState !== job.state) {
          const stateNames = ['CREATED', 'FUNDED', 'ACCEPTED', 'INPROGRESS', 'DELIVERED', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'ARBITRATED'];
          const fromName = stateNames[prevState] || String(prevState);
          const toName = stateNames[job.state] || String(job.state);
          console.log(`[poller] Job #${job.id} state changed: ${fromName} → ${toName}`);

          const jobBudgetXpr = (job.amount / 10000).toFixed(4);
          activeJobIds.add(job.id);
          runAgent('poll:job_state_change', {
            job_id: job.id, client: job.client, agent: job.agent,
            from_state: prevState, to_state: job.state,
            title: job.title, budget_xpr: jobBudgetXpr,
          }, `Job #${job.id} "${job.title}" (budget: ${jobBudgetXpr} XPR) changed from ${fromName} to ${toName}. Review and take appropriate action.`).catch(err => {
            console.error(`[poller] Failed to process job state change:`, err.message);
          }).finally(() => activeJobIds.delete(job.id));
        }
      }
    }

    // 2. Check for new open jobs (bidding opportunities)
    // NOTE: Open jobs are evaluated even on first poll — the agent should bid on
    // existing opportunities, not just newly-appeared ones. We still track IDs to
    // avoid re-processing the same job on every cycle.
    if (listOpenJobs) {
      const res: any = await listOpenJobs.handler({ limit: 20 });
      const jobs: any[] = res?.items || res || [];
      for (const job of jobs) {
        if (!job || job.id == null) continue;
        if (knownOpenJobIds.has(job.id)) continue;
        knownOpenJobIds.add(job.id);

        const budgetXpr = (job.amount / 10000).toFixed(4);
        console.log(`[poller] ${firstPoll ? 'Existing' : 'New'} open job #${job.id}: "${job.title}" (${budgetXpr} XPR)`);

        // Estimate costs before triggering Claude
        const cost = await estimateJobCost(job.title, job.description || '', job.deliverables || '');
        const budgetUsd = (parseFloat(budgetXpr) * cost.xpr_price_usd).toFixed(2);

        const prompt = `${firstPoll ? 'Existing' : 'New'} open job #${job.id} "${job.title}" with budget ${budgetXpr} XPR.

## Cost Analysis
- Job type: ${cost.job_type}
- Estimated cost: ${cost.estimated_xpr.toLocaleString()} XPR ($${cost.estimated_usd.toFixed(2)} USD)
- Cost breakdown: ${cost.breakdown}
- Job budget: ${budgetXpr} XPR ($${budgetUsd} USD)
- ${cost.estimated_xpr > parseFloat(budgetXpr) ? 'WARNING: Budget is BELOW estimated cost — bid higher to cover costs or skip' : 'Budget covers estimated costs'}

Evaluate this job and if it matches your capabilities, submit a bid using xpr_submit_bid.
Set your bid amount based on the cost analysis above — at LEAST the estimated cost.
You MAY bid above the posted budget if costs require it — the client can accept or reject.
Include a brief proposal (1-2 sentences) saying what you will deliver.
If the job is outside your capabilities or wildly unprofitable (budget < 25% of cost), skip it.`;

        runAgent('poll:new_open_job', {
          job_id: job.id, client: job.client, title: job.title,
          description: job.description, budget_xpr: budgetXpr, deadline: job.deadline,
          cost_estimate: cost,
        }, prompt).catch(err => {
          console.error(`[poller] Failed to process open job:`, err.message);
        });
      }
    }

    // 3. Check for new feedback about this agent
    if (listFeedback) {
      const res: any = await listFeedback.handler({ agent: account, limit: 20 });
      const items: any[] = res?.feedback || res?.items || res || [];
      for (const fb of items) {
        if (!fb || fb.id == null) continue;
        if (knownFeedbackIds.has(fb.id)) continue;
        knownFeedbackIds.add(fb.id);

        // Skip seed
        if (firstPoll) continue;

        console.log(`[poller] New feedback #${fb.id} from ${fb.reviewer}: score ${fb.score}/5`);
        runAgent('poll:new_feedback', {
          feedback_id: fb.id, reviewer: fb.reviewer,
          score: fb.score, tags: fb.tags, job_hash: fb.job_hash,
        }, `New feedback #${fb.id} from ${fb.reviewer}: ${fb.score}/5 stars. Acknowledge if appropriate.`).catch(err => {
          console.error(`[poller] Failed to process new feedback:`, err.message);
        });
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
        runAgent('poll:validation_challenged', {
          validation_id: v.id, validator: v.validator, job_hash: v.job_hash,
        }, `Validation #${v.id} has been challenged. Review the challenge and respond.`).catch(err => {
          console.error(`[poller] Failed to process validation challenge:`, err.message);
        });
      }
    }
  } catch (err: any) {
    console.error(`[poller] Poll error:`, err.message);
  }

  if (firstPoll) {
    firstPoll = false;
    console.log(`[poller] Seeded: ${knownJobStates.size} agent jobs, ${knownOpenJobIds.size} open jobs, ${knownFeedbackIds.size} feedback, ${knownChallengeIds.size} challenges`);
  }

  // Persist state after each poll cycle
  savePollerState();

  // Schedule next poll
  if (!shuttingDown) {
    pollTimer = setTimeout(pollOnChain, POLL_INTERVAL);
    pollTimer.unref();
  }
}

function startPoller(): void {
  if (!POLL_ENABLED) {
    console.log('[poller] Polling disabled (POLL_ENABLED=false)');
    return;
  }
  // Restore persisted state (avoids re-seeding and duplicate processing after restart)
  loadPollerState();
  console.log(`[poller] Starting on-chain poller (interval: ${POLL_INTERVAL / 1000}s)`);
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
    console.error('[agent-runner] The private key may not match this account. Check .env');
  }
}

const port = parseInt(process.env.PORT || '8080');
const server = app.listen(port, () => {
  console.log(`[agent-runner] Listening on port ${port}`);
  console.log(`[agent-runner] ${tools.length} tools loaded (A2A mode: ${a2aToolMode}, ${a2aToolMode === 'readonly' ? readonlyTools.length : tools.length} tools for A2A)`);
  console.log(`[agent-runner] Account: ${process.env.XPR_ACCOUNT}`);
  console.log(`[agent-runner] Model: ${MODEL}`);
  console.log(`[agent-runner] Network: ${process.env.XPR_NETWORK || 'testnet'}`);
  console.log(`[agent-runner] A2A auth: ${a2aAuthConfig.authRequired ? 'required' : 'optional'}, rate limit: ${a2aAuthConfig.rateLimit}/min`);
  if (a2aAuthConfig.minTrustScore > 0) console.log(`[agent-runner] A2A min trust score: ${a2aAuthConfig.minTrustScore}`);
  if (a2aAuthConfig.minKycLevel > 0) console.log(`[agent-runner] A2A min KYC level: ${a2aAuthConfig.minKycLevel}`);
  console.log(`[agent-runner] Poller: ${POLL_ENABLED ? `enabled (${POLL_INTERVAL / 1000}s interval)` : 'disabled'}`);
  if (skillResult.skills.length > 0) {
    console.log(`[agent-runner] Skills: ${skillResult.skills.map(s => `${s.manifest.name}@${s.manifest.version}`).join(', ')}`);
  }

  // Auto-register after server is ready, then start poller
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
