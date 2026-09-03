import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { AccountLink } from '@/components/AccountLink';
import { NftCard } from '@/components/NftCard';
import { Modal } from '@/components/Modal';
import { CopyButton } from '@/components/CopyButton';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useChainStream } from '@/hooks/useChainStream';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatRelativeTime,
  formatTimeline,
  getJob,
  getBidsForJob,
  getJobEvidence,
  getJobStateLabel,
  getDisputesForJob,
  getEscrowConfig,
  DISPUTE_RESOLUTION_LABELS,
  parseDeliverableUrls,
  parseDeliverableManifest,
  type DeliverableManifest,
  parseNftDeliverable,
  isEmptyName,
  getNftAssets,
  type Job,
  type Bid,
  type Dispute,
  type NftAsset,
} from '@/lib/registry';
import { STATE_COLORS, getTxId } from '@/lib/job-constants';
import IpfsImage from '@/components/IpfsImage';
import DeliveryHistory, { type HistoryCounts } from '@/components/DeliveryHistory';

interface JobDetailProps {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}

export function JobDetail({ job, onJobUpdated }: JobDetailProps) {
  const router = useRouter();
  const { session, transact, login } = useProton();
  const { addToast } = useToast();

  const [bids, setBids] = useState<Bid[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const submittingRef = useRef(false);

  // Deliverable viewer
  const [deliverableContent, setDeliverableContent] = useState<string | null>(null);
  const [deliverableType, setDeliverableType] = useState<string | null>(null);
  const [deliverableMediaUrl, setDeliverableMediaUrl] = useState<string | null>(null);
  const [deliverableLoading, setDeliverableLoading] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [additionalUrls, setAdditionalUrls] = useState<string[]>([]);
  const [nftAssets, setNftAssets] = useState<NftAsset[]>([]);
  const [manifest, setManifest] = useState<DeliverableManifest | null>(null);

  // Rating modal
  const [showRating, setShowRating] = useState(false);
  const [ratingAgent, setRatingAgent] = useState('');
  const [ratingJobId, setRatingJobId] = useState(0);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingTags, setRatingTags] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Dispute form state
  const [showDispute, setShowDispute] = useState(false);
  // Revision request state
  const [showRevise, setShowRevise] = useState(false);
  const reviseFormRef = useRef<HTMLDivElement>(null);
  const disputeFormRef = useRef<HTMLDivElement>(null);
  // The action buttons live in the rail; the forms render in the main column,
  // so bring the form on screen and focus it when it opens.
  const revealForm = (ref: React.RefObject<HTMLDivElement>) => {
    requestAnimationFrame(() => {
      const el = ref.current; if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const field = el.querySelector('textarea, input') as HTMLElement | null;
      setTimeout(() => field?.focus({ preventScroll: true }), 350);
    });
  };
  const [historyCounts, setHistoryCounts] = useState<HistoryCounts>({ deliveries: 0, revisions: 0, reviews: 0 });
  const [reviseNotes, setReviseNotes] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');

  // Resolve dispute state
  const [activeDispute, setActiveDispute] = useState<Dispute | null>(null);
  const [showResolve, setShowResolve] = useState(false);
  const [resolvePercent, setResolvePercent] = useState(100);
  const [resolveNotes, setResolveNotes] = useState('');
  const [escrowOwner, setEscrowOwner] = useState('');

  // Bid form state
  const [bidAmount, setBidAmount] = useState('');
  const [bidTimeline, setBidTimeline] = useState('');
  const [bidProposal, setBidProposal] = useState('');

  // Chain stream for live updates
  const { lastEvent } = useChainStream();
  const lastEventKeyRef = useRef(0);

  // Load bids, escrow config, deliverable, dispute on mount
  useEffect(() => {
    loadBids();
    getEscrowConfig().then(c => { if (c) setEscrowOwner(c.owner); }).catch(() => {});
    if (job.state >= 4 && job.agent && job.agent !== '.............') {
      fetchDeliverable(job.id);
    }
    if (job.state === 5 || job.state === 8) {
      loadDispute(job.id);
    }
  }, [job.id]);

  // Auto-refresh on chain events
  useEffect(() => {
    if (!lastEvent || lastEvent.key === lastEventKeyRef.current) return;
    lastEventKeyRef.current = lastEvent.key;
    if (lastEvent.label.startsWith('Job') || lastEvent.label === 'Bid Submitted' || lastEvent.label === 'Dispute Raised') {
      refreshJob();
      addToast({ type: 'info', message: lastEvent.detail || lastEvent.label });
    }
  }, [lastEvent]);

  async function loadBids() {
    setBidsLoading(true);
    try {
      const jobBids = await getBidsForJob(job.id);
      setBids(jobBids);
    } catch (e) {
      console.error('Failed to load bids:', e);
    } finally {
      setBidsLoading(false);
    }
  }

  async function refreshJob() {
    try {
      const updated = await getJob(job.id);
      if (updated && onJobUpdated) onJobUpdated(updated);
      loadBids();
    } catch {}
  }

  // IPFS gateway fallback helpers
  const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://w3s.link/ipfs/', 'https://4everland.io/ipfs/'];

  function extractIpfsCid(url: string): string | null {
    const match = url.match(/\/ipfs\/(Qm[a-zA-Z0-9]{44,}|bafy[a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }

  function handleBinaryResponse(resp: Response, url: string): boolean {
    const ct = (resp.headers.get('content-type') || '').split(';')[0].trim();
    if (ct.includes('application/pdf') || ct.startsWith('image/') || ct.startsWith('audio/') || ct.startsWith('video/')) {
      setDeliverableType(ct);
      setDeliverableMediaUrl(url);
      return true;
    }
    return false;
  }

  async function handleJsonResponse(resp: Response): Promise<boolean> {
    try {
      const data = await resp.json();
      const ct = data.content_type || 'text/markdown';
      setDeliverableType(ct);
      if (data.media_url) setDeliverableMediaUrl(data.media_url);
      setDeliverableContent(data.content || JSON.stringify(data, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  async function fetchDeliverable(jobId: number) {
    setDeliverableLoading(true);
    setDeliverableContent(null);
    setDeliverableType(null);
    setDeliverableMediaUrl(null);
    setAdditionalUrls([]);
    setNftAssets([]);
    setManifest(null);
    try {
      const rawEvidenceUri = await getJobEvidence(jobId);
      if (!rawEvidenceUri) {
        setDeliverableContent('No evidence submitted');
        return;
      }
      const manifestData = parseDeliverableManifest(rawEvidenceUri);
      if (manifestData) {
        setManifest(manifestData);
        setDeliverableType('manifest');
        setEvidenceUrl(null);
        return;
      }
      const nftData = parseNftDeliverable(rawEvidenceUri);
      if (nftData) {
        setDeliverableType('nft');
        const assets = await getNftAssets(nftData.asset_ids);
        setNftAssets(assets);
        return;
      }

      const { primary: evidenceUri, additional } = parseDeliverableUrls(rawEvidenceUri);
      setAdditionalUrls(additional);
      setEvidenceUrl(evidenceUri);

      if (evidenceUri.startsWith('data:')) {
        const mimeMatch = evidenceUri.match(/^data:([^;,]+)/);
        const mime = mimeMatch?.[1] || 'application/json';
        if (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
          setDeliverableType(mime);
          setDeliverableMediaUrl(evidenceUri);
          return;
        }
        try {
          const base64 = evidenceUri.split(',')[1];
          const decoded = JSON.parse(atob(base64));
          setDeliverableType(decoded.content_type || 'text/markdown');
          setDeliverableContent(decoded.content || evidenceUri);
        } catch {
          setDeliverableContent(evidenceUri);
        }
        return;
      }

      if (evidenceUri.includes('github.com/')) {
        setDeliverableType('github:repo');
        setDeliverableMediaUrl(evidenceUri);
        setDeliverableContent(evidenceUri);
        return;
      }

      const cid = extractIpfsCid(evidenceUri);
      let fetched = false;

      if (cid) {
        const urls = [evidenceUri];
        for (const gw of IPFS_GATEWAYS) {
          const gwUrl = `${gw}${cid}`;
          if (gwUrl !== evidenceUri) urls.push(gwUrl);
        }
        for (const url of urls) {
          try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (resp.ok) {
              if (handleBinaryResponse(resp, url)) { fetched = true; break; }
              if (await handleJsonResponse(resp)) { fetched = true; break; }
            }
          } catch { /* next gateway */ }
        }
      } else {
        try {
          const resp = await fetch(evidenceUri, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            if (handleBinaryResponse(resp, evidenceUri)) {
              fetched = true;
            } else {
              fetched = await handleJsonResponse(resp);
            }
          }
        } catch {}
      }

      if (!fetched) {
        setDeliverableContent(evidenceUri);
      }
    } catch {
      setDeliverableContent(null);
    } finally {
      setDeliverableLoading(false);
    }
  }

  // === Transaction Handlers ===

  async function handleFundJob() {
    if (!session) return;
    setProcessing(true);
    try {
      const remaining = job.amount - job.funded_amount;
      const amountStr = `${(remaining / 10000).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: amountStr,
            memo: `fund:${job.id}`,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${job.id} funded with ${amountStr}`, txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to fund job' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleCancelJob() {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'cancel',
          data: {
            client: session.auth.actor,
            job_id: job.id,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${job.id} cancelled. Funds refunded.`, txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      router.push('/jobs');
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to cancel job' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleApproveDelivery() {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'approve',
          data: {
            client: session.auth.actor,
            job_id: job.id,
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${job.id} approved! Payment released to ${job.agent}.`, txId: getTxId(result) });
      setRatingAgent(job.agent);
      setRatingJobId(job.id);
      setRatingScore(5);
      setRatingTags('');
      setShowRating(true);
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to approve delivery' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleRevise() {
    if (!session || !reviseNotes.trim()) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'revise',
          data: {
            client: session.auth.actor,
            job_id: job.id,
            notes: reviseNotes.trim().slice(0, 512),
          },
        },
      ]);
      addToast({ type: 'success', message: `Job #${job.id} sent back to ${job.agent} for changes.`, txId: getTxId(result) });
      setShowRevise(false);
      setReviseNotes('');
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to request changes' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleDispute() {
    if (!session || !disputeReason.trim()) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'dispute',
          data: {
            raised_by: session.auth.actor,
            job_id: job.id,
            reason: disputeReason.trim(),
            evidence_uri: disputeEvidence.trim() || '',
          },
        },
      ]);
      addToast({ type: 'success', message: `Dispute raised for Job #${job.id}. An arbitrator will review.`, txId: getTxId(result) });
      setShowDispute(false);
      setDisputeReason('');
      setDisputeEvidence('');
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to raise dispute' });
    } finally {
      setProcessing(false);
    }
  }

  async function loadDispute(jobId: number) {
    try {
      const disputes = await getDisputesForJob(jobId);
      const pending = disputes.find(d => d.resolution === 0);
      setActiveDispute(pending || disputes[0] || null);
    } catch { setActiveDispute(null); }
  }

  async function handleResolveDispute() {
    if (!session || !activeDispute || !resolveNotes.trim()) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'arbitrate',
          data: {
            arbitrator: session.auth.actor,
            dispute_id: activeDispute.id,
            client_percent: resolvePercent,
            resolution_notes: resolveNotes.trim(),
          },
        },
      ]);
      addToast({ type: 'success', message: `Dispute #${activeDispute.id} resolved. ${resolvePercent}% to client, ${100 - resolvePercent}% to agent.`, txId: getTxId(result) });
      setShowResolve(false);
      setResolveNotes('');
      setActiveDispute(null);
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to resolve dispute' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleSubmitRating() {
    if (!session || !ratingAgent) return;
    setRatingSubmitting(true);
    try {
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_FEED,
            quantity: '1.0000 XPR',
            memo: `feedfee:${session.auth.actor}`,
          },
        },
        {
          account: CONTRACTS.AGENT_FEED,
          name: 'submit',
          data: {
            reviewer: session.auth.actor,
            agent: ratingAgent,
            score: ratingScore,
            tags: ratingTags,
            job_hash: String(ratingJobId),
            evidence_uri: '',
            amount_paid: 0,
          },
        },
      ]);
      addToast({ type: 'success', message: `Rated ${ratingAgent} ${ratingScore}/5`, txId: getTxId(result) });
      setShowRating(false);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Rating failed' });
      setShowRating(false);
    } finally {
      setRatingSubmitting(false);
    }
  }

  async function handleSubmitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!session || submittingRef.current) return;
    submittingRef.current = true;
    setProcessing(true);
    try {
      const amount = Math.floor(parseFloat(bidAmount) * 10000);
      const timelineDays = parseInt(bidTimeline);
      const timelineSeconds = timelineDays * 86400;
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'submitbid',
          data: {
            agent: session.auth.actor,
            job_id: job.id,
            amount,
            timeline: timelineSeconds,
            proposal: bidProposal,
          },
        },
      ]);
      addToast({ type: 'success', message: 'Bid submitted!', txId: getTxId(result) });
      setShowBidForm(false);
      setBidAmount('');
      setBidTimeline('');
      setBidProposal('');
      const jobBids = await getBidsForJob(job.id);
      setBids(jobBids);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to submit bid' });
    } finally {
      submittingRef.current = false;
      setProcessing(false);
    }
  }

  async function handleSelectBid(bid: Bid) {
    if (!session) return;
    setProcessing(true);
    try {
      const amountStr = `${(bid.amount / 10000).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'selectbid',
          data: {
            client: session.auth.actor,
            bid_id: bid.id,
          },
        },
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: amountStr,
            memo: `fund:${job.id}`,
          },
        },
      ]);
      addToast({ type: 'success', message: `Bid selected & funded with ${amountStr}! Agent ${bid.agent} assigned.`, txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await refreshJob();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to select bid' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleWithdrawBid(bidId: number) {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: 'withdrawbid',
          data: {
            agent: session.auth.actor,
            bid_id: bidId,
          },
        },
      ]);
      addToast({ type: 'success', message: 'Bid withdrawn', txId: getTxId(result) });
      const jobBids = await getBidsForJob(job.id);
      setBids(jobBids);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to withdraw bid' });
    } finally {
      setProcessing(false);
    }
  }

  // Permissions
  const isMyJob = session && job.client === session.auth.actor;
  const canFund = isMyJob && job.funded_amount < job.amount && job.state === 0 && job.agent && job.agent !== '.............';
  const canApprove = isMyJob && job.state === 4;
  const canCancel = isMyJob && (job.state === 0 || job.state === 1);
  const canDispute = isMyJob && job.state >= 2 && job.state <= 4;
  const isArbitrator = session && job.state === 5 && (
    (job.arbitrator === session.auth.actor) ||
    ((!job.arbitrator || job.arbitrator === '.............') && session.auth.actor === escrowOwner) ||
    (session.auth.actor === escrowOwner)
  );
  const canBid = job.state === 0 && (!job.agent || job.agent === '.............');

  // Lightweight markdown renderer
  function renderMarkdown(text: string): string {
    let html = text.replace(/<cite[^>]*>([\s\S]*?)<\/cite>/g, '$1');
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre style="background:rgb(var(--c-surface-2));padding:12px;border-radius:8px;overflow-x:auto;margin:8px 0"><code>${code.trim()}</code></pre>`;
    });

    const lines = html.split('\n');
    const result: string[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.includes('<pre ')) {
        result.push(line);
        while (i < lines.length - 1 && !lines[i].includes('</pre>')) {
          i++;
          result.push(lines[i]);
        }
        continue;
      }

      if (line.startsWith('### ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        result.push(`<h3 style="font-size:1rem;font-weight:600;color:rgb(var(--c-ink));margin:12px 0 4px">${line.slice(4)}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        result.push(`<h2 style="font-size:1.1rem;font-weight:700;color:rgb(var(--c-ink));margin:16px 0 6px">${line.slice(3)}</h2>`);
        continue;
      }
      if (line.startsWith('# ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        result.push(`<h1 style="font-size:1.25rem;font-weight:700;color:#fff;margin:16px 0 8px">${line.slice(2)}</h1>`);
        continue;
      }

      if (/^[-*] /.test(line)) {
        if (!inList) { result.push('<ul style="list-style:disc;padding-left:20px;margin:4px 0">'); inList = true; }
        result.push(`<li style="margin:2px 0">${applyInline(line.slice(2))}</li>`);
        continue;
      }

      if (inList) { result.push('</ul>'); inList = false; }

      if (/^---+$/.test(line.trim())) {
        result.push('<hr style="border-color:rgb(var(--c-line));margin:12px 0"/>');
        continue;
      }

      if (line.trim() === '') {
        result.push('<br/>');
        continue;
      }

      result.push(`<p style="margin:4px 0">${applyInline(line)}</p>`);
    }
    if (inList) result.push('</ul>');

    return result.join('\n');
  }

  function applyInline(text: string): string {
    function unescapeUrl(url: string): string {
      return url.replace(/&amp;/g, '&');
    }
    text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (_m, alt, url) =>
      `<img src="${unescapeUrl(url)}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0" loading="lazy" />`);
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code style="background:rgb(var(--c-surface-2));padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_m, label, url) =>
      `<a href="${unescapeUrl(url)}" target="_blank" rel="noopener noreferrer" style="color:rgb(var(--c-accent));text-decoration:underline">${label}</a>`);
    return text;
  }

  function isMarkdown(text: string): boolean {
    return /^#{1,3} /m.test(text) || /\*\*.+\*\*/.test(text) || /```/.test(text) || /^[-*] /m.test(text);
  }

  function isUrl(text: string): boolean {
    return /^https?:\/\/\S+$/.test(text.trim());
  }

  function getWinningBid(): Bid | undefined {
    if (!job.agent || job.agent === '.............') return undefined;
    return bids.find(b => b.agent === job.agent);
  }

  const assignedAgent = isEmptyName(job.agent) ? null : job.agent;
  // Markdown brief an operator can paste into any agent: the job plus the exact on-chain steps.
  const agentBrief = [
    `# Job #${job.id}: ${job.title}`,
    `Client: ${job.client} · Budget: ${formatXpr(job.amount)} · Deadline: ${job.deadline ? formatDate(job.deadline) : 'none'} · State: ${getJobStateLabel(job.state)}`,
    `Page: https://xpragents.com/jobs/${job.id}`,
    '',
    '## Description',
    job.description,
    '',
    '## Deliverables',
    ...job.deliverables.map((d, i) => `${i + 1}. ${d}`),
    '',
    '## How to work this job on XPR Network (contract agentescrow, sign with the proton CLI)',
    ...(assignedAgent ? [] : [`- Bid: proton action agentescrow submitbid '["<agent>",${job.id},<amount_raw_units>,<timeline_seconds>,"<proposal>"]' <agent>@active  (1 XPR = 10000 units; timeline = delivery time if selected)`]),
    `- After the client selects and funds: proton action agentescrow acceptjob '["<agent>",${job.id}]' <agent>@active, then startjob with the same arguments.`,
    `- Deliver exactly the listed deliverables: pin files to IPFS and call deliver with a JSON manifest in evidence_uri:`,
    `  proton action agentescrow deliver '["<agent>",${job.id},"{\"v\":1,\"files\":[{\"name\":\"result.png\",\"uri\":\"https://ipfs.io/ipfs/<cid>\",\"type\":\"image/png\"}],\"note\":\"method\"}"]' <agent>@active`,
    '- Full reference: https://xpragents.com/llms.txt',
  ].join('\n');
  const winningBid = getWinningBid();
  const fundedPct = job.amount > 0 ? Math.min(100, (job.funded_amount / job.amount) * 100) : 0;
  const remaining = Math.max(0, job.amount - job.funded_amount);
  const hasOwnAction = canBid || canFund || canApprove || canDispute || canCancel;
  const jumpToBids = () => {
    setShowBidForm(true);
    document.getElementById('bids')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const railRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm text-ink">{value}</dd>
    </div>
  );

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Main column */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          <header>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">#{job.id}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_COLORS[job.state] || 'bg-surface-2 text-ink-2'}`}>
                {getJobStateLabel(job.state)}
              </span>
              {canBid && <span className="font-mono text-[11px] uppercase tracking-label text-good">Open for bids</span>}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="font-display text-3xl font-semibold leading-tight text-ink" style={{ textWrap: 'balance' } as React.CSSProperties}>{job.title}</h1>
              <CopyButton text={agentBrief} label="Copy brief for an agent" className="shrink-0" />
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5">Posted by <AccountLink account={job.client} showAvatar avatarSize={18} className="font-mono text-ink-2" /></span>
              <span aria-hidden="true">·</span>
              <span title={formatDate(job.created_at)}>{formatRelativeTime(job.created_at)}</span>
            </p>
          </header>

          <section className="whitespace-pre-line text-[15px] leading-7 text-ink-2">{job.description}</section>

          {job.deliverables.length > 0 && (
            <section className="rounded-xl border border-line bg-canvas p-5">
              <h3 className="label mb-3">Deliverables</h3>
              <ol className="space-y-2">
                {job.deliverables.map((d, i) => (
                  <li key={i} className="flex gap-3 text-sm text-ink-2">
                    <span className="mt-0.5 w-5 shrink-0 font-mono text-xs tabular text-muted">{String(i + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 break-words">{d}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

        {/* Deliverable Result */}
        {job.state >= 4 && job.agent && (
          <section className="rounded-xl border border-line bg-canvas p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="label">Deliverable</h3>
              {!deliverableContent && !deliverableMediaUrl && !deliverableLoading && !deliverableType && (
                <button
                  onClick={() => fetchDeliverable(job.id)}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  View Result
                </button>
              )}
            </div>
            {deliverableLoading && (
              <div className="flex items-center gap-3 py-6 justify-center">
                <svg className="animate-spin h-5 w-5 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm text-ink-2">Loading the deliverable…</span>
              </div>
            )}

            {/* Manifest deliverable: file list + preview of the first image/PDF + note */}
            {deliverableType === 'manifest' && manifest && (
              <div className="space-y-4">
                {manifest.private && (
                  <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">Marked private by the agent: files may be encrypted; the key is shared off-chain.</p>
                )}
                {(() => {
                  const first = manifest.files.find(f => (f.type || '').startsWith('image/') || f.type === 'application/pdf' || /\.(png|jpe?g|gif|webp|svg|pdf)(\?|$)/i.test(f.uri));
                  if (!first) return null;
                  const isPdf = first.type === 'application/pdf' || /\.pdf(\?|$)/i.test(first.uri);
                  return isPdf
                    ? <iframe src={first.uri} title={first.name} className="h-96 w-full rounded-md border border-line bg-white" />
                    : <IpfsImage src={first.uri} alt={first.name} className="max-w-full rounded-md border border-line" />;
                })()}
                <ul className="divide-y divide-line rounded-md border border-line">
                  {manifest.files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <a href={f.uri} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-sm text-accent hover:text-accent-hover">{f.name}</a>
                        {f.type && <span className="font-mono text-[11px] text-muted">{f.type}</span>}
                      </span>
                      <a href={f.uri} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-xs text-muted hover:text-ink">open ↗</a>
                    </li>
                  ))}
                </ul>
                {manifest.note && (
                  <div className="rounded-md bg-surface p-3 text-sm text-ink-2 whitespace-pre-wrap">{manifest.note}</div>
                )}
              </div>
            )}

            {/* NFT deliverable */}
            {deliverableType === 'nft' && nftAssets.length > 0 && (
              <div>
                <div className={`grid gap-3 ${nftAssets.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {nftAssets.map((asset) => (
                    <NftCard key={asset.asset_id} asset={asset} compact={nftAssets.length > 2} />
                  ))}
                </div>
                {deliverableContent && (
                  <p className="text-sm text-ink-2 mt-3">{deliverableContent}</p>
                )}
              </div>
            )}

            {/* PDF embed */}
            {deliverableType === 'application/pdf' && deliverableMediaUrl && (
              <div>
                <iframe src={deliverableMediaUrl} className="w-full h-96 rounded border border-line bg-white" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:text-accent mt-2 inline-block">
                  Download PDF &#8599;
                </a>
              </div>
            )}

            {/* Image embed */}
            {deliverableType?.startsWith('image/') && deliverableMediaUrl && (
              <div>
                <IpfsImage src={deliverableMediaUrl} alt="Deliverable" className="max-w-full rounded border border-line" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:text-accent mt-2 inline-block">
                  Open full size &#8599;
                </a>
              </div>
            )}

            {/* Audio player */}
            {deliverableType?.startsWith('audio/') && deliverableMediaUrl && (
              <div>
                <audio src={deliverableMediaUrl} controls className="w-full" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:text-accent mt-2 inline-block">
                  Download audio &#8599;
                </a>
              </div>
            )}

            {/* Video player */}
            {deliverableType?.startsWith('video/') && deliverableMediaUrl && (
              <div>
                <video src={deliverableMediaUrl} controls className="max-w-full rounded border border-line" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:text-accent mt-2 inline-block">
                  Download video &#8599;
                </a>
              </div>
            )}

            {/* GitHub repo link */}
            {deliverableType === 'github:repo' && deliverableMediaUrl && (
              <div className="flex items-center gap-2 bg-surface p-3 rounded border border-line">
                <svg className="w-5 h-5 text-ink-2 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-accent hover:text-accent underline break-all">
                  {deliverableMediaUrl} &#8599;
                </a>
              </div>
            )}

            {/* Text content */}
            {deliverableContent && !deliverableMediaUrl && (
              isUrl(deliverableContent) ? (
                <div className="text-sm bg-surface p-3 rounded border border-line">
                  <a href={deliverableContent} target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:text-accent underline break-all">
                    {deliverableContent} &#8599;
                  </a>
                </div>
              ) : isMarkdown(deliverableContent) ? (
                <div
                  className="text-sm text-ink-2 bg-surface p-4 rounded border border-line max-h-[32rem] overflow-y-auto prose-invert"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(deliverableContent) }}
                />
              ) : (
                <div className="text-sm text-ink-2 whitespace-pre-wrap bg-surface p-3 rounded border border-line max-h-[32rem] overflow-y-auto">
                  {deliverableContent}
                </div>
              )
            )}

            {/* Direct IPFS link */}
            {evidenceUrl && !evidenceUrl.startsWith('data:') && (
              <a href={evidenceUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted hover:text-accent mt-2 inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View raw on IPFS
              </a>
            )}

            {/* Additional deliverable files */}
            {additionalUrls.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted">Additional files:</p>
                {additionalUrls.map((url, i) => {
                  const filename = url.split('/').pop()?.split('?')[0] || `File ${i + 2}`;
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-accent hover:text-accent flex items-center gap-1">
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {filename}
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        )}


        {/* Dispute Form */}
        {showRevise && (
          <div ref={reviseFormRef} className="p-4 bg-surface-2 border border-line-2 rounded-lg space-y-3 scroll-mt-24">
            <h3 className="font-display text-base font-semibold text-ink">Request changes</h3>
            <p className="text-xs text-ink-2">
              The job goes back to in progress and the agent delivers again. Your notes are recorded on chain. Use a dispute instead if the work is not salvageable.
            </p>
            <div>
              <label className="text-xs text-muted block mb-1">What needs to change *</label>
              <textarea
                value={reviseNotes}
                onChange={e => setReviseNotes(e.target.value)}
                maxLength={512}
                placeholder="e.g. The PNG is missing the legend and the JSON has no 24h volume field."
                className="w-full bg-surface border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-1 focus:ring-accent focus:border-accent"
                rows={3}
              />
              <p className="mt-1 text-[11px] text-muted">{reviseNotes.length}/512</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRevise}
                disabled={processing || !reviseNotes.trim()}
                className="px-4 py-2 bg-ink text-canvas rounded-lg text-sm hover:opacity-90 disabled:bg-line disabled:text-muted"
              >
                {processing ? 'Sending…' : 'Send back for changes'}
              </button>
              <button
                type="button"
                onClick={() => { setShowRevise(false); setReviseNotes(''); }}
                className="px-4 py-2 text-ink-2 hover:text-ink text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {showDispute && (
          <div ref={disputeFormRef} className="p-4 bg-warn-soft border border-warn/30 rounded-lg space-y-3 scroll-mt-24">
            <h3 className="font-display text-base font-semibold text-warn">Raise a dispute</h3>
            <p className="text-xs text-ink-2">
              Disputes are reviewed by an arbitrator who decides how funds are split between you and the agent.
            </p>
            <div>
              <label className="text-xs text-muted block mb-1">Reason *</label>
              <textarea
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="Explain why you're disputing this job..."
                className="w-full bg-surface-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-1 focus:ring-warn focus:border-warn"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Evidence URL (optional)</label>
              <input
                type="url"
                value={disputeEvidence}
                onChange={e => setDisputeEvidence(e.target.value)}
                placeholder="https://..."
                className="w-full bg-surface-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-1 focus:ring-warn focus:border-warn"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDispute}
                disabled={processing || !disputeReason.trim()}
                className="px-4 py-2 bg-warn text-white rounded-lg text-sm hover:bg-warn disabled:bg-line disabled:text-muted"
              >
                {processing ? 'Submitting…' : 'Submit dispute'}
              </button>
              <button
                type="button"
                onClick={() => { setShowDispute(false); setDisputeReason(''); setDisputeEvidence(''); }}
                className="px-4 py-2 text-ink-2 hover:text-ink text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Dispute Details */}
        {(job.state === 5 || job.state === 8) && activeDispute && (
          <div className={`p-4 rounded-lg space-y-3 ${
            activeDispute.resolution === 0
              ? 'bg-crit-soft border border-crit/30'
              : 'bg-surface-2/50 border border-line-2'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-bold ${activeDispute.resolution === 0 ? 'text-crit' : 'text-ink-2'}`}>
                Dispute #{activeDispute.id}
              </h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                activeDispute.resolution === 0
                  ? 'bg-crit-soft text-crit'
                  : 'bg-good-soft text-good'
              }`}>
                {DISPUTE_RESOLUTION_LABELS[activeDispute.resolution] || 'Unknown'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-xs text-muted block">Raised by</span>
                <AccountLink account={activeDispute.raised_by} className="text-sm" />
              </div>
              <div>
                <span className="text-xs text-muted block">Filed</span>
                <span className="text-ink-2" title={formatDate(activeDispute.created_at)}>{formatRelativeTime(activeDispute.created_at)}</span>
              </div>
            </div>

            <div>
              <span className="text-xs text-muted block mb-1">Reason</span>
              <p className="text-sm text-ink-2">{activeDispute.reason}</p>
            </div>

            {activeDispute.evidence_uri && (
              <div>
                <span className="text-xs text-muted block mb-1">Evidence</span>
                <a href={activeDispute.evidence_uri} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline break-all">
                  {activeDispute.evidence_uri.length > 60 ? activeDispute.evidence_uri.slice(0, 60) + '...' : activeDispute.evidence_uri}
                </a>
              </div>
            )}

            {/* Resolution details */}
            {activeDispute.resolution > 0 && (
              <div className="pt-3 border-t border-line-2 space-y-2">
                <h4 className="text-sm font-medium text-good">Resolution</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-muted block">To client</span>
                    <span className="text-ink font-medium">{formatXpr(activeDispute.client_amount)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted block">To agent</span>
                    <span className="text-ink font-medium">{formatXpr(activeDispute.agent_amount)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-muted block">Resolved by</span>
                    <AccountLink account={activeDispute.resolver} className="text-sm" />
                  </div>
                  <div>
                    <span className="text-xs text-muted block">Resolved</span>
                    <span className="text-ink-2" title={formatDate(activeDispute.resolved_at)}>{formatRelativeTime(activeDispute.resolved_at)}</span>
                  </div>
                </div>
                {activeDispute.resolution_notes && (
                  <div>
                    <span className="text-xs text-muted block mb-1">Notes</span>
                    <p className="text-sm text-ink-2 italic">{activeDispute.resolution_notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Resolve button */}
            {activeDispute.resolution === 0 && isArbitrator && !showResolve && (
              <button
                onClick={() => setShowResolve(true)}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80"
              >
                Resolve dispute
              </button>
            )}

            {/* Resolve form */}
            {activeDispute.resolution === 0 && isArbitrator && showResolve && (
              <div className="space-y-3 pt-2 border-t border-crit/30">
                <h4 className="text-sm font-medium text-ink">Resolution</h4>
                <div>
                  <label className="text-xs text-muted block mb-1">
                    Refund to client: {resolvePercent}% ({formatXpr(Math.floor(job.funded_amount * resolvePercent / 100))})
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={resolvePercent}
                    onChange={e => setResolvePercent(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-muted mt-1">
                    <span>0% (all to agent)</span>
                    <span>100% (full refund)</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Resolution notes *</label>
                  <textarea
                    value={resolveNotes}
                    onChange={e => setResolveNotes(e.target.value)}
                    placeholder="Explain the resolution decision..."
                    className="w-full bg-surface-2 border border-line-2 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-1 focus:ring-accent focus:border-accent"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleResolveDispute}
                    disabled={processing || !resolveNotes.trim()}
                    className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 disabled:bg-line disabled:text-muted"
                  >
                    {processing ? 'Resolving...' : `Resolve: ${resolvePercent}% client / ${100 - resolvePercent}% agent`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResolve(false)}
                    className="px-4 py-2 text-ink-2 hover:text-ink text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Delivery and revision timeline (indexer event log) */}
        {job.state >= 2 && (
          <DeliveryHistory jobId={job.id} agent={isEmptyName(job.agent) ? undefined : job.agent} refreshKey={job.state * 1000 + job.updated_at % 1000} onCounts={setHistoryCounts} />
        )}

        {/* Bids Section */}
        {(canBid || bids.length > 0 || bidsLoading) && (
          <section className="rounded-xl border border-line bg-canvas p-5" id="bids">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-ink">
                Bids {!bidsLoading && <span className="font-mono text-sm text-muted">({bids.length})</span>}
              </h3>
              {session && canBid && !showBidForm && (
                <button
                  onClick={() => setShowBidForm(true)}
                  className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover"
                >
                  Submit a bid
                </button>
              )}
            </div>

            {/* Bid Form */}
            {showBidForm && session && (
              <form onSubmit={handleSubmitBid} className="mb-4 p-4 bg-surface-2 rounded-lg">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-ink-2 mb-1">Amount (XPR)</label>
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      placeholder="500"
                      min="0"
                      step="0.0001"
                      required
                      className="w-full px-3 py-2 bg-surface border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-2 mb-1">Timeline (days)</label>
                    <input
                      type="number"
                      value={bidTimeline}
                      onChange={(e) => setBidTimeline(e.target.value)}
                      placeholder="7"
                      min="1"
                      required
                      className="w-full px-3 py-2 bg-surface border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-ink-2 mb-1">Proposal</label>
                  <textarea
                    value={bidProposal}
                    onChange={(e) => setBidProposal(e.target.value)}
                    placeholder="Describe your approach..."
                    rows={3}
                    required
                    className="w-full px-3 py-2 bg-surface border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={processing}
                    className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover disabled:bg-line disabled:text-muted"
                  >
                    {processing ? 'Submitting…' : 'Submit bid'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBidForm(false)}
                    className="px-4 py-2 border border-line-2 text-ink-2 rounded-lg text-sm hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {bidsLoading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
              </div>
            ) : bids.length === 0 ? (
              <div className="py-2 text-sm text-muted">
                {canBid ? (
                  session ? 'No bids yet.' : (
                    <>No bids yet. <button onClick={login} className="text-accent hover:text-accent-hover">Connect a wallet</button> to bid.</>
                  )
                ) : 'No bids were placed.'}
              </div>
            ) : (
              <div className="space-y-3">
                {bids.map((bid) => {
                  const isWinner = job.agent === bid.agent && job.agent !== '.............';
                  return (
                    <div
                      key={bid.id}
                      className={`p-3 border rounded-lg ${isWinner ? 'border-good/30 bg-good-soft' : 'border-line'}`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <AccountLink account={bid.agent} isAgent showAvatar avatarSize={22} className="font-medium text-sm" />
                            {isWinner && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-good-soft text-good">Selected</span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-base font-bold text-accent">{formatXpr(bid.amount)}</span>
                            <span className="text-xs text-muted" title="Proposed delivery time if this bid is selected">delivers in {formatTimeline(bid.timeline)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {session?.auth.actor === job.client && job.state === 0 && !isWinner && (
                            <button
                              onClick={() => handleSelectBid(bid)}
                              disabled={processing}
                              className="text-xs px-3 py-1 bg-good text-white rounded hover:bg-good disabled:opacity-50"
                            >
                              Select and fund
                            </button>
                          )}
                          {session?.auth.actor === bid.agent && !isWinner && (
                            <button
                              onClick={() => handleWithdrawBid(bid.id)}
                              disabled={processing}
                              className="text-xs text-crit hover:text-crit disabled:opacity-50"
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-ink-2 mt-2">{bid.proposal}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        </div>

        {/* Rail */}
        <aside className="lg:col-span-4">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="rounded-xl border border-line bg-canvas">
              <div className="border-b border-line px-5 py-3.5"><span className="label">Escrow</span></div>
              <dl className="divide-y divide-line">
                {railRow('Budget', <span className="font-mono tabular">{formatXpr(job.amount)}</span>)}
                {railRow('Funded', (
                  <span className={`font-mono tabular ${job.funded_amount >= job.amount && job.amount > 0 ? 'text-good' : ''}`}>{formatXpr(job.funded_amount)}</span>
                ))}
                {job.funded_amount > 0 && job.funded_amount < job.amount && (
                  <div className="px-5 pb-3">
                    <div className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-good" style={{ width: `${fundedPct}%` }} /></div>
                  </div>
                )}
                {job.deadline > 0 && railRow('Deadline', <span title={formatDate(job.deadline)}>{formatRelativeTime(job.deadline)}</span>)}
                {historyCounts.rating !== undefined && railRow('Rating', <span className={`font-mono tabular ${historyCounts.rating >= 4 ? 'text-good' : historyCounts.rating <= 2 ? 'text-crit' : ''}`}>{'★'.repeat(historyCounts.rating)}{'☆'.repeat(5 - historyCounts.rating)} {historyCounts.rating}/5</span>)}
                {historyCounts.revisions > 0 && railRow('Revisions', <span className={`font-mono tabular ${historyCounts.revisions >= 3 ? 'text-warn' : ''}`}>{historyCounts.revisions} · {historyCounts.deliveries} deliveries</span>)}
                {railRow('Client', <AccountLink account={job.client} className="font-mono" />)}
                {assignedAgent && railRow('Agent', <AccountLink account={assignedAgent} isAgent className="font-mono" />)}
                {!isEmptyName(job.arbitrator) && railRow('Arbitrator', <AccountLink account={job.arbitrator} className="font-mono" />)}
              </dl>

              <div className="space-y-2 border-t border-line p-4">
                {!session ? (
                  job.state <= 4 ? (
                    <button onClick={login} className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-canvas hover:bg-ink/85">
                      {canBid ? 'Connect wallet to bid' : 'Connect wallet'}
                    </button>
                  ) : job.state === 5 ? (
                    <p className="text-xs text-muted">In dispute. Awaiting the arbitrator&apos;s decision.</p>
                  ) : (
                    <p className="text-xs text-muted">This job is closed.</p>
                  )
                ) : hasOwnAction ? (
                  <>
                    {canBid && !showBidForm && (
                      <button onClick={jumpToBids} className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">Submit a bid</button>
                    )}
                    {canFund && (
                      <button onClick={handleFundJob} disabled={processing} className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
                        {processing ? 'Funding…' : `Fund ${formatXpr(remaining)}`}
                      </button>
                    )}
                    {canApprove && (
                      <button onClick={handleApproveDelivery} disabled={processing} className="w-full rounded-md bg-good px-4 py-2.5 text-sm font-medium text-white hover:bg-good/90 disabled:bg-line disabled:text-muted">
                        {processing ? 'Approving…' : 'Approve and pay'}
                      </button>
                    )}
                    {canDispute && (
                      <>
                      <button onClick={() => { setShowRevise(true); setShowDispute(false); revealForm(reviseFormRef); }} disabled={processing} className="w-full rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-ink hover:border-ink disabled:opacity-50">
                        Request changes
                      </button>
                      <button onClick={() => { setShowDispute(true); setShowRevise(false); revealForm(disputeFormRef); }} disabled={processing} className="w-full rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-ink hover:border-warn hover:text-warn disabled:opacity-50">
                        Raise a dispute
                      </button>
                      </>
                    )}
                    {canCancel && (
                      <button onClick={handleCancelJob} disabled={processing} className="w-full rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-crit hover:border-crit disabled:opacity-50">
                        {processing ? 'Cancelling…' : 'Cancel job'}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted">
                    {isArbitrator ? 'You are the arbitrator for this dispute. Resolve it below.' : 'No actions for your account on this job.'}
                  </p>
                )}
              </div>
            </div>

            {assignedAgent && job.state > 0 && (
              <div className="rounded-xl border border-line bg-canvas p-5">
                <h3 className="label mb-3">Assigned agent</h3>
                <AccountLink account={assignedAgent} isAgent showAvatar avatarSize={28} className="font-medium text-ink" />
                {winningBid && (
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-muted">Bid</dt><dd className="font-mono tabular text-ink">{formatXpr(winningBid.amount)}</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">Timeline</dt><dd className="text-ink">{formatTimeline(winningBid.timeline)}</dd></div>
                  </dl>
                )}
                {winningBid?.proposal && <p className="mt-3 text-sm text-ink-2">{winningBid.proposal}</p>}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Modal open={showRating} onClose={() => setShowRating(false)} title={`Rate ${ratingAgent}`} description={`How did job #${ratingJobId} go? Reviews are recorded on chain and weighted by your KYC level.`} width="max-w-sm">
        <div className="mb-4 flex justify-center gap-1" role="radiogroup" aria-label="Score">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={ratingScore === s}
              aria-label={`${s} of 5`}
              onClick={() => setRatingScore(s)}
              className={`text-3xl transition-colors ${s <= ratingScore ? 'text-warn' : 'text-line-2 hover:text-muted'}`}
            >
              ★
            </button>
          ))}
        </div>
        <p className="mb-4 text-center font-mono text-sm tabular text-muted">{ratingScore}/5</p>
        <input
          type="text"
          value={ratingTags}
          onChange={(e) => setRatingTags(e.target.value)}
          placeholder="Tags: fast, quality, creative"
          aria-label="Tags"
          className="mb-4 w-full rounded-md border border-line-2 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <p className="mb-4 text-xs text-muted">Submitting sends the 1 XPR review fee to the feedback contract.</p>
        <div className="flex gap-2">
          <button onClick={handleSubmitRating} disabled={ratingSubmitting} className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
            {ratingSubmitting ? 'Submitting…' : 'Submit review'}
          </button>
          <button onClick={() => setShowRating(false)} className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">Skip</button>
        </div>
      </Modal>
    </>
  );
}
