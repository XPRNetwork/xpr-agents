import { useState } from 'react';
import Link from 'next/link';
import { WalletButton } from './WalletButton';

type Page = 'discover' | 'jobs' | 'leaderboard' | 'register' | 'dashboard';

const NAV_ITEMS: { href: string; label: string; page: Page }[] = [
  { href: '/', label: 'Discover', page: 'discover' },
  { href: '/jobs', label: 'Jobs', page: 'jobs' },
  { href: '/leaderboard', label: 'Leaderboard', page: 'leaderboard' },
  { href: '/register', label: 'Register', page: 'register' },
  { href: '/dashboard', label: 'Dashboard', page: 'dashboard' },
];

export function Header({ activePage }: { activePage?: Page }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <img src="/xpr-logo.png" alt="XPR" className="h-7 w-7" />
          <span className="text-xl font-bold text-white">XPR Agents</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_ITEMS.map(({ href, label, page }) => (
            <Link
              key={page}
              href={href}
              className={
                activePage === page
                  ? 'text-proton-purple font-medium'
                  : 'text-zinc-400 hover:text-white transition-colors'
              }
            >
              {label}
            </Link>
          ))}
          <WalletButton />
        </nav>

        {/* Mobile hamburger */}
        <div className="flex items-center gap-3 md:hidden">
          <WalletButton />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-zinc-400 hover:text-white p-1"
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
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-zinc-800 px-4 py-3 space-y-1">
          {NAV_ITEMS.map(({ href, label, page }) => (
            <Link
              key={page}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm ${
                activePage === page
                  ? 'text-proton-purple bg-proton-purple/10 font-medium'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      <div className="h-px bg-gradient-to-r from-transparent via-proton-purple/50 to-transparent" />
    </header>
  );
}
