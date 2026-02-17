import { useState } from 'react';
import Link from 'next/link';
import { useProton } from '@/contexts/ProtonContext';

export function Navbar() {
  const { session, login, logout, loading, verifying, authenticated, error } = useProton();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (
    <>
      <Link
        href="/pricing"
        className="text-gray-400 hover:text-white transition-colors text-sm"
        onClick={() => setMenuOpen(false)}
      >
        Pricing
      </Link>
      <Link
        href="/dashboard"
        className="text-gray-400 hover:text-white transition-colors text-sm"
        onClick={() => setMenuOpen(false)}
      >
        Dashboard
      </Link>
      <Link
        href="/deploy"
        className="btn-primary text-sm py-1.5"
        onClick={() => setMenuOpen(false)}
      >
        Deploy
      </Link>
    </>
  );

  const walletSection = (
    <>
      {loading ? (
        <span className="text-xs text-gray-500">Loading...</span>
      ) : verifying ? (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
          <span className="text-xs text-yellow-400">Verifying identity...</span>
        </div>
      ) : session && authenticated ? (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Verified" />
          <span className="text-sm text-gray-400 font-mono truncate max-w-[120px]">{session.auth.actor}</span>
          <button
            onClick={() => { logout(); setMenuOpen(false); }}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded border border-transparent hover:border-red-800 whitespace-nowrap"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-red-400 max-w-[250px] truncate" title={error}>{error}</span>
            )}
            <button
              onClick={() => { login(); setMenuOpen(false); }}
              className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded border border-xpr-border hover:border-xpr-purple whitespace-nowrap"
            >
              Connect Wallet
            </button>
          </div>
          <span className="text-[10px] text-gray-600 leading-tight">
            Two popups: 1) Select wallet 2) Approve signature. If blocked, enable popups and refresh.
          </span>
        </div>
      )}
    </>
  );

  return (
    <nav className="border-b border-xpr-border shrink-0">
      {/* Desktop */}
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold flex items-center gap-2">
          <span className="text-2xl">🦞</span>
          <span><span className="text-xpr-purple">XPR</span> Agent Deploy</span>
        </Link>

        {/* Desktop nav links + wallet */}
        <div className="hidden md:flex gap-4 items-center">
          {navLinks}
          {walletSection}
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden p-2 text-gray-400 hover:text-white"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-xpr-border px-6 py-4 flex flex-col gap-4">
          {navLinks}
          <div className="pt-2 border-t border-xpr-border">
            {walletSection}
          </div>
        </div>
      )}
    </nav>
  );
}
