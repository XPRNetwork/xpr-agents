import Link from 'next/link';
import IpfsImage from './IpfsImage';
import { AccountAvatar } from './AccountAvatar';
import {
  formatXpr,
  formatTurnaround,
  isImageUri,
  SERVICE_CATEGORY_LABELS,
  type Service,
} from '@/lib/registry';

/** Small "Featured" mark used on cards, the listing page and the dashboard. */
export function FeaturedChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-label text-accent ${className}`}
      title="Featured placement paid for by a boost"
    >
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l2.9 6.3 6.6.8-4.9 4.6 1.3 6.8L12 17.3 6.1 20.5l1.3-6.8L2.5 9.1l6.6-.8z" />
      </svg>
      Featured
    </span>
  );
}

/** avg_score is 0–10000 on a 5-star scale, so /2000 gives the stars. */
export function serviceStars(avgScore: number): string {
  const rounded = Math.max(0, Math.min(5, Math.round(avgScore / 2000)));
  return '★'.repeat(rounded) + '☆'.repeat(5 - rounded);
}

/** Sample preview: the image when there is one, otherwise a quiet category plate. */
export function ServiceSample({
  service,
  className = '',
  imgClassName = 'h-full w-full object-cover',
}: {
  service: Service;
  /** Applied to the placeholder plate. */
  className?: string;
  /** Applied to the image itself, so callers can switch cover/contain. */
  imgClassName?: string;
}) {
  const label = SERVICE_CATEGORY_LABELS[service.category] || service.category || 'Service';
  const placeholder = (
    <div className={`flex min-h-[120px] items-center justify-center bg-surface ${className}`}>
      <span className="label">{label}</span>
    </div>
  );

  if (!isImageUri(service.sample_uri)) return placeholder;

  return (
    <IpfsImage
      src={service.sample_uri}
      alt={`${service.title} sample`}
      className={imgClassName}
      fallback={placeholder}
    />
  );
}

export function ServiceCard({ service }: { service: Service }) {
  const reviews = service.agent_reviews ?? 0;
  const rating = service.agent_rating ?? 0;

  return (
    <Link
      href={`/services/${service.id}`}
      className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-canvas transition-colors focus-visible:border-accent ${
        service.featured ? 'border-accent/40 hover:border-accent' : 'border-line hover:border-line-2'
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-surface">
        <ServiceSample service={service} className="h-full w-full" />
        {service.category && (
          <span className="absolute left-2 top-2 rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-label text-ink-2 backdrop-blur">
            {SERVICE_CATEGORY_LABELS[service.category] || service.category}
          </span>
        )}
        {!service.active ? (
          <span className="absolute right-2 top-2 rounded bg-crit-soft px-1.5 py-0.5 text-[10px] font-medium text-crit">Delisted</span>
        ) : service.featured ? (
          <FeaturedChip className="absolute right-2 top-2 bg-canvas/85 backdrop-blur" />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink">{service.title}</h3>

        <div className="mt-2 flex min-w-0 items-center gap-2">
          <AccountAvatar account={service.agent} name={service.agent_name} size={20} />
          <span className="min-w-0 truncate font-mono text-xs text-muted">{service.agent}</span>
          {service.agent_trust !== undefined && (
            <span className="ml-auto shrink-0 font-mono text-xs tabular text-ink-2" title="Trust score">
              {service.agent_trust}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-mono text-xs tabular text-muted">
          <span className="text-base text-ink">{formatXpr(service.price)}</span>
          <span>{formatTurnaround(service.turnaround)}</span>
        </div>

        <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular text-muted">
          <span>{service.sales} {service.sales === 1 ? 'sale' : 'sales'}</span>
          {reviews > 0 && (
            <span className="text-ink-2" title={`${(rating / 2000).toFixed(1)} of 5 from ${reviews} review${reviews === 1 ? '' : 's'}`}>
              {serviceStars(rating)} <span className="text-muted">{reviews}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
