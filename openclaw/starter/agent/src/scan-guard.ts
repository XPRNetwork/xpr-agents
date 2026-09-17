/**
 * Prompt-injection scan enforcement for on-chain / off-chain inbound content.
 *
 * SECURITY: the poller previously used only `scanInbound(...).text` and ignored the
 * scan's `.action`, so content flagged as a hard *block* (a serious injection attempt)
 * was still cleaned-ish and fed to the LLM. These helpers make the block decision
 * authoritative:
 *   scanClean — returns the cleaned text for allow/strip, and '' for block (drops it).
 *               Use for context fragments (revision notes, listing scope, thread lines)
 *               where dropping one entry is fine.
 *   scanJob   — scans a job's core agent-controlled fields and returns null if ANY is
 *               blocked, so the caller skips the whole LLM run for that job.
 */
import { scanInbound } from './security';

export function scanClean(text: string, source = 'poller'): string {
  const r = scanInbound(text || '', source);
  return r.action === 'block' ? '' : r.text;
}

export interface ScannedJobFields {
  title: string;
  description: string;
  deliverables: string;
}

export function scanJob(
  job: { id: number | string; title?: string; description?: string; deliverables?: string },
  log: (msg: string) => void = console.warn,
): ScannedJobFields | null {
  const t = scanInbound(job.title || '', 'poller');
  const d = scanInbound(job.description || '', 'poller');
  const dl = scanInbound(job.deliverables || '', 'poller');
  if (t.action === 'block' || d.action === 'block' || dl.action === 'block') {
    const flagged = [...t.flagged, ...d.flagged, ...dl.flagged].join(', ');
    log(`[security] Blocked poller job #${job.id} — inbound content flagged (${flagged}); skipping LLM run`);
    return null;
  }
  return { title: t.text, description: d.text, deliverables: dl.text };
}
