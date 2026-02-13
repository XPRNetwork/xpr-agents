import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { AccountLink } from '@/components/AccountLink';
import { NftCard } from '@/components/NftCard';
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
  parseNftDeliverable,
  getNftAssets,
  type Job,
  type Bid,
  type Dispute,
  type NftAsset,
} from '@/lib/registry';
import { STATE_COLORS, getTxId } from '@/lib/job-constants';

interface JobDetailProps {
  job: Job;
  onJobUpdated?: (job: Job) => void;
}

export function JobDetail({ job, onJobUpdated }: JobDetailProps) {
  const router = useRouter();
  const { session, transact } = useProton();
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

  // Rating modal
  const [showRating, setShowRating] = useState(false);
  const [ratingAgent, setRatingAgent] = useState('');
  const [ratingJobId, setRatingJobId] = useState(0);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingTags, setRatingTags] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Dispute form state
  const [showDispute, setShowDispute] = useState(false);
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
    try {
      const rawEvidenceUri = await getJobEvidence(jobId);
      if (!rawEvidenceUri) {
        setDeliverableContent('No evidence submitted');
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
      return `<pre style="background:#18181b;padding:12px;border-radius:8px;overflow-x:auto;margin:8px 0"><code>${code.trim()}</code></pre>`;
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
        result.push(`<h3 style="font-size:1rem;font-weight:600;color:#e4e4e7;margin:12px 0 4px">${line.slice(4)}</h3>`);
        continue;
      }
      if (line.startsWith('## ')) {
        if (inList) { result.push('</ul>'); inList = false; }
        result.push(`<h2 style="font-size:1.1rem;font-weight:700;color:#e4e4e7;margin:16px 0 6px">${line.slice(3)}</h2>`);
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
        result.push('<hr style="border-color:#3f3f46;margin:12px 0"/>');
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
    text = text.replace(/`([^`]+)`/g, '<code style="background:#27272a;padding:1px 4px;border-radius:3px;font-size:0.9em">$1</code>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (_m, label, url) =>
      `<a href="${unescapeUrl(url)}" target="_blank" rel="noopener noreferrer" style="color:#a78bfa;text-decoration:underline">${label}</a>`);
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

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-zinc-500">#{job.id}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATE_COLORS[job.state] || 'bg-zinc-500/10'}`}>
            {getJobStateLabel(job.state)}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white">{job.title}</h1>
        <p className="text-sm text-zinc-500 mt-1 flex flex-wrap items-center gap-1.5">
          Posted by <AccountLink account={job.client} showAvatar avatarSize={18} />
          {job.agent && job.agent !== '.............' && (
            <>&middot; Agent: <AccountLink account={job.agent} isAgent showAvatar avatarSize={18} /></>
          )}
          &middot; <span title={formatDate(job.created_at)}>{formatRelativeTime(job.created_at)}</span>
        </p>
      </div>

      {/* Content */}
      <div className="space-y-4">
        <p className="text-zinc-400">{job.description}</p>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-proton-purple">{formatXpr(job.amount)}</div>
            <div className="text-xs text-zinc-500">Budget</div>
          </div>
          <div className="bg-zinc-800 rounded-lg p-3 text-center">
            <div className={`text-lg font-bold ${job.funded_amount >= job.amount ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {formatXpr(job.funded_amount)}
            </div>
            <div className="text-xs text-zinc-500">Funded</div>
          </div>
        </div>

        {/* Funding Progress */}
        {job.funded_amount > 0 && job.funded_amount < job.amount && (
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${Math.min(100, (job.funded_amount / job.amount) * 100)}%` }}
            />
          </div>
        )}

        {/* Deliverables */}
        {job.deliverables.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Deliverables</h3>
            <ul className="list-disc list-inside text-sm text-zinc-400 space-y-1">
              {job.deliverables.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {job.deadline > 0 && (
          <p className="text-sm text-zinc-500">Deadline: <span title={formatDate(job.deadline)}>{formatRelativeTime(job.deadline)}</span></p>
        )}

        {/* Deliverable Result */}
        {job.state >= 4 && job.agent && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium text-blue-400">Agent Deliverable</h3>
              {!deliverableContent && !deliverableMediaUrl && !deliverableLoading && !deliverableType && (
                <button
                  onClick={() => fetchDeliverable(job.id)}
                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  View Result
                </button>
              )}
            </div>
            {deliverableLoading && (
              <div className="flex items-center gap-3 py-6 justify-center">
                <svg className="animate-spin h-5 w-5 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm text-zinc-400">Fetching from IPFS...</span>
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
                  <p className="text-sm text-zinc-400 mt-3">{deliverableContent}</p>
                )}
              </div>
            )}

            {/* PDF embed */}
            {deliverableType === 'application/pdf' && deliverableMediaUrl && (
              <div>
                <iframe src={deliverableMediaUrl} className="w-full h-96 rounded border border-zinc-800 bg-white" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-2 inline-block">
                  Download PDF &#8599;
                </a>
              </div>
            )}

            {/* Image embed */}
            {deliverableType?.startsWith('image/') && deliverableMediaUrl && (
              <div>
                <img src={deliverableMediaUrl} alt="Deliverable" className="max-w-full rounded border border-zinc-800" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-2 inline-block">
                  Open full size &#8599;
                </a>
              </div>
            )}

            {/* Audio player */}
            {deliverableType?.startsWith('audio/') && deliverableMediaUrl && (
              <div>
                <audio src={deliverableMediaUrl} controls className="w-full" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-2 inline-block">
                  Download audio &#8599;
                </a>
              </div>
            )}

            {/* Video player */}
            {deliverableType?.startsWith('video/') && deliverableMediaUrl && (
              <div>
                <video src={deliverableMediaUrl} controls className="max-w-full rounded border border-zinc-800" />
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-2 inline-block">
                  Download video &#8599;
                </a>
              </div>
            )}

            {/* GitHub repo link */}
            {deliverableType === 'github:repo' && deliverableMediaUrl && (
              <div className="flex items-center gap-2 bg-zinc-900 p-3 rounded border border-zinc-800">
                <svg className="w-5 h-5 text-zinc-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <a href={deliverableMediaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 underline break-all">
                  {deliverableMediaUrl} &#8599;
                </a>
              </div>
            )}

            {/* Text content */}
            {deliverableContent && !deliverableMediaUrl && (
              isUrl(deliverableContent) ? (
                <div className="text-sm bg-zinc-900 p-3 rounded border border-zinc-800">
                  <a href={deliverableContent} target="_blank" rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline break-all">
                    {deliverableContent} &#8599;
                  </a>
                </div>
              ) : isMarkdown(deliverableContent) ? (
                <div
                  className="text-sm text-zinc-300 bg-zinc-900 p-4 rounded border border-zinc-800 max-h-[32rem] overflow-y-auto prose-invert"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(deliverableContent) }}
                />
              ) : (
                <div className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900 p-3 rounded border border-zinc-800 max-h-[32rem] overflow-y-auto">
                  {deliverableContent}
                </div>
              )
            )}

            {/* Direct IPFS link */}
            {evidenceUrl && !evidenceUrl.startsWith('data:') && (
              <a href={evidenceUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-zinc-500 hover:text-purple-400 mt-2 inline-flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View raw on IPFS
              </a>
            )}

            {/* Additional deliverable files */}
            {additionalUrls.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-zinc-500">Additional files:</p>
                {additionalUrls.map((url, i) => {
                  const filename = url.split('/').pop()?.split('?')[0] || `File ${i + 2}`;
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {filename}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {session && (canFund || canApprove || canCancel || canDispute) && (
          <div className="flex flex-wrap gap-2">
            {canFund && (
              <button
                onClick={handleFundJob}
                disabled={processing}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {processing ? 'Funding...' : `Fund ${formatXpr(job.amount - job.funded_amount)}`}
              </button>
            )}
            {canApprove && (
              <button
                onClick={handleApproveDelivery}
                disabled={processing}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {processing ? 'Approving...' : 'Approve & Pay'}
              </button>
            )}
            {canDispute && (
              <button
                onClick={() => setShowDispute(true)}
                disabled={processing}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                Dispute
              </button>
            )}
            {canCancel && (
              <button
                onClick={handleCancelJob}
                disabled={processing}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {processing ? 'Cancelling...' : 'Cancel Job'}
              </button>
            )}
          </div>
        )}

        {/* Dispute Form */}
        {showDispute && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-3">
            <h3 className="text-sm font-bold text-amber-400">Raise Dispute</h3>
            <p className="text-xs text-zinc-400">
              Disputes are reviewed by an arbitrator who decides how funds are split between you and the agent.
            </p>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Reason *</label>
              <textarea
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="Explain why you're disputing this job..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Evidence URL (optional)</label>
              <input
                type="url"
                value={disputeEvidence}
                onChange={e => setDisputeEvidence(e.target.value)}
                placeholder="https://..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDispute}
                disabled={processing || !disputeReason.trim()}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {processing ? 'Submitting...' : 'Submit Dispute'}
              </button>
              <button
                type="button"
                onClick={() => { setShowDispute(false); setDisputeReason(''); setDisputeEvidence(''); }}
                className="px-4 py-2 text-zinc-400 hover:text-white text-sm"
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
              ? 'bg-red-500/10 border border-red-500/30'
              : 'bg-zinc-800/50 border border-zinc-700'
          }`}>
            <div className="flex items-center justify-between">
              <h3 className={`text-sm font-bold ${activeDispute.resolution === 0 ? 'text-red-400' : 'text-zinc-300'}`}>
                Dispute #{activeDispute.id}
              </h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                activeDispute.resolution === 0
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-emerald-500/20 text-emerald-400'
              }`}>
                {DISPUTE_RESOLUTION_LABELS[activeDispute.resolution] || 'Unknown'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-xs text-zinc-500 block">Raised by</span>
                <AccountLink account={activeDispute.raised_by} className="text-sm" />
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Filed</span>
                <span className="text-zinc-300" title={formatDate(activeDispute.created_at)}>{formatRelativeTime(activeDispute.created_at)}</span>
              </div>
            </div>

            <div>
              <span className="text-xs text-zinc-500 block mb-1">Reason</span>
              <p className="text-sm text-zinc-300">{activeDispute.reason}</p>
            </div>

            {activeDispute.evidence_uri && (
              <div>
                <span className="text-xs text-zinc-500 block mb-1">Evidence</span>
                <a href={activeDispute.evidence_uri} target="_blank" rel="noopener noreferrer" className="text-sm text-proton-purple hover:underline break-all">
                  {activeDispute.evidence_uri.length > 60 ? activeDispute.evidence_uri.slice(0, 60) + '...' : activeDispute.evidence_uri}
                </a>
              </div>
            )}

            {/* Resolution details */}
            {activeDispute.resolution > 0 && (
              <div className="pt-3 border-t border-zinc-700 space-y-2">
                <h4 className="text-sm font-medium text-emerald-400">Resolution</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-zinc-500 block">To client</span>
                    <span className="text-white font-medium">{formatXpr(activeDispute.client_amount)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 block">To agent</span>
                    <span className="text-white font-medium">{formatXpr(activeDispute.agent_amount)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-zinc-500 block">Resolved by</span>
                    <AccountLink account={activeDispute.resolver} className="text-sm" />
                  </div>
                  <div>
                    <span className="text-xs text-zinc-500 block">Resolved</span>
                    <span className="text-zinc-300" title={formatDate(activeDispute.resolved_at)}>{formatRelativeTime(activeDispute.resolved_at)}</span>
                  </div>
                </div>
                {activeDispute.resolution_notes && (
                  <div>
                    <span className="text-xs text-zinc-500 block mb-1">Notes</span>
                    <p className="text-sm text-zinc-300 italic">{activeDispute.resolution_notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Resolve button */}
            {activeDispute.resolution === 0 && isArbitrator && !showResolve && (
              <button
                onClick={() => setShowResolve(true)}
                className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-proton-purple/80"
              >
                Resolve Dispute
              </button>
            )}

            {/* Resolve form */}
            {activeDispute.resolution === 0 && isArbitrator && showResolve && (
              <div className="space-y-3 pt-2 border-t border-red-500/20">
                <h4 className="text-sm font-medium text-white">Resolution</h4>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">
                    Refund to client: {resolvePercent}% ({formatXpr(Math.floor(job.funded_amount * resolvePercent / 100))})
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={resolvePercent}
                    onChange={e => setResolvePercent(Number(e.target.value))}
                    className="w-full accent-proton-purple"
                  />
                  <div className="flex justify-between text-xs text-zinc-500 mt-1">
                    <span>0% (all to agent)</span>
                    <span>100% (full refund)</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Resolution notes *</label>
                  <textarea
                    value={resolveNotes}
                    onChange={e => setResolveNotes(e.target.value)}
                    placeholder="Explain the resolution decision..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:ring-1 focus:ring-proton-purple focus:border-proton-purple"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleResolveDispute}
                    disabled={processing || !resolveNotes.trim()}
                    className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-proton-purple/80 disabled:bg-zinc-700 disabled:text-zinc-500"
                  >
                    {processing ? 'Resolving...' : `Resolve: ${resolvePercent}% client / ${100 - resolvePercent}% agent`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResolve(false)}
                    className="px-4 py-2 text-zinc-400 hover:text-white text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Assigned Agent */}
        {job.agent && job.agent !== '.............' && job.state > 0 && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <h3 className="text-sm font-medium text-emerald-400 mb-2">Assigned Agent</h3>
            <div className="font-medium text-white">
              <AccountLink account={job.agent} isAgent showAvatar avatarSize={28} />
            </div>
            <div className="text-sm text-zinc-400 mt-1">
              {formatXpr(job.amount)} budget
            </div>
            {(() => {
              const winningBid = getWinningBid();
              if (!winningBid) return null;
              return (
                <>
                  <div className="text-sm text-zinc-400 mt-1">
                    {formatTimeline(winningBid.timeline)} timeline
                  </div>
                  {winningBid.proposal && (
                    <p className="text-sm text-zinc-500 mt-2">{winningBid.proposal}</p>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Bids Section */}
        {(canBid || bids.length > 0 || bidsLoading) && (
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-medium text-white">
                Bids {!bidsLoading && `(${bids.length})`}
              </h3>
              {session && canBid && !showBidForm && (
                <button
                  onClick={() => setShowBidForm(true)}
                  className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700"
                >
                  Submit Bid
                </button>
              )}
            </div>

            {/* Bid Form */}
            {showBidForm && session && (
              <form onSubmit={handleSubmitBid} className="mb-4 p-4 bg-zinc-800 rounded-lg">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Amount (XPR)</label>
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      placeholder="500"
                      min="0"
                      step="0.0001"
                      required
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Timeline (days)</label>
                    <input
                      type="number"
                      value={bidTimeline}
                      onChange={(e) => setBidTimeline(e.target.value)}
                      placeholder="7"
                      min="1"
                      required
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-zinc-400 mb-1">Proposal</label>
                  <textarea
                    value={bidProposal}
                    onChange={(e) => setBidProposal(e.target.value)}
                    placeholder="Describe your approach..."
                    rows={3}
                    required
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={processing}
                    className="px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                  >
                    {processing ? 'Submitting...' : 'Submit Bid'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBidForm(false)}
                    className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {bidsLoading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-proton-purple"></div>
              </div>
            ) : bids.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">
                {canBid ? 'No bids yet. Be the first!' : 'No bids.'}
              </p>
            ) : (
              <div className="space-y-3">
                {bids.map((bid) => {
                  const isWinner = job.agent === bid.agent && job.agent !== '.............';
                  return (
                    <div
                      key={bid.id}
                      className={`p-3 border rounded-lg ${isWinner ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800'}`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <AccountLink account={bid.agent} isAgent showAvatar avatarSize={22} className="font-medium text-sm" />
                            {isWinner && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-400">Selected</span>
                            )}
                          </div>
                          <div className="flex items-baseline gap-2 mt-1">
                            <span className="text-base font-bold text-proton-purple">{formatXpr(bid.amount)}</span>
                            <span className="text-xs text-zinc-500">{formatTimeline(bid.timeline)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {session?.auth.actor === job.client && job.state === 0 && !isWinner && (
                            <button
                              onClick={() => handleSelectBid(bid)}
                              disabled={processing}
                              className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Select & Fund
                            </button>
                          )}
                          {session?.auth.actor === bid.agent && !isWinner && (
                            <button
                              onClick={() => handleWithdrawBid(bid.id)}
                              disabled={processing}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-400 mt-2">{bid.proposal}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rating Modal */}
      {showRating && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={() => setShowRating(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Rate {ratingAgent}</h3>
            <p className="text-sm text-zinc-500 mb-4">How was job #{ratingJobId}?</p>
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setRatingScore(s)}
                  className={`text-3xl transition-transform ${
                    s <= ratingScore ? 'text-yellow-400 scale-110' : 'text-zinc-600'
                  } hover:scale-125`}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-zinc-500 mb-4">{ratingScore}/5</p>
            <input
              type="text"
              value={ratingTags}
              onChange={(e) => setRatingTags(e.target.value)}
              placeholder="Tags: fast, quality, creative..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 rounded-lg text-sm mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSubmitRating}
                disabled={ratingSubmitting}
                className="flex-1 px-4 py-2 bg-proton-purple text-white rounded-lg text-sm hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {ratingSubmitting ? 'Submitting...' : 'Submit Rating'}
              </button>
              <button
                onClick={() => setShowRating(false)}
                className="px-4 py-2 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-800"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
