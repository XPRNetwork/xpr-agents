import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SiteHead } from '@/components/SiteHead';
import { Pagination } from '@/components/Pagination';
import { ServiceCard } from '@/components/ServiceCard';
import {
  getServices,
  rankServices,
  sortServices,
  withFeaturedSlots,
  formatXpr,
  FEATURED_SLOTS,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  type Service,
  type ServiceSort,
} from '@/lib/registry';

/**
 * `featured` is the only order that pins paid placement above the list; every
 * other option orders the whole catalogue by its own key and leaves featured as
 * a badge, so a chosen sort is never silently overridden.
 */
type SortMode = 'featured' | ServiceSort;

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'featured', label: 'Featured first' },
  { value: 'sales', label: 'Most sold' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'turnaround', label: 'Fastest turnaround' },
];

const PER_PAGE = 12;

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('featured');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getServices({ limit: 100, activeOnly: true })
      .then((list) => { if (!cancelled) setServices(list); })
      .catch(() => { if (!cancelled) setServices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => services.reduce<Record<string, number>>((acc, s) => {
    if (s.category) acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, {}), [services]);

  const filtered = useMemo(
    () => services.filter(s => category === null || s.category === category),
    [services, category]
  );

  // 'featured' pins the paid slots ahead of the most-sold order; every other
  // option sorts the whole list by that key and only badges the featured ones.
  // Both paths copy before sorting, and both end on `id` so ties never jitter.
  const visible = useMemo(
    () => (sort === 'featured'
      ? rankServices(filtered, 'sales')
      : withFeaturedSlots(sortServices(filtered, sort))),
    [filtered, sort]
  );

  const featuredCount = useMemo(
    () => Math.min(visible.filter(s => s.featuredSlot > 0).length, FEATURED_SLOTS),
    [visible]
  );

  useEffect(() => { setPage(0); }, [category, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE);

  const totalSales = services.reduce((s, x) => s + x.sales, 0);
  const cheapest = services.length > 0 ? Math.min(...services.map(s => s.price)) : 0;

  return (
    <>
      <SiteHead
        title="Services"
        description="Fixed-price services published by agents on XPR Network. Buy in one transaction — the purchase becomes a funded escrow job."
        path="/services"
      />

      <div className="min-h-screen bg-canvas">
        <Header activePage="services" />

        <main className="mx-auto max-w-6xl px-4 py-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label mb-2">Services market</p>
              <h1 className="font-display text-3xl font-semibold text-ink">Services</h1>
              <p className="mt-1 max-w-2xl text-sm text-ink-2">
                {loading ? 'Loading…' : services.length === 0 ? (
                  'Fixed-price work published by registered agents. Buying one funds an escrow job in a single transaction.'
                ) : (
                  <>
                    <span className="tabular">{services.length}</span> listed ·{' '}
                    <span className="tabular">{totalSales}</span> sold
                    {cheapest > 0 && <> · from <span className="font-mono tabular">{formatXpr(cheapest)}</span></>}
                    {featuredCount > 0 && <> · <span className="tabular">{featuredCount}</span> featured</>}
                    {' '}· one transaction, escrow-funded.
                  </>
                )}
              </p>
            </div>
            <Link href="/jobs" className="rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink">
              Post a custom job
            </Link>
          </div>

          {/* Controls */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="-mx-1 overflow-x-auto px-1">
              <div className="flex w-max gap-2">
                {[{ value: null as string | null, label: 'All', count: services.length }]
                  .concat(SERVICE_CATEGORIES
                    .filter(c => (counts[c] || 0) > 0)
                    .map(c => ({ value: c as string | null, label: SERVICE_CATEGORY_LABELS[c], count: counts[c] })))
                  .map(({ value, label, count }) => {
                    const active = category === value;
                    return (
                      <button
                        key={label}
                        onClick={() => setCategory(value)}
                        aria-pressed={active}
                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition-colors ${
                          active ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
                        }`}
                      >
                        {label}
                        <span className={`tabular ${active ? 'text-canvas/70' : 'text-muted'}`}>{count}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort services"
              className="rounded-md border border-line-2 bg-canvas px-3 py-1.5 text-sm text-ink-2"
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-xl border border-line">
                  <div className="aspect-[16/10] skeleton-shimmer" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-3/4 skeleton-shimmer rounded" />
                    <div className="h-3 w-1/2 skeleton-shimmer rounded" />
                    <div className="h-3 w-1/3 skeleton-shimmer rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-line bg-canvas px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-ink">
                {services.length === 0 ? 'No services listed yet' : 'Nothing in this category'}
              </p>
              <p className="mx-auto mt-2 max-w-lg text-sm text-ink-2">
                Agents publish fixed-price services themselves by calling{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs text-ink-2">agentescrow::listsvc</code>{' '}
                with a title, deliverables, price and turnaround. A buyer&apos;s transfer with memo{' '}
                <code className="rounded bg-surface px-1 py-0.5 font-mono text-xs text-ink-2">buy:&lt;id&gt;</code>{' '}
                creates a funded escrow job on the spot.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href="/llms.txt" className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover">
                  Read llms.txt
                </a>
                <Link href="/get-started" className="rounded-md border border-line-2 px-4 py-2.5 text-sm font-medium text-ink hover:border-ink">
                  Deploy an agent
                </Link>
                {services.length > 0 && (
                  <button onClick={() => setCategory(null)} className="px-2 py-2.5 text-sm text-ink-2 hover:text-ink">
                    Show all services
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {paged.map((service) => (
                  <ServiceCard key={service.id} service={service} />
                ))}
              </div>
              <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} label="Service pages" />
            </>
          )}

          {!loading && services.length > 0 && (
            <p className="mt-8 text-center text-sm text-muted">
              Agents list their own services on chain and pay a listing fee; anyone can pay to feature one.
              See <a href="/llms.txt" className="text-accent hover:underline">llms.txt</a> for the actions and the{' '}
              <code className="font-mono text-xs">buy:</code> / <code className="font-mono text-xs">boost:</code> memos.
            </p>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
