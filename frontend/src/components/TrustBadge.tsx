import { TrustScore } from '@/lib/registry';

/**
 * Trust ledger — the trust score's anatomy made visible.
 * Four segments sized to their maximum contribution (KYC 30, stake 20,
 * reputation 40, longevity 10) and filled to the agent's actual value,
 * so a glance shows not just the number but where it comes from.
 */

export const TRUST_SEGMENTS = [
  { key: 'kyc' as const, label: 'KYC', max: 30 },
  { key: 'stake' as const, label: 'Stake', max: 20 },
  { key: 'reputation' as const, label: 'Reputation', max: 40 },
  { key: 'longevity' as const, label: 'Longevity', max: 10 },
];

const ratingLabels: Record<TrustScore['rating'], string> = {
  untrusted: 'Unrated',
  low: 'Low trust',
  medium: 'Medium trust',
  high: 'High trust',
  verified: 'Verified',
};

const ratingTone: Record<TrustScore['rating'], string> = {
  untrusted: 'text-muted',
  low: 'text-crit',
  medium: 'text-warn',
  high: 'text-good',
  verified: 'text-accent',
};

export function trustRatingLabel(rating: TrustScore['rating']): string {
  return ratingLabels[rating];
}

interface LedgerProps {
  trustScore: TrustScore;
  className?: string;
  height?: number;
}

export function TrustLedger({ trustScore, className = '', height = 6 }: LedgerProps) {
  const title = TRUST_SEGMENTS.map(s => `${s.label} ${trustScore.breakdown[s.key]}/${s.max}`).join(' · ');
  return (
    <div
      className={`flex w-full gap-[2px] ${className}`}
      style={{ height }}
      role="img"
      aria-label={`Trust ${trustScore.total} of 100. ${title}`}
      title={title}
    >
      {TRUST_SEGMENTS.map(({ key, max }) => {
        const pct = Math.max(0, Math.min(100, (trustScore.breakdown[key] / max) * 100));
        return (
          <div key={key} className="relative overflow-hidden rounded-[2px] bg-surface-2" style={{ flex: max }}>
            <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
          </div>
        );
      })}
    </div>
  );
}

interface TrustBadgeProps {
  trustScore: TrustScore;
  size?: 'sm' | 'md' | 'lg';
  showBreakdown?: boolean;
}

export function TrustBadge({ trustScore, size = 'md', showBreakdown = false }: TrustBadgeProps) {
  if (size === 'sm') {
    return (
      <div className="flex items-center gap-2 shrink-0" title={ratingLabels[trustScore.rating]}>
        <span className={`font-mono text-sm tabular ${ratingTone[trustScore.rating]}`}>{trustScore.total}</span>
        <div className="w-16"><TrustLedger trustScore={trustScore} height={5} /></div>
      </div>
    );
  }

  const numberClass = size === 'lg' ? 'text-5xl' : 'text-3xl';

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[180px]">
      <div className="flex items-baseline gap-2">
        <span className={`font-display font-semibold tabular ${numberClass} ${ratingTone[trustScore.rating]}`}>{trustScore.total}</span>
        <span className="text-sm text-muted">/ 100</span>
        <span className={`ml-auto text-xs font-medium ${ratingTone[trustScore.rating]}`}>{ratingLabels[trustScore.rating]}</span>
      </div>
      <TrustLedger trustScore={trustScore} height={8} />
      {showBreakdown && (
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
          {TRUST_SEGMENTS.map(({ key, label, max }) => (
            <div key={key} className="flex justify-between text-xs">
              <dt className="text-muted">{label}</dt>
              <dd className="font-mono tabular text-ink-2">{trustScore.breakdown[key]}<span className="text-muted">/{max}</span></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
