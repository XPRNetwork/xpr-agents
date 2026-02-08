/**
 * XPR Agent Runner
 *
 * Autonomous agent that:
 * 1. Receives webhook events from the indexer
 * 2. Runs them through Claude with XPR tools in an agentic loop
 * 3. Executes on-chain actions based on Claude's decisions
 */

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

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

// Load plugin (registers all 49 tools)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginFn = require('@xpr-agents/openclaw').default;
pluginFn(mockApi);

// Load agent-operator skill as system prompt
const skillPath = path.resolve(__dirname, '../../../skills/xpr-agent-operator/SKILL.md');
let systemPrompt = 'You are an autonomous AI agent on XPR Network.';
try {
  const raw = fs.readFileSync(skillPath, 'utf-8');
  // Strip YAML frontmatter
  const match = raw.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  systemPrompt = match ? match[1].trim() : raw;
} catch {
  console.warn('[agent] Could not load SKILL.md, using default system prompt');
}

// Add account context to system prompt
systemPrompt += `\n\n## Runtime Context\n- Account: ${process.env.XPR_ACCOUNT}\n- Network: ${process.env.XPR_NETWORK || 'testnet'}`;

// Convert tools to Anthropic API format
const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as Anthropic.Tool.InputSchema,
}));

const anthropic = new Anthropic();
const MAX_TURNS = parseInt(process.env.AGENT_MAX_TURNS || '10');
const MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-20250514';

// Track active runs to prevent duplicate processing
const activeRuns = new Set<string>();

async function runAgent(eventType: string, data: any, message: string): Promise<string> {
  const runKey = `${eventType}:${JSON.stringify(data).slice(0, 100)}`;
  if (activeRuns.has(runKey)) {
    return 'Already processing this event';
  }
  activeRuns.add(runKey);

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
        tools: anthropicTools,
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
          const tool = tools.find(t => t.name === block.name);
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
app.use(express.json());

// Webhook endpoint — receives events from the indexer
app.post('/hooks/agent', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (process.env.OPENCLAW_HOOK_TOKEN && token !== process.env.OPENCLAW_HOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
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

// Manual trigger — useful for testing
app.post('/run', async (req, res) => {
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

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    account: process.env.XPR_ACCOUNT,
    network: process.env.XPR_NETWORK || 'testnet',
    tools: tools.length,
    model: MODEL,
    active_runs: activeRuns.size,
  });
});

const port = parseInt(process.env.PORT || '8080');
app.listen(port, () => {
  console.log(`[agent-runner] Listening on port ${port}`);
  console.log(`[agent-runner] ${tools.length} tools loaded`);
  console.log(`[agent-runner] Account: ${process.env.XPR_ACCOUNT}`);
  console.log(`[agent-runner] Model: ${MODEL}`);
  console.log(`[agent-runner] Network: ${process.env.XPR_NETWORK || 'testnet'}`);
});
