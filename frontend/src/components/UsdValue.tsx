import { formatUsd, useXprUsdPrice } from '@/lib/xpr-price';

/**
 * The approximate USD worth of an XPR amount, as a quiet secondary line.
 *
 * Renders nothing at all when the oracle is unavailable or the amount is zero,
 * so a price never collapses into "$0.00" and no layout depends on it arriving.
 * XPR stays the headline everywhere: this only answers "is that a lot?".
 */
export function UsdValue({
  rawAmount,
  className = '',
  /** Rendered inline (a trailing "· $1.99") rather than as its own line. */
  inline = false,
}: {
  rawAmount: number;
  className?: string;
  inline?: boolean;
}) {
  const price = useXprUsdPrice();
  const usd = formatUsd(rawAmount, price);
  if (!usd) return null;

  const text = `≈ ${usd}`;
  return inline ? (
    <span className={`font-mono text-muted ${className}`} title="Approximate, from the on-chain XPR/USD oracle">
      {text}
    </span>
  ) : (
    <div className={`font-mono text-xs text-muted ${className}`} title="Approximate, from the on-chain XPR/USD oracle">
      {text}
    </div>
  );
}

export default UsdValue;
