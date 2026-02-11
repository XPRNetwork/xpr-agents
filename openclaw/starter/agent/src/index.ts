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
   - \`store_deliverable\` with content_type "text/csv" — structured data

   **Images (AI-generated):**
   - \`generate_image\` with a detailed prompt → returns image URL
   - Then \`store_deliverable\` with content_type "image/png" and source_url = the returned URL
   - You can generate multiple variants and let the client choose

   **Video (AI-generated):**
   - \`generate_video\` with a descriptive prompt → returns video URL
   - Then \`store_deliverable\` with content_type "video/mp4" and source_url = the returned URL
   - For image-to-video: first generate an image, then pass it as image_url to generate_video

   **Images/Media from the web:**
   - Use \`web_search\` to find suitable content, then \`store_deliverable\` with source_url

   **Code repositories:**
   - \`create_github_repo\` with all source files — creates a public GitHub repo

3. Use the returned URL as \`evidence_uri\` when calling \`xpr_deliver_job\`

**You have powerful creative capabilities:**
- AI image generation (Flux model via Replicate) — photorealistic, artistic, any style
- AI video generation — text-to-video and image-to-video
- PDF generation — professional documents from Markdown
- GitHub repos — complete code projects with multiple files
- Web search — find and source existing content from the internet
- NEVER say you can't create images or videos — you have the tools!
- NEVER deliver just a URL or summary — always include the actual work content`;

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
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
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

    // Parse capabilities from on-chain data
    let capabilities: string[] = [];
    if (Array.isArray(agentData.capabilities)) {
      capabilities = agentData.capabilities;
    }

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
      skills: capabilities.map((cap: string) => ({
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

// ── Deliverables store ────────────────────
// Agents store deliverable content here before calling xpr_deliver_job.
// Clients/frontend can fetch via GET /deliverables/:jobId
const MAX_DELIVERABLES = 200;
const deliverables = new Map<number, { content: string; content_type: string; media_url?: string; created_at: string }>();

function setDeliverable(jobId: number, entry: { content: string; content_type: string; media_url?: string; created_at: string }): void {
  deliverables.set(jobId, entry);
  if (deliverables.size > MAX_DELIVERABLES) {
    const oldest = deliverables.keys().next().value;
    if (oldest !== undefined) deliverables.delete(oldest);
  }
}

// Upload JSON to IPFS via Pinata (for text-based content)
async function uploadJsonToIpfs(content: string, jobId: number, contentType: string): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;
  try {
    const resp = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        pinataContent: { job_id: jobId, content, content_type: contentType, created_at: new Date().toISOString() },
        pinataMetadata: { name: `job-${jobId}-deliverable` },
      }),
    });
    const data = await resp.json() as { IpfsHash?: string };
    if (data.IpfsHash) return `https://ipfs.io/ipfs/${data.IpfsHash}`;
  } catch (e) { console.error('[ipfs] JSON upload failed:', e); }
  return null;
}

// Upload binary file to IPFS via Pinata (for PDF, images, audio, video)
async function uploadBinaryToIpfs(buffer: Buffer, filename: string, mimeType: string): Promise<string | null> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return null;
  try {
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mimeType }), filename);
    formData.append('pinataMetadata', JSON.stringify({ name: filename }));
    const resp = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: formData,
    });
    const data = await resp.json() as { IpfsHash?: string };
    if (data.IpfsHash) return `https://ipfs.io/ipfs/${data.IpfsHash}`;
  } catch (e) { console.error('[ipfs] Binary upload failed:', e); }
  return null;
}

// Download binary content from a URL
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB
async function downloadFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const contentLength = parseInt(resp.headers.get('content-length') || '0');
    if (contentLength > MAX_DOWNLOAD_SIZE) { console.warn(`[download] Too large: ${contentLength}`); return null; }
    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) return null;
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType.split(';')[0].trim() };
  } catch (e) { console.error(`[download] Failed: ${url}`, e); return null; }
}

// Generate PDF from markdown content using pdfkit
function stripMarkdownInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
}

async function generatePdfFromMarkdown(content: string): Promise<Buffer> {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const lines = content.split('\n');
      let inCodeBlock = false;
      for (const line of lines) {
        if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; doc.moveDown(0.3); continue; }
        if (inCodeBlock) { doc.fontSize(9).font('Courier').text(line); continue; }
        if (line.startsWith('# ')) {
          doc.moveDown(0.5).fontSize(22).font('Helvetica-Bold').text(stripMarkdownInline(line.slice(2))).moveDown(0.3);
        } else if (line.startsWith('## ')) {
          doc.moveDown(0.4).fontSize(17).font('Helvetica-Bold').text(stripMarkdownInline(line.slice(3))).moveDown(0.2);
        } else if (line.startsWith('### ')) {
          doc.moveDown(0.3).fontSize(14).font('Helvetica-Bold').text(stripMarkdownInline(line.slice(4))).moveDown(0.2);
        } else if (/^[-*] /.test(line)) {
          doc.fontSize(11).font('Helvetica').text(`  \u2022 ${stripMarkdownInline(line.slice(2))}`, { indent: 10 });
        } else if (/^\d+\.\s/.test(line)) {
          const m = line.match(/^(\d+\.)\s(.*)/);
          if (m) doc.fontSize(11).font('Helvetica').text(`  ${m[1]} ${stripMarkdownInline(m[2])}`, { indent: 10 });
        } else if (line.trim() === '') {
          doc.moveDown(0.4);
        } else {
          doc.fontSize(11).font('Helvetica').text(stripMarkdownInline(line));
        }
      }
      doc.end();
    } catch (err) { reject(err); }
  });
}

// Create a GitHub repo with deliverable files
async function createGithubRepo(
  jobId: number, repoName: string, description: string, files: Record<string, string>
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  if (!token || !owner) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28',
  };
  try {
    // Create repo
    const createResp = await fetch('https://api.github.com/user/repos', {
      method: 'POST', headers,
      body: JSON.stringify({ name: repoName, description, private: false, auto_init: true }),
    });
    if (!createResp.ok) { console.error('[github] Create repo failed:', await createResp.text()); return null; }
    const repo = await createResp.json() as { full_name: string; html_url: string; default_branch: string };

    // Get base tree SHA
    const refResp = await fetch(`https://api.github.com/repos/${repo.full_name}/git/ref/heads/${repo.default_branch}`, { headers });
    const refData = await refResp.json() as { object: { sha: string } };
    const commitResp = await fetch(`https://api.github.com/repos/${repo.full_name}/git/commits/${refData.object.sha}`, { headers });
    const commitData = await commitResp.json() as { tree: { sha: string } };

    // Create blobs + tree
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const [filePath, fileContent] of Object.entries(files)) {
      const blobResp = await fetch(`https://api.github.com/repos/${repo.full_name}/git/blobs`, {
        method: 'POST', headers, body: JSON.stringify({ content: fileContent, encoding: 'utf-8' }),
      });
      const blobData = await blobResp.json() as { sha: string };
      treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: blobData.sha });
    }
    const treeResp = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees`, {
      method: 'POST', headers, body: JSON.stringify({ base_tree: commitData.tree.sha, tree: treeItems }),
    });
    const treeData = await treeResp.json() as { sha: string };

    // Create commit + update ref
    const newCommitResp = await fetch(`https://api.github.com/repos/${repo.full_name}/git/commits`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `Job #${jobId} deliverable`, tree: treeData.sha, parents: [refData.object.sha] }),
    });
    const newCommitData = await newCommitResp.json() as { sha: string };
    await fetch(`https://api.github.com/repos/${repo.full_name}/git/refs/heads/${repo.default_branch}`, {
      method: 'PATCH', headers, body: JSON.stringify({ sha: newCommitData.sha }),
    });

    console.log(`[github] Created repo: ${repo.html_url}`);
    return repo.html_url;
  } catch (e) { console.error('[github] Failed:', e); return null; }
}

// Encode text content as a data URI (fallback when no IPFS)
function toDataUri(content: string, contentType: string): string {
  const json = JSON.stringify({ content, content_type: contentType, created_at: new Date().toISOString() });
  return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

// ── Tool: store_deliverable ──
// Unified deliverable pipeline: routes by content_type to the right storage strategy
tools.push({
  name: 'store_deliverable',
  description: [
    'Store job deliverable content before delivering on-chain. Call this BEFORE xpr_deliver_job.',
    'Routes by content_type:',
    '  text/markdown (default) — stores as JSON on IPFS',
    '  application/pdf — generates PDF from your Markdown, uploads binary to IPFS',
    '  image/*, audio/*, video/* — downloads source_url and uploads binary to IPFS',
    '  text/csv, text/plain, text/html — stores as JSON on IPFS',
  ].join('\n'),
  parameters: {
    type: 'object',
    required: ['job_id', 'content'],
    properties: {
      job_id: { type: 'number', description: 'Job ID' },
      content: { type: 'string', description: 'Full deliverable content (markdown, text, CSV, etc.). For media types, can be empty if source_url is provided.' },
      content_type: { type: 'string', description: 'MIME type: text/markdown (default), application/pdf, image/png, audio/mpeg, video/mp4, text/csv, etc.' },
      source_url: { type: 'string', description: 'URL to download binary content from (for image/audio/video). The file is downloaded and uploaded to IPFS.' },
      filename: { type: 'string', description: 'Optional filename for the deliverable (e.g. "report.pdf")' },
    },
  },
  handler: async ({ job_id, content, content_type, source_url, filename }: {
    job_id: number; content: string; content_type?: string; source_url?: string; filename?: string;
  }) => {
    const ct = content_type || 'text/markdown';
    const ts = new Date().toISOString();

    // ── PDF: generate from markdown, upload binary ──
    if (ct === 'application/pdf') {
      try {
        const pdfBuffer = await generatePdfFromMarkdown(content);
        setDeliverable(job_id, { content, content_type: ct, created_at: ts });
        const ipfsUrl = await uploadBinaryToIpfs(pdfBuffer, filename || `job-${job_id}.pdf`, 'application/pdf');
        if (ipfsUrl) {
          console.log(`[deliverable] Job ${job_id} PDF → IPFS: ${ipfsUrl}`);
          return { stored: true, url: ipfsUrl, storage: 'ipfs', content_type: ct };
        }
        // Fallback: PDF as data URI
        const dataUri = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
        console.log(`[deliverable] Job ${job_id} PDF → data URI`);
        return { stored: true, url: dataUri, storage: 'data_uri', content_type: ct };
      } catch (err: any) {
        console.error(`[deliverable] PDF generation failed:`, err.message);
        return { stored: false, error: `PDF generation failed: ${err.message}` };
      }
    }

    // ── Binary media: download source_url → IPFS ──
    if (ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/') || ct === 'application/octet-stream') {
      let buffer: Buffer | null = null;
      let mimeType = ct;

      if (source_url) {
        const downloaded = await downloadFromUrl(source_url);
        if (downloaded) { buffer = downloaded.buffer; mimeType = downloaded.mimeType || ct; }
      } else if (content) {
        // Content provided as base64
        buffer = Buffer.from(content, 'base64');
      }

      if (!buffer) return { stored: false, error: 'Failed to obtain binary content. Provide source_url for media types.' };

      setDeliverable(job_id, { content: source_url || '[binary]', content_type: mimeType, created_at: ts });
      const ext = mimeType.split('/')[1]?.split('+')[0] || 'bin';
      const ipfsUrl = await uploadBinaryToIpfs(buffer, filename || `job-${job_id}.${ext}`, mimeType);
      if (ipfsUrl) {
        console.log(`[deliverable] Job ${job_id} ${mimeType} → IPFS: ${ipfsUrl}`);
        return { stored: true, url: ipfsUrl, storage: 'ipfs', content_type: mimeType };
      }
      const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
      return { stored: true, url: dataUri, storage: 'data_uri', content_type: mimeType };
    }

    // ── Text types: markdown, plain, csv, html — JSON on IPFS ──
    setDeliverable(job_id, { content, content_type: ct, created_at: ts });
    const ipfsUrl = await uploadJsonToIpfs(content, job_id, ct);
    if (ipfsUrl) {
      console.log(`[deliverable] Job ${job_id} ${ct} → IPFS: ${ipfsUrl}`);
      return { stored: true, url: ipfsUrl, storage: 'ipfs', content_type: ct };
    }
    const dataUri = toDataUri(content, ct);
    console.log(`[deliverable] Job ${job_id} ${ct} → data URI (${dataUri.length} chars)`);
    return { stored: true, url: dataUri, storage: 'data_uri', content_type: ct };
  },
});

// ── Tool: create_github_repo ──
tools.push({
  name: 'create_github_repo',
  description: 'Create a GitHub repository with code deliverables for a job. Requires GITHUB_TOKEN and GITHUB_OWNER env vars. Returns the repo URL to use as evidence_uri when calling xpr_deliver_job.',
  parameters: {
    type: 'object',
    required: ['job_id', 'name', 'files'],
    properties: {
      job_id: { type: 'number', description: 'Job ID' },
      name: { type: 'string', description: 'Repository name (e.g. "job-59-credit-union-report")' },
      description: { type: 'string', description: 'Repository description' },
      files: { type: 'object', description: 'Object mapping file paths to content, e.g. {"src/index.ts": "...", "README.md": "..."}' },
    },
  },
  handler: async ({ job_id, name, description, files }: {
    job_id: number; name: string; description?: string; files: Record<string, string>;
  }) => {
    if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_OWNER) {
      return { error: 'GitHub not configured. Set GITHUB_TOKEN and GITHUB_OWNER in .env' };
    }
    const repoUrl = await createGithubRepo(job_id, name, description || `Deliverable for job #${job_id}`, files);
    if (!repoUrl) return { error: 'Failed to create GitHub repository' };

    setDeliverable(job_id, {
      content: `GitHub repository: ${repoUrl}\n\nFiles: ${Object.keys(files).join(', ')}`,
      content_type: 'github:repo', media_url: repoUrl, created_at: new Date().toISOString(),
    });
    return { stored: true, url: repoUrl, storage: 'github', content_type: 'github:repo' };
  },
});

// ── Tool: generate_image ──
// AI image generation via Replicate (Flux Schnell — fast, high quality)
tools.push({
  name: 'generate_image',
  description: [
    'Generate an image from a text prompt using AI (Replicate Flux model).',
    'Returns an image URL. Use this URL as source_url with store_deliverable (content_type: "image/png") to upload to IPFS for delivery.',
    'Requires REPLICATE_API_TOKEN in .env.',
  ].join(' '),
  parameters: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate. Be specific about style, composition, colors, lighting.' },
      aspect_ratio: { type: 'string', description: 'Aspect ratio: "1:1" (default), "16:9", "9:16", "4:3", "3:4", "21:9"' },
      num_outputs: { type: 'number', description: 'Number of images (1-4, default 1)' },
    },
  },
  handler: async ({ prompt, aspect_ratio, num_outputs }: { prompt: string; aspect_ratio?: string; num_outputs?: number }) => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { error: 'REPLICATE_API_TOKEN not set. Add it to .env to enable AI image generation.' };

    try {
      const createResp = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
        body: JSON.stringify({
          input: {
            prompt,
            aspect_ratio: aspect_ratio || '1:1',
            num_outputs: Math.min(num_outputs || 1, 4),
            output_format: 'png',
          },
        }),
      });

      if (!createResp.ok) {
        const errText = await createResp.text();
        return { error: `Replicate API error: ${createResp.status} ${errText}` };
      }

      let result = await createResp.json() as any;

      // If not using Prefer: wait, poll for completion
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        const deadline = Date.now() + 60000;
        while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1000));
          const pollResp = await fetch(result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          result = await pollResp.json();
        }
      }

      if (result.status === 'failed') return { error: `Image generation failed: ${result.error || 'Unknown error'}` };
      if (result.status !== 'succeeded') return { error: 'Image generation timed out (60s). Try a simpler prompt.' };

      const outputs: string[] = Array.isArray(result.output) ? result.output : [result.output];
      console.log(`[replicate] Image generated: ${outputs[0]}`);

      return {
        success: true,
        urls: outputs,
        primary_url: outputs[0],
        prompt,
        model: 'flux-schnell',
        instruction: 'Now call store_deliverable with content_type "image/png" and source_url set to primary_url, then deliver the job.',
      };
    } catch (e: any) {
      return { error: `Image generation failed: ${e.message}` };
    }
  },
});

// ── Tool: generate_video ──
// AI video generation via Replicate
tools.push({
  name: 'generate_video',
  description: [
    'Generate a video from a text prompt (or animate an image) using AI via Replicate.',
    'Returns a video URL. Use this URL as source_url with store_deliverable (content_type: "video/mp4") to upload to IPFS for delivery.',
    'For text-to-video: provide just a prompt. For image-to-video: also provide image_url.',
    'Requires REPLICATE_API_TOKEN in .env.',
  ].join(' '),
  parameters: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Description of the video to generate. Be specific about motion, scene, and style.' },
      image_url: { type: 'string', description: 'Optional: URL of a source image to animate (image-to-video mode).' },
    },
  },
  handler: async ({ prompt, image_url }: { prompt: string; image_url?: string }) => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return { error: 'REPLICATE_API_TOKEN not set. Add it to .env to enable AI video generation.' };

    try {
      // Use minimax for text-to-video, stability for image-to-video
      const model = image_url
        ? 'stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438'
        : 'minimax/video-01-live';
      const input: Record<string, any> = { prompt };
      if (image_url) {
        input.input_image = image_url;
        delete input.prompt; // SVD uses input_image not prompt
      }

      // Use versioned endpoint for stability model, model endpoint for minimax
      const url = model.includes(':')
        ? 'https://api.replicate.com/v1/predictions'
        : `https://api.replicate.com/v1/models/${model}/predictions`;
      const body: Record<string, any> = { input };
      if (model.includes(':')) body.version = model.split(':')[1];

      const createResp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!createResp.ok) {
        const errText = await createResp.text();
        return { error: `Replicate API error: ${createResp.status} ${errText}` };
      }

      let result = await createResp.json() as any;
      console.log(`[replicate] Video prediction created: ${result.id} (model: ${model.split(':')[0]})`);

      // Poll for completion (video takes longer — up to 5 minutes)
      const deadline = Date.now() + 300000;
      while (result.status !== 'succeeded' && result.status !== 'failed' && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000));
        const pollResp = await fetch(result.urls?.get || `https://api.replicate.com/v1/predictions/${result.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        result = await pollResp.json();
      }

      if (result.status === 'failed') return { error: `Video generation failed: ${result.error || 'Unknown error'}` };
      if (result.status !== 'succeeded') return { error: 'Video generation timed out (5min). Try a simpler prompt.' };

      const output = Array.isArray(result.output) ? result.output[0] : result.output;
      console.log(`[replicate] Video generated: ${output}`);

      return {
        success: true,
        url: output,
        prompt,
        model: model.split(':')[0],
        instruction: 'Now call store_deliverable with content_type "video/mp4" and source_url set to the url, then deliver the job.',
      };
    } catch (e: any) {
      return { error: `Video generation failed: ${e.message}` };
    }
  },
});

// Serve deliverables
app.get('/deliverables/:jobId', (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const entry = deliverables.get(jobId);
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
        runAgent('poll:new_open_job', {
          job_id: job.id, client: job.client, title: job.title,
          description: job.description, budget_xpr: budgetXpr, deadline: job.deadline,
        }, `${firstPoll ? 'Existing' : 'New'} open job #${job.id} "${job.title}" with budget ${budgetXpr} XPR. When bidding, use the XPR amount directly (e.g. ${budgetXpr} or less). Evaluate if you should bid on it.`).catch(err => {
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
