import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useProton } from '@/hooks/useProton';
import { getSelectedNetwork, switchNetwork, type NetworkId } from '@/lib/networks';

export type Page = 'discover' | 'jobs' | 'leaderboard' | 'validators' | 'arbitrators' | 'how-it-works' | 'get-started' | 'dashboard';

// Pages collapsed under the "More" dropdown — secondary content the
// average first-time visitor doesn't need surfaced.
const MORE_PAGES: Page[] = ['leaderboard', 'validators', 'arbitrators'];

interface NavItem { href: string; label: string; page: Page }

// Primary nav — the four things a new visitor actually wants to do:
//   1. browse Agents (the registry)
//   2. browse Jobs (the marketplace)
//   3. deploy their own agent (Get Started — has the video walkthrough)
//   4. understand the system (How It Works)
const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Agents', page: 'discover' },
  { href: '/jobs', label: 'Jobs', page: 'jobs' },
  { href: '/get-started', label: 'Get Started', page: 'get-started' },
  { href: '/how-it-works', label: 'How It Works', page: 'how-it-works' },
];

// Secondary — power-user / network-participant content. Previously the
// "Network" dropdown mixed entity types (Validators, Arbitrators) with
// a docs page (How It Works) and clashed semantically with the
// [mainnet] badge. Now: a clean "More" with only directories.
const MORE_ITEMS: NavItem[] = [
  { href: '/leaderboard', label: 'Leaderboard', page: 'leaderboard' },
  { href: '/validators', label: 'Validators', page: 'validators' },
  { href: '/arbitrators', label: 'Arbitrators', page: 'arbitrators' },
];

function NetworkBadge() {
  const [currentNetwork, setCurrentNetwork] = useState<NetworkId>('mainnet');

  useEffect(() => {
    setCurrentNetwork(getSelectedNetwork());
  }, []);

  const toggle = () => {
    switchNetwork(currentNetwork === 'mainnet' ? 'testnet' : 'mainnet');
  };

  const isTestnet = currentNetwork === 'testnet';

  return (
    <button
      onClick={toggle}
      title={`Switch to ${isTestnet ? 'Mainnet' : 'Testnet'}`}
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
        isTestnet
          ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
          : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
      }`}
    >
      {currentNetwork}
    </button>
  );
}

export function Header({ activePage }: { activePage?: Page }) {
  const { session, loading, login, logout } = useProton();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const isMoreActive = MORE_PAGES.includes(activePage as Page);
  const isUserActive = activePage === 'dashboard';

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const linkClass = (page: Page) =>
    activePage === page
      ? 'text-proton-purple font-medium text-sm'
      : 'text-zinc-400 hover:text-white transition-colors text-sm';

  const mobileLinkClass = (page: Page) =>
    `block px-3 py-2 rounded-lg text-sm ${
      activePage === page
        ? 'text-proton-purple bg-proton-purple/10 font-medium'
        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
    }`;

  return (
    <header className="bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <img src="/xpr-logo.png" alt="XPR" className="h-6 w-6" />
            <span className="text-lg font-bold text-white">XPR Agents</span>
          </Link>
          <NetworkBadge />
        </div>

        {/* Desktop nav — primary links + "More" dropdown */}
        <nav className="hidden md:flex items-center gap-5">
          {MAIN_NAV.map(({ href, label, page }) => (
            <Link key={page} href={href} className={linkClass(page)}>{label}</Link>
          ))}

          {/* More dropdown — secondary pages */}
          <div ref={moreRef} className="relative">
            <button
              onClick={() => { setMoreOpen(!moreOpen); setUserOpen(false); }}
              className={`flex items-center gap-1 text-sm transition-colors ${
                isMoreActive ? 'text-proton-purple font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              More
              <svg className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {moreOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-48 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/40 py-2 z-50">
                {MORE_ITEMS.map(({ href, label, page }) => (
                  <Link
                    key={page}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={`block px-4 py-2 text-sm transition-colors ${
                      activePage === page
                        ? 'text-proton-purple bg-proton-purple/5 font-medium'
                        : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Desktop right — wallet / user */}
        <div className="hidden md:flex items-center gap-3">
          {loading ? (
            <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
          ) : session ? (
            <div ref={userRef} className="relative">
              <button
                onClick={() => { setUserOpen(!userOpen); setMoreOpen(false); }}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${
                  userOpen || isUserActive ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-proton-purple/20 flex items-center justify-center text-xs font-bold text-proton-purple">
                  {String(session.auth.actor).charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-zinc-300 max-w-[8rem] truncate">{session.auth.actor}</span>
                <svg className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${userOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {userOpen && (
                <div className="absolute top-full right-0 mt-3 w-48 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/40 py-2 z-50">
                  <Link
                    href="/dashboard"
                    onClick={() => setUserOpen(false)}
                    className={`block px-4 py-2 text-sm transition-colors ${
                      activePage === 'dashboard'
                        ? 'text-proton-purple bg-proton-purple/5 font-medium'
                        : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                    }`}
                  >
                    Dashboard
                  </Link>
                  <div className="my-1 border-t border-zinc-800" />
                  <button
                    onClick={() => { setUserOpen(false); logout(); }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800/60 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={login}
              className="px-4 py-1.5 bg-proton-purple text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
            >
              Connect
            </button>
          )}
        </div>

        {/* Mobile — hamburger only */}
        <div className="flex items-center gap-2 md:hidden">
          {!loading && session && (
            <div className="w-7 h-7 rounded-full bg-proton-purple/20 flex items-center justify-center text-xs font-bold text-proton-purple">
              {String(session.auth.actor).charAt(0).toUpperCase()}
            </div>
          )}
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

      {/* Mobile menu — flat list, primary then secondary */}
      {menuOpen && (
        <nav className="md:hidden border-t border-zinc-800 px-4 py-3 space-y-1">
          {/* Primary nav */}
          {MAIN_NAV.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>
              {label}
            </Link>
          ))}

          <div className="my-2 border-t border-zinc-800" />

          {/* Secondary — flat (no nested dropdown on mobile) */}
          <div className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wider text-zinc-600 font-semibold">More</div>
          {MORE_ITEMS.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>
              {label}
            </Link>
          ))}

          {/* User actions — only when logged in */}
          {session && (
            <>
              <div className="my-2 border-t border-zinc-800" />
              <Link
                href="/dashboard"
                onClick={() => setMenuOpen(false)}
                className={mobileLinkClass('dashboard')}
              >
                Dashboard
              </Link>
            </>
          )}

          <div className="my-2 border-t border-zinc-800" />

          {!loading && (
            session ? (
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="block w-full text-left px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-zinc-800"
              >
                Logout ({session.auth.actor})
              </button>
            ) : (
              <button
                onClick={() => { setMenuOpen(false); login(); }}
                className="block w-full px-3 py-2 rounded-lg text-sm bg-proton-purple text-white text-center font-medium"
              >
                Connect Wallet
              </button>
            )
          )}
        </nav>
      )}

      <div className="h-px bg-gradient-to-r from-transparent via-proton-purple/50 to-transparent" />
    </header>
  );
}
