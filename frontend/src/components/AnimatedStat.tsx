import { useCountUp } from '@/hooks/useCountUp';
import { useInView } from '@/hooks/useInView';

interface AnimatedStatProps {
  value: number;
  label: string;
  suffix?: string;
  color?: string;
}

export function AnimatedStat({ value, label, suffix = '', color = 'text-proton-purple' }: AnimatedStatProps) {
  const [ref, inView] = useInView();
  const count = useCountUp(value, 1200, inView);

  return (
    <div ref={ref}>
      <div className={`text-3xl font-bold ${color}`}>
        {count}{suffix}
      </div>
      <div className="text-zinc-400">{label}</div>
    </div>
  );
}
