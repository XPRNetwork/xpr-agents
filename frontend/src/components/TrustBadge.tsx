import { TrustScore } from '@/lib/registry';
import { useCountUp } from '@/hooks/useCountUp';
import { useInView } from '@/hooks/useInView';

interface TrustBadgeProps {
  trustScore: TrustScore;
  size?: 'sm' | 'md' | 'lg';
  showBreakdown?: boolean;
}

const ratingColors: Record<string, string> = {
  untrusted: '#71717a', // zinc-500
  low: '#ef4444',       // red-500
  medium: '#eab308',    // yellow-500
  high: '#22c55e',      // green-500
  verified: '#7D3CF8',  // proton-purple
};

const ratingLabels: Record<string, string> = {
  untrusted: 'Untrusted',
  low: 'Low Trust',
  medium: 'Medium Trust',
  high: 'High Trust',
  verified: 'Verified',
};

const sizeConfigs = {
  sm:  { svg: 36, radius: 14, stroke: 3,  glow: false, fontSize: 'text-[10px]' },
  md:  { svg: 56, radius: 22, stroke: 4,  glow: true,  fontSize: 'text-xs' },
  lg:  { svg: 80, radius: 32, stroke: 5,  glow: true,  fontSize: 'text-base' },
};

const breakdownConfig = [
  { key: 'kyc' as const,        label: 'KYC',        max: 30, color: '#7D3CF8' },
  { key: 'stake' as const,      label: 'Stake',      max: 20, color: '#3b82f6' },
  { key: 'reputation' as const, label: 'Reputation', max: 40, color: '#22c55e' },
  { key: 'longevity' as const,  label: 'Longevity',  max: 10, color: '#eab308' },
];

export function TrustBadge({ trustScore, size = 'md', showBreakdown = false }: TrustBadgeProps) {
  const [ref, inView] = useInView();
  const count = useCountUp(trustScore.total, 800, inView);
  const cfg = sizeConfigs[size];
  const color = ratingColors[trustScore.rating];
  const circumference = 2 * Math.PI * cfg.radius;
  const fillPercent = trustScore.total / 100;
  const offset = circumference * (1 - fillPercent);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: cfg.svg, height: cfg.svg }}>
        {/* Glow background */}
        {cfg.glow && inView && (
          <div
            className="absolute inset-0 rounded-full animate-glow-pulse"
            style={{
              background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
            }}
          />
        )}
        <svg
          width={cfg.svg}
          height={cfg.svg}
          className="gpu-accelerated"
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* Background track */}
          <circle
            cx={cfg.svg / 2}
            cy={cfg.svg / 2}
            r={cfg.radius}
            fill="none"
            stroke="#27272a"
            strokeWidth={cfg.stroke}
          />
          {/* Animated fill ring */}
          {inView && (
            <circle
              cx={cfg.svg / 2}
              cy={cfg.svg / 2}
              r={cfg.radius}
              fill="none"
              stroke={color}
              strokeWidth={cfg.stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="animate-ring-fill"
              style={{
                '--ring-circumference': `${circumference}`,
                '--ring-offset': `${offset}`,
              } as React.CSSProperties}
            />
          )}
        </svg>
        {/* Center number */}
        <div
          className={`absolute inset-0 flex items-center justify-center font-bold text-white ${cfg.fontSize}`}
        >
          {count}
        </div>
      </div>
      <span className={`${size === 'sm' ? 'text-[10px]' : 'text-xs'} text-zinc-400`}>
        {ratingLabels[trustScore.rating]}
      </span>

      {showBreakdown && (
        <div className="mt-2 w-full max-w-[180px] space-y-2">
          {breakdownConfig.map(({ key, label, max, color: barColor }) => {
            const val = trustScore.breakdown[key];
            const pct = (val / max) * 100;
            return (
              <div key={key}>
                <div className="flex justify-between text-[10px] text-zinc-500 mb-0.5">
                  <span>{label}</span>
                  <span>{val}/{max}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  {inView && (
                    <div
                      className="h-full rounded-full animate-bar-fill"
                      style={{
                        backgroundColor: barColor,
                        width: `${pct}%`,
                        '--bar-width': `${pct}%`,
                      } as React.CSSProperties}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
