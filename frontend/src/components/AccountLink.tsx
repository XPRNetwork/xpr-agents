import Link from 'next/link';
import { AccountAvatar } from './AccountAvatar';
import { getNetworkConfig } from '../lib/networks';

function getExplorerAccountUrl() {
  return `${getNetworkConfig().explorer}/account`;
}

interface AccountLinkProps {
  account: string;
  /** If true, links to /agent/[account]. Otherwise links to block explorer. */
  isAgent?: boolean;
  /** Show avatar before the name */
  showAvatar?: boolean;
  avatarSize?: number;
  className?: string;
}

export function AccountLink({
  account,
  isAgent = false,
  showAvatar = false,
  avatarSize = 18,
  className = '',
}: AccountLinkProps) {
  if (!account || account === '.............') return null;

  const inner = (
    <>
      {showAvatar && <AccountAvatar account={account} size={avatarSize} />}
      <span>{account}</span>
    </>
  );

  if (isAgent) {
    return (
      <Link
        href={`/agent/${account}`}
        className={`inline-flex items-center gap-1.5 text-proton-purple hover:underline ${className}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <a
      href={`${getExplorerAccountUrl()}/${account}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-zinc-300 hover:text-proton-purple hover:underline ${className}`}
    >
      {inner}
    </a>
  );
}
