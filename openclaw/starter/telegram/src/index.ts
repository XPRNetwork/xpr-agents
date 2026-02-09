/**
 * XPR Agent Telegram Bridge
 *
 * Bridges Telegram messages to the agent runner and forwards
 * blockchain event notifications back to the owner's chat.
 *
 * Zero external dependencies — uses Node.js native fetch + http.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Config ──────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_URL = process.env.AGENT_URL || 'http://agent:8080';
const HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || '';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3002', 10);
const DATA_DIR = process.env.DATA_DIR || '/data';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MAX_MESSAGE_LENGTH = 4096;

if (!BOT_TOKEN) {
  console.error('[telegram] TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

// ── State ───────────────────────────────────────────────────────

interface BotState {
  ownerChatIds: number[];
}

const STATE_FILE = path.join(DATA_DIR, 'telegram-state.json');

function loadState(): BotState {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { ownerChatIds: [] };
  }
}

function saveState(state: BotState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[telegram] Failed to save state:', err);
  }
}

const state = loadState();

// ── Telegram API helpers ────────────────────────────────────────

async function tg(method: string, body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!data.ok) {
    console.error(`[telegram] API error (${method}):`, data.description);
  }
  return data;
}

async function sendMessage(chatId: number, text: string, parseMode = 'Markdown'): Promise<void> {
  // Chunk long messages
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: chunk,
      parse_mode: parseMode,
    }).catch(() => {
      // Retry without parse_mode if Markdown fails
      return tg('sendMessage', { chat_id: chatId, text: chunk });
    });
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Split at last newline within limit
    let splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) splitAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

async function sendTyping(chatId: number): Promise<void> {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// ── Message handling ────────────────────────────────────────────

async function handleMessage(chatId: number, text: string, firstName: string): Promise<void> {
  // /start — register as owner
  if (text === '/start') {
    if (!state.ownerChatIds.includes(chatId)) {
      state.ownerChatIds.push(chatId);
      saveState(state);
    }

    // Fetch agent info
    let agentInfo = '';
    try {
      const health = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await health.json() as Record<string, unknown>;
      agentInfo = `\n\nAgent: *${data.account}* (${data.network})\nTools: ${data.tools} | Model: ${data.model}`;
    } catch {
      agentInfo = '\n\n_Agent not reachable yet_';
    }

    await sendMessage(chatId,
      `Hey ${firstName}! I'm your XPR Agent bridge.\n` +
      `Send me any message and I'll forward it to your agent.${agentInfo}\n\n` +
      `Commands:\n` +
      `/status — agent health check\n` +
      `/jobs — list your jobs\n` +
      `/trust — check trust score\n` +
      `/help — show this message`
    );
    return;
  }

  // /help
  if (text === '/help') {
    await sendMessage(chatId,
      `*XPR Agent Telegram Bridge*\n\n` +
      `Just type a message and I'll forward it to your agent.\n\n` +
      `Commands:\n` +
      `/status — agent health\n` +
      `/jobs — list your jobs\n` +
      `/trust — check trust score\n` +
      `/start — re-register`
    );
    return;
  }

  // /status — health check
  if (text === '/status') {
    try {
      const health = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await health.json() as Record<string, unknown>;
      await sendMessage(chatId,
        `*Agent Status*\n` +
        `Account: \`${data.account}\`\n` +
        `Network: ${data.network}\n` +
        `Tools: ${data.tools}\n` +
        `Model: ${data.model}\n` +
        `Active runs: ${data.active_runs}`
      );
    } catch {
      await sendMessage(chatId, 'Agent is not reachable.');
    }
    return;
  }

  // /jobs — shortcut
  if (text === '/jobs') {
    text = 'List my current jobs and their status';
  }

  // /trust — shortcut
  if (text === '/trust') {
    text = 'What is my current trust score? Break it down by component.';
  }

  // Forward to agent runner
  if (!state.ownerChatIds.includes(chatId)) {
    state.ownerChatIds.push(chatId);
    saveState(state);
  }

  await sendTyping(chatId);

  try {
    const res = await fetch(`${AGENT_URL}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HOOK_TOKEN}`,
      },
      body: JSON.stringify({ prompt: text }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for Claude
    });

    const data = await res.json() as Record<string, unknown>;

    if (data.ok && data.result) {
      await sendMessage(chatId, String(data.result));
    } else if (data.error) {
      await sendMessage(chatId, `Error: ${data.error}`);
    } else {
      await sendMessage(chatId, 'Agent returned an empty response.');
    }
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      await sendMessage(chatId, 'Agent took too long to respond (>2 min). It may still be processing.');
    } else {
      await sendMessage(chatId, `Failed to reach agent: ${err.message}`);
    }
  }
}

// ── Long polling loop ───────────────────────────────────────────

let updateOffset = 0;

async function poll(): Promise<void> {
  while (true) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/getUpdates?offset=${updateOffset}&timeout=30&allowed_updates=["message"]`,
        { signal: AbortSignal.timeout(40_000) }
      );
      const data = await res.json() as { ok: boolean; result: any[] };

      if (data.ok && data.result) {
        for (const update of data.result) {
          updateOffset = update.update_id + 1;
          const msg = update.message;
          if (msg?.text) {
            handleMessage(msg.chat.id, msg.text.trim(), msg.from?.first_name || 'there')
              .catch(err => console.error('[telegram] Message handler error:', err));
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'TimeoutError') {
        console.error('[telegram] Poll error:', err.message);
        await new Promise(r => setTimeout(r, 5000)); // backoff on error
      }
    }
  }
}

// ── Webhook receiver (from indexer) ─────────────────────────────

function formatEvent(event: Record<string, unknown>): string {
  const type = String(event.type || 'unknown');
  const data = (event.data || {}) as Record<string, unknown>;

  const icons: Record<string, string> = {
    'job.created': '📋',
    'job.funded': '💰',
    'job.accepted': '✅',
    'job.started': '🚀',
    'job.delivered': '📦',
    'job.completed': '🎉',
    'job.disputed': '⚠️',
    'job.refunded': '↩️',
    'feedback.received': '⭐',
    'validation.challenged': '🔔',
    'bid.selected': '🏆',
    'bid.received': '📨',
  };

  const icon = icons[type] || '📡';
  let text = `${icon} *${type}*\n`;

  // Format key fields
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined && value !== '') {
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      text += `${key}: \`${display}\`\n`;
    }
  }

  return text;
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'telegram-bridge',
      registeredChats: state.ownerChatIds.length,
    }));
    return;
  }

  // Webhook from indexer
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      res.writeHead(200);
      res.end('ok');

      try {
        const event = JSON.parse(body);
        const text = formatEvent(event);

        // Notify all registered chats
        for (const chatId of state.ownerChatIds) {
          await sendMessage(chatId, text).catch(err =>
            console.error(`[telegram] Failed to notify chat ${chatId}:`, err)
          );
        }
      } catch (err) {
        console.error('[telegram] Failed to process webhook:', err);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

// ── Start ───────────────────────────────────────────────────────

server.listen(WEBHOOK_PORT, () => {
  console.log(`[telegram] Webhook receiver listening on port ${WEBHOOK_PORT}`);
  console.log(`[telegram] Agent URL: ${AGENT_URL}`);
  console.log(`[telegram] Registered chats: ${state.ownerChatIds.length}`);
  console.log('[telegram] Starting long poll...');
  poll();
});
