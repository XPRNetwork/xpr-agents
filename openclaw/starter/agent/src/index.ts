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
      rpcEndpoint: process.env.XPR_RPC_ENDPOINT || 'https://tn1.protonnz.com',
      indexerUrl: process.env.INDEXER_URL || 'http://indexer:3001',
      confirmHighRisk: false, // autonomous mode - no confirmation gates
      maxTransferAmount: parseInt(process.env.MAX_TRANSFER_AMOUNT || '1000000'),
      contracts: {},
    };
  },
};

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
systemPrompt += `\n\n## Delivering Jobs\nWhen delivering a job, ALWAYS:\n1. Call \`store_deliverable\` with the full deliverable content first\n2. Use the returned URL as the \`evidence_uri\` when calling \`xpr_deliver_job\`\nThis ensures the client can view your work.`;

// Convert tools to Anthropic API format (lazy — picks up tools added later like store_deliverable)
function getAnthropicTools(): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

const anthropic = new Anthropic();
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '10');
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-20250514';

// A2A authentication config
const a2aAuthConfig: A2AAuthConfig = {
  rpcEndpoint: process.env.XPR_RPC_ENDPOINT || 'https://tn1.protonnz.com',
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
function getReadonlyAnthropicTools(): Anthropic.Tool[] {
  return readonlyTools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
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

      // If no tool use, return the text response
      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        console.log(`[agent] Completed in ${turn + 1} turn(s): ${text.slice(0, 200)}`);
        return text;
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute tool calls
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

      messages.push({ role: 'user', content: toolResults });
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
const deliverables = new Map<number, { content: string; created_at: string }>();

// Internal tool: store_deliverable (not an on-chain tool, just local storage)
tools.push({
  name: 'store_deliverable',
  description: 'Store job deliverable content locally before delivering on-chain. The content will be served at GET /deliverables/:jobId on this agent\'s endpoint. Call this BEFORE xpr_deliver_job.',
  parameters: {
    type: 'object',
    required: ['job_id', 'content'],
    properties: {
      job_id: { type: 'number', description: 'Job ID' },
      content: { type: 'string', description: 'The full deliverable content (text, markdown, etc.)' },
    },
  },
  handler: async ({ job_id, content }: { job_id: number; content: string }) => {
    deliverables.set(job_id, { content, created_at: new Date().toISOString() });
    const baseUrl = process.env.AGENT_PUBLIC_URL || `http://localhost:${process.env.PORT || '8080'}`;
    return { stored: true, url: `${baseUrl}/deliverables/${job_id}` };
  },
});

// Serve deliverables
app.get('/deliverables/:jobId', (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const entry = deliverables.get(jobId);
  if (!entry) {
    return res.status(404).json({ error: 'Deliverable not found' });
  }
  // Return as JSON with content
  res.json({ job_id: jobId, content: entry.content, created_at: entry.created_at });
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
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let firstPoll = true;                               // true until first poll completes

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

        // First poll — just seed state, don't trigger
        if (prevState === undefined) {
          // But if this is a newly-assigned job (not first poll) in FUNDED state, act on it
          if (!firstPoll && job.state >= 1 && job.state <= 1) {
            const jobBudgetXpr = (job.amount / 10000).toFixed(4);
            console.log(`[poller] Newly assigned job #${job.id} in FUNDED state`);
            runAgent('poll:job_assigned', {
              job_id: job.id, client: job.client, agent: job.agent,
              state: job.state, title: job.title, amount: job.amount, budget_xpr: jobBudgetXpr,
            }, `You have been assigned to job #${job.id} "${job.title}" (${jobBudgetXpr} XPR). It is FUNDED. Accept the job, start working on it, and deliver the result.`).catch(err => {
              console.error(`[poller] Failed to process newly assigned job:`, err.message);
            });
          }
          continue;
        }

        // State changed — notify the agent
        if (prevState !== job.state) {
          const stateNames = ['CREATED', 'FUNDED', 'ACCEPTED', 'INPROGRESS', 'DELIVERED', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'ARBITRATED'];
          const fromName = stateNames[prevState] || String(prevState);
          const toName = stateNames[job.state] || String(job.state);
          console.log(`[poller] Job #${job.id} state changed: ${fromName} → ${toName}`);

          const jobBudgetXpr = (job.amount / 10000).toFixed(4);
          runAgent('poll:job_state_change', {
            job_id: job.id, client: job.client, agent: job.agent,
            from_state: prevState, to_state: job.state,
            title: job.title, amount: job.amount, budget_xpr: jobBudgetXpr,
          }, `Job #${job.id} "${job.title}" (budget: ${jobBudgetXpr} XPR) changed from ${fromName} to ${toName}. The amount field in raw units is ${job.amount} (divide by 10000 for XPR). Review and take appropriate action.`).catch(err => {
            console.error(`[poller] Failed to process job state change:`, err.message);
          });
        }
      }
    }

    // 2. Check for new open jobs (bidding opportunities)
    if (listOpenJobs) {
      const res: any = await listOpenJobs.handler({ limit: 20 });
      const jobs: any[] = res?.items || res || [];
      for (const job of jobs) {
        if (!job || job.id == null) continue;
        if (knownOpenJobIds.has(job.id)) continue;
        knownOpenJobIds.add(job.id);

        // Don't trigger on first poll (seed)
        if (firstPoll) continue;

        const budgetXpr = (job.amount / 10000).toFixed(4);
        console.log(`[poller] New open job #${job.id}: "${job.title}" (${budgetXpr} XPR)`);
        runAgent('poll:new_open_job', {
          job_id: job.id, client: job.client, title: job.title,
          description: job.description, amount: job.amount, budget_xpr: budgetXpr, deadline: job.deadline,
        }, `New open job #${job.id} "${job.title}" with budget ${budgetXpr} XPR. The amount field in raw units is ${job.amount} (divide by 10000 for XPR). Bid at or below the budget. Evaluate if you should bid on it.`).catch(err => {
          console.error(`[poller] Failed to process new open job:`, err.message);
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
  if (!getAgent || !registerAgent) {
    console.warn('[agent-runner] Registration tools not found, skipping auto-register');
    return;
  }

  try {
    const agentData: any = await getAgent.handler({ account });
    if (agentData && agentData.account) {
      console.log(`[agent-runner] Already registered on-chain as "${agentData.name}"`);
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
      endpoint: `http://localhost:${process.env.PORT || '8080'}`,
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
