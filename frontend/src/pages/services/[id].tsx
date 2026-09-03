import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { AccountAvatar } from '@/components/AccountAvatar';
import { TrustBadge } from '@/components/TrustBadge';
import { ServiceSample, serviceStars, FeaturedChip } from '@/components/ServiceCard';
import { Modal, Field, inputClass } from '@/components/Modal';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useAgent } from '@/hooks/useAgent';
import { indexerFetch } from '@/lib/indexer';
import {
  CONTRACTS,
  formatXpr,
  formatDate,
  formatRelativeTime,
  formatTurnaround,
  isImageUri,
  getService,
  getServiceConfig,
  FEATURED_SLOTS,
  boostDays,
  findServiceJob,
  parseDeliverableManifest,
  SERVICE_CATEGORY_LABELS,
  DEFAULT_SERVICE_CONFIG,
  type Service,
  type ServiceConfig,
} from '@/lib/registry';
import { getTxId } from '@/lib/job-constants';

const POLL_TRIES = 10;
const POLL_INTERVAL_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ServicePage() {
  const router = useRouter();
  const { id } = router.query;
  const { session, transact, login } = useProton();
  const { addToast } = useToast();

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const [orphanJob, setOrphanJob] = useState(false);
  const buyingRef = useRef(false);

  // Featured placement
  const [svcConfig, setSvcConfig] = useState<ServiceConfig>(DEFAULT_SERVICE_CONFIG);
  const [showBoost, setShowBoost] = useState(false);
  const [boostAmount, setBoostAmount] = useState('');
  const [boosting, setBoosting] = useState(false);

  const { agent, score, trustScore } = useAgent(service?.agent);
  const [agentStats, setAgentStats] = useState<{ completed_jobs?: number; earnings?: number } | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    const serviceId = parseInt(String(id));
    if (isNaN(serviceId)) { setError(true); setLoading(false); return; }
    setLoading(true);
    setError(false);
    getService(serviceId)
      .then((s) => { if (s) setService(s); else setError(true); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    getServiceConfig().then(setSvcConfig).catch(() => {});
  }, []);

  useEffect(() => {
    if (!service?.agent) return;
    let cancelled = false;
    indexerFetch<{ completed_jobs?: number; earnings?: number }>(`/agents/${service.agent}`)
      .then((data) => { if (!cancelled && data) setAgentStats(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [service?.agent]);

  const manifest = useMemo(
    () => (service?.sample_uri ? parseDeliverableManifest(service.sample_uri) : null),
    [service?.sample_uri]
  );

  const isSeller = !!session && !!service && session.auth.actor === service.agent;
  // The contract also refuses purchases from the agent's KYC'd owner; say so instead of surfacing a chain error.
  const isOwner = !!session && !!agent && !!agent.owner && agent.owner === session.auth.actor;
  const priceStr = service ? `${(service.price / 10000).toFixed(4)} XPR` : '';
  const completedJobs = agentStats?.completed_jobs ?? agent?.total_jobs;
  const reviews = score?.feedback_count ?? service?.agent_reviews ?? 0;
  const rating = score?.avg_score ?? service?.agent_rating ?? 0;

  // The contract requires the seller to have finished at least one job before a
  // listing can be featured (agentcore total_jobs).
  const agentCompletedOnChain = agent?.total_jobs ?? 0;
  const canBoost = agentCompletedOnChain >= 1;
  const boostRaw = Math.round((parseFloat(boostAmount) || 0) * 10000);
  const previewDays = boostDays(boostRaw, svcConfig);
  const boostMinXpr = svcConfig.boost_min / 10000;

  async function handleBoost(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !service || boosting) return;
    setBoosting(true);
    try {
      const quantity = `${(boostRaw / 10000).toFixed(4)} XPR`;
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity,
            memo: `boost:${service.id}`,
          },
        },
      ]);
      addToast({
        type: 'success',
        message: `Featured "${service.title}" for ${previewDays} day${previewDays === 1 ? '' : 's'}`,
        txId: getTxId(result),
      });
      setShowBoost(false);
      setBoostAmount('');
      await sleep(1500);
      const refreshed = await getService(service.id).catch(() => null);
      if (refreshed) setService(refreshed);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to feature listing' });
    } finally {
      setBoosting(false);
    }
  }

  async function handleBuy() {
    if (!session || !service || buyingRef.current) return;
    buyingRef.current = true;
    setBuying(true);
    setOrphanJob(false);
    setBuyStatus(null);
    try {
      // Any earlier purchase of this listing by the same buyer — so the poll below
      // waits for the *new* job rather than jumping to an old one.
      const previous = await findServiceJob(session.auth.actor, service.id);
      const previousId = previous ? previous.id : -1;

      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: priceStr,
            memo: `buy:${service.id}`,
          },
        },
      ]);

      addToast({ type: 'success', message: `Bought "${service.title}" for ${priceStr}`, txId: getTxId(result) });
      setBuyStatus('Opening your escrow job…');

      for (let i = 0; i < POLL_TRIES; i++) {
        await sleep(POLL_INTERVAL_MS);
        const job = await findServiceJob(session.auth.actor, service.id);
        if (job && job.id > previousId) {
          router.push(`/jobs/${job.id}`);
          return;
        }
      }
      setBuyStatus(null);
      setOrphanJob(true);
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Purchase failed' });
      setBuyStatus(null);
    } finally {
      buyingRef.current = false;
      setBuying(false);
    }
  }

  const railRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );

  return (
    <>
      <SiteHead
        title={service ? service.title : 'Service'}
        description={service ? service.description.slice(0, 160) : 'A fixed-price service published by an agent on XPR Network.'}
        path={`/services/${id ?? ''}`}
      />

      <div className="min-h-screen bg-canvas">
        <Header activePage="services" />

        <main className="mx-auto max-w-6xl px-4 py-8">
          <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-muted" aria-label="Breadcrumb">
            <Link href="/services" className="hover:text-ink">Services</Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink-2">{service ? `#${service.id}` : loading ? '…' : 'Not found'}</span>
          </nav>

          {loading ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-8">
                <div className="aspect-[16/9] skeleton-shimmer rounded-xl" />
                <div className="h-8 w-2/3 skeleton-shimmer rounded" />
                <div className="h-4 w-full skeleton-shimmer rounded" />
                <div className="h-4 w-5/6 skeleton-shimmer rounded" />
              </div>
              <div className="h-64 skeleton-shimmer rounded-xl lg:col-span-4" />
            </div>
          ) : error || !service ? (
            <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
              <p className="label mb-3">Service not found</p>
              <h1 className="font-display text-2xl font-semibold text-ink">This listing doesn&apos;t exist or was removed.</h1>
              <Link href="/services" className="mt-6 inline-block rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">
                Browse services
              </Link>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-12">
              {/* Main */}
              <div className="space-y-6 lg:col-span-8">
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {service.category && (
                      <span className="rounded bg-surface px-2 py-0.5 font-mono text-[11px] uppercase tracking-label text-ink-2">
                        {SERVICE_CATEGORY_LABELS[service.category] || service.category}
                      </span>
                    )}
                    {service.featuredSlot > 0 && <FeaturedChip />}
                    {!service.active && (
                      <span className="rounded bg-crit-soft px-2 py-0.5 text-[11px] font-medium text-crit">Delisted</span>
                    )}
                    <span className="font-mono text-[11px] text-muted">
                      listed {formatRelativeTime(service.created_at)}
                    </span>
                  </div>
                  <h1 className="font-display text-3xl font-semibold leading-tight text-ink">{service.title}</h1>
                </div>

                {/* Sample */}
                {service.sample_uri && (
                  <section aria-labelledby="sample-heading" className="overflow-hidden rounded-xl border border-line bg-canvas">
                    <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                      <span id="sample-heading" className="label">Sample of previous work</span>
                      {!manifest && !isImageUri(service.sample_uri) && /^https?:\/\//i.test(service.sample_uri) && (
                        <a href={service.sample_uri} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
                          Open ↗
                        </a>
                      )}
                    </div>
                    {manifest ? (
                      <div className="px-5 py-4">
                        <ul className="divide-y divide-line">
                          {manifest.files.map((file) => (
                            <li key={file.uri} className="flex items-center justify-between gap-4 py-2.5">
                              <span className="min-w-0 truncate text-sm text-ink">{file.name}</span>
                              <a
                                href={file.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 font-mono text-xs text-accent hover:underline"
                              >
                                {file.type || 'open'} ↗
                              </a>
                            </li>
                          ))}
                        </ul>
                        {manifest.note && <p className="mt-3 text-sm text-ink-2">{manifest.note}</p>}
                      </div>
                    ) : isImageUri(service.sample_uri) ? (
                      <div className="bg-surface">
                        <ServiceSample service={service} className="w-full" imgClassName="mx-auto max-h-[460px] w-auto object-contain" />
                      </div>
                    ) : (
                      <div className="px-5 py-4">
                        <a
                          href={service.sample_uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-sm text-accent hover:underline"
                        >
                          {service.sample_uri}
                        </a>
                      </div>
                    )}
                  </section>
                )}

                <section>
                  <h2 className="label mb-2">What you get</h2>
                  <p className="whitespace-pre-wrap text-[15px] leading-6 text-ink-2">{service.description}</p>
                </section>

                {service.deliverables.length > 0 && (
                  <section>
                    <h2 className="label mb-2">Deliverables</h2>
                    <ul className="divide-y divide-line rounded-xl border border-line bg-canvas">
                      {service.deliverables.map((d, i) => (
                        <li key={`${i}-${d}`} className="flex items-start gap-3 px-5 py-3 text-sm text-ink">
                          <span className="mt-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                          <span className="min-w-0">{d}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">
                      Copied verbatim into the escrow job. The agent delivers against this list; you approve or request changes.
                    </p>
                  </section>
                )}

                {/* Agent card */}
                <section className="rounded-xl border border-line bg-canvas">
                  <div className="border-b border-line px-5 py-3.5"><span className="label">Sold by</span></div>
                  <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                    <AccountAvatar account={service.agent} name={agent?.name || service.agent_name} size={48} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/agent/${service.agent}`} className="font-display text-lg font-semibold text-ink hover:text-accent">
                        {agent?.name || service.agent_name || service.agent}
                      </Link>
                      <p className="font-mono text-xs text-muted">{service.agent}</p>
                      {agent?.description && <p className="mt-2 line-clamp-2 text-sm text-ink-2">{agent.description}</p>}
                      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                        <div>
                          <dt className="label">Completed</dt>
                          <dd className="mt-0.5 font-mono text-sm tabular text-ink">{completedJobs ?? '…'}</dd>
                        </div>
                        <div>
                          <dt className="label">Reviews</dt>
                          <dd className="mt-0.5 font-mono text-sm tabular text-ink">
                            {reviews > 0 ? <>{serviceStars(rating)} <span className="text-muted">{reviews}</span></> : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="label">This service</dt>
                          <dd className="mt-0.5 font-mono text-sm tabular text-ink">{service.sales} sold</dd>
                        </div>
                      </dl>
                    </div>
                    {trustScore ? (
                      <div className="w-full sm:w-auto"><TrustBadge trustScore={trustScore} /></div>
                    ) : service.agent_trust !== undefined ? (
                      <div className="font-mono text-sm tabular text-ink-2">{service.agent_trust}/100</div>
                    ) : null}
                  </div>
                  <div className="border-t border-line px-5 py-3">
                    <Link href={`/agent/${service.agent}`} className="text-sm text-accent hover:underline">
                      View full profile and reviews →
                    </Link>
                  </div>
                </section>
              </div>

              {/* Rail */}
              <div className="lg:col-span-4">
                <div className="lg:sticky lg:top-20">
                  <div className="rounded-xl border border-line bg-canvas">
                    <div className="border-b border-line px-5 py-4">
                      <div className="font-mono text-3xl tabular text-ink">{formatXpr(service.price)}</div>
                      <p className="mt-1 text-sm text-muted">Fixed price, held in escrow until you approve.</p>
                    </div>
                    <dl className="divide-y divide-line">
                      {railRow('Turnaround', <span className="font-mono tabular">{formatTurnaround(service.turnaround)}</span>)}
                      {railRow('Sales', <span className="font-mono tabular">{service.sales}</span>)}
                      {service.featured && service.featuredSlot === 0 && railRow('Featured', <span className="text-xs text-muted">Boost running, outside the top {FEATURED_SLOTS} slots</span>)}
                      {service.featured && railRow('Featured until', (
                        <span className="font-mono tabular text-accent" title={formatDate(service.featuredUntil)}>
                          {formatRelativeTime(service.featuredUntil)}
                        </span>
                      ))}
                      {railRow('Agent', <Link href={`/agent/${service.agent}`} className="font-mono text-accent hover:underline">{service.agent}</Link>)}
                      {service.updated_at > 0 && railRow('Updated', <span title={formatDate(service.updated_at)}>{formatRelativeTime(service.updated_at)}</span>)}
                    </dl>

                    <div className="space-y-2 border-t border-line p-4">
                      {!service.active ? (
                        <p className="text-xs text-muted">This listing has been delisted and cannot be bought.</p>
                      ) : !session ? (
                        <button onClick={login} className="w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-canvas hover:bg-ink/85">
                          Connect wallet to buy
                        </button>
                      ) : isSeller ? (
                        <p className="text-xs text-muted">This is your own listing. Edit or delist it from your dashboard.</p>
                      ) : isOwner ? (
                        <p className="text-xs text-muted">You own <span className="font-mono">{service.agent}</span>, so you cannot buy from it. Use another account to test the purchase flow.</p>
                      ) : (
                        <button
                          onClick={handleBuy}
                          disabled={buying}
                          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted"
                        >
                          {buying ? (buyStatus || 'Confirming…') : `Buy for ${formatXpr(service.price)}`}
                        </button>
                      )}

                      {service.active && session && (
                        canBoost ? (
                          <button
                            onClick={() => { setBoostAmount(String(boostMinXpr)); setShowBoost(true); }}
                            className="w-full rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink"
                          >
                            Feature this listing
                          </button>
                        ) : (
                          <p className="text-xs text-muted">
                            This listing can&apos;t be featured yet — <span className="font-mono">{service.agent}</span> has to
                            complete a job first.
                          </p>
                        )
                      )}

                      {orphanJob && (
                        <p className="text-xs text-warn">
                          Paid, but the new job hasn&apos;t appeared yet.{' '}
                          <Link href="/jobs" className="text-accent hover:underline">Open the job board</Link> — it will be there shortly.
                        </p>
                      )}

                      <p className="text-xs text-muted">
                        One transfer to <span className="font-mono">{CONTRACTS.AGENT_ESCROW}</span> with memo{' '}
                        <span className="font-mono">buy:{service.id}</span>. That creates a funded escrow job assigned to{' '}
                        <span className="font-mono">{service.agent}</span>, due in {formatTurnaround(service.turnaround)}.
                      </p>
                    </div>
                  </div>

                  <p className="mt-4 px-1 text-xs text-muted">
                    From there it is an ordinary job: the agent accepts and delivers, you approve, request changes or dispute.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        <Footer />
      </div>

      <Modal
        open={showBoost && !!session && !!service}
        onClose={() => setShowBoost(false)}
        title="Feature this listing"
        description="A boost puts the listing in one of three featured slots at the top of the catalogue. Anyone can pay it, and the whole amount goes to the registry."
      >
        <form onSubmit={handleBoost} className="space-y-4">
          <Field
            label="Amount (XPR)"
            htmlFor="boost-amount"
            hint={`Minimum ${boostMinXpr} XPR. ${svcConfig.boost_rate / 10000} XPR buys one featured day.`}
            required
          >
            <input
              id="boost-amount"
              type="number"
              inputMode="decimal"
              value={boostAmount}
              onChange={(e) => setBoostAmount(e.target.value)}
              min={boostMinXpr}
              step="0.0001"
              required
              className={`${inputClass} font-mono`}
            />
          </Field>

          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="label">Featured placement</p>
            <p className="mt-1 font-mono text-2xl tabular text-ink">
              {previewDays} <span className="text-sm text-muted">day{previewDays === 1 ? '' : 's'}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {service && service.featured
                ? 'Added to the time already running on this listing.'
                : 'Starts as soon as the transfer confirms.'}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={boosting || previewDays < 1 || boostRaw < svcConfig.boost_min}
              className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted"
            >
              {boosting ? 'Confirming…' : `Feature for ${previewDays} day${previewDays === 1 ? '' : 's'}`}
            </button>
            <button type="button" onClick={() => setShowBoost(false)} className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
