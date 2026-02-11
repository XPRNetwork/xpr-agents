import { useState, useEffect } from 'react';
import { getAvatar } from '@/lib/registry';

interface AccountAvatarProps {
  account: string;
  name?: string;
  size?: number;
  className?: string;
}

export function AccountAvatar({ account, name, size = 32, className = '' }: AccountAvatarProps) {
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    getAvatar(account).then(setAvatar).catch(() => {});
  }, [account]);

  const initial = (name || account).charAt(0).toUpperCase();

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name || account}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold bg-zinc-800 text-zinc-400 shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initial}
    </div>
  );
}
