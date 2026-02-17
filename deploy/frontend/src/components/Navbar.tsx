import Link from 'next/link';
import { useProton } from '@/contexts/ProtonContext';

export function Navbar() {
  const { session, login, logout, loading } = useProton();

  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-xpr-border shrink-0">
      <Link href="/" className="text-xl font-bold flex items-center gap-2">
        <span className="text-2xl">🦞</span>
        <span><span className="text-xpr-purple">XPR</span> Agent Deploy</span>
      </Link>
      <div className="flex gap-4 items-center">
        <Link href="/pricing" className="text-gray-400 hover:text-white transition-colors text-sm">
          Pricing
        </Link>
        <Link href="/dashboard" className="text-gray-400 hover:text-white transition-colors text-sm">
          Dashboard
        </Link>
        <Link href="/deploy" className="btn-primary text-sm py-1.5">
          🚀 Deploy
        </Link>

        {loading ? (
          <span className="text-xs text-gray-500">...</span>
        ) : session ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400 font-mono">{session.auth.actor}</span>
            <button
              onClick={logout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded border border-transparent hover:border-red-800"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded border border-xpr-border hover:border-xpr-purple"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
