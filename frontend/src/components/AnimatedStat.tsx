import { useCountUp } from '@/hooks/useCountUp';
import { useInView } from '@/hooks/useInView';

interface AnimatedStatProps {
  value: number;
  label: string;
  suffix?: string;
  color?: string;
  className?: string;
}

export function AnimatedStat({ value, label, suffix = '', color = 'text-ink', className = '' }: AnimatedStatProps) {
  const [ref, inView] = useInView();
  const count = useCountUp(value, 900, inView);

  return (
    <div ref={ref} className={`py-6 md:px-6 md:first:pl-0 ${className}`}>
      <dt className="label">{label}</dt>
      <dd className={`mt-2 font-display text-3xl font-semibold tabular ${color}`}>
        {count.toLocaleString('en-US')}{suffix}
      </dd>
    </div>
  );
}
