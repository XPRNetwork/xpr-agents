import { TrustScore } from '@/lib/registry';

interface TrustBadgeProps {
  trustScore: TrustScore;
  size?: 'sm' | 'md' | 'lg';
  showBreakdown?: boolean;
}

const ratingColors = {
  untrusted: 'bg-gray-500',
  low: 'bg-red-500',
  medium: 'bg-yellow-500',
  high: 'bg-green-500',
  verified: 'bg-proton-purple',
};

const ratingLabels = {
  untrusted: 'Untrusted',
  low: 'Low Trust',
  medium: 'Medium Trust',
  high: 'High Trust',
  verified: 'Verified',
};

export function TrustBadge({ trustScore, size = 'md', showBreakdown = false }: TrustBadgeProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-sm',
    lg: 'w-16 h-16 text-lg',
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`${sizeClasses[size]} ${ratingColors[trustScore.rating]} rounded-full flex items-center justify-center text-white font-bold`}
      >
        {trustScore.total}
      </div>
      <span className={`text-${size === 'sm' ? 'xs' : 'sm'} text-gray-600`}>
        {ratingLabels[trustScore.rating]}
      </span>

      {showBreakdown && (
        <div className="mt-2 text-xs text-gray-500 space-y-1">
          <div className="flex justify-between gap-4">
            <span>KYC:</span>
            <span>{trustScore.breakdown.kyc}/30</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Stake:</span>
            <span>{trustScore.breakdown.stake}/20</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Reputation:</span>
            <span>{trustScore.breakdown.reputation}/40</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Longevity:</span>
            <span>{trustScore.breakdown.longevity}/10</span>
          </div>
        </div>
      )}
    </div>
  );
}
