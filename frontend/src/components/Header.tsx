import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useProton } from '@/hooks/useProton';

export type Page = 'discover' | 'jobs' | 'leaderboard' | 'validators' | 'arbitrators' | 'how-it-works' | 'get-started' | 'dashboard';

const NETWORK_PAGES: Page[] = ['validators', 'arbitrators', 'how-it-works'];
const USER_PAGES: Page[] = ['dashboard', 'get-started'];

interface NavItem { href: string; label: string; page: Page }

const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Discover', page: 'discover' },
  { href: '/jobs', label: 'Jobs', page: 'jobs' },
  { href: '/leaderboard', label: 'Leaderboard', page: 'leaderboard' },
];

const NETWORK_ITEMS: NavItem[] = [
  { href: '/validators', label: 'Validators', page: 'validators' },
  { href: '/arbitrators', label: 'Arbitrators', page: 'arbitrators' },
  { href: '/how-it-works', label: 'How It Works', page: 'how-it-works' },
];

const USER_MENU_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', page: 'dashboard' },
  { href: '/get-started', label: 'Get Started', page: 'get-started' },
];

export function Header({ activePage }: { activePage?: Page }) {
  const { session, loading, login, logout } = useProton();
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [mobileNetworkOpen, setMobileNetworkOpen] = useState(false);
  const networkRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const isNetworkActive = NETWORK_PAGES.includes(activePage as Page);
  const isUserActive = USER_PAGES.includes(activePage as Page);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (networkRef.current && !networkRef.current.contains(e.target as Node)) setNetworkOpen(false);
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
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img src="/xpr-logo.png" alt="XPR" className="h-6 w-6" />
          <span className="text-lg font-bold text-white">XPR Agents</span>
        </Link>

        {/* Desktop nav — center links */}
        <nav className="hidden md:flex items-center gap-5">
          {MAIN_NAV.map(({ href, label, page }) => (
            <Link key={page} href={href} className={linkClass(page)}>{label}</Link>
          ))}

          {/* Network dropdown */}
          <div ref={networkRef} className="relative">
            <button
              onClick={() => { setNetworkOpen(!networkOpen); setUserOpen(false); }}
              className={`flex items-center gap-1 text-sm transition-colors ${
                isNetworkActive ? 'text-proton-purple font-medium' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Network
              <svg className={`w-3.5 h-3.5 transition-transform ${networkOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {networkOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-48 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl shadow-black/40 py-2 z-50">
                {NETWORK_ITEMS.map(({ href, label, page }) => (
                  <Link
                    key={page}
                    href={href}
                    onClick={() => setNetworkOpen(false)}
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
                onClick={() => { setUserOpen(!userOpen); setNetworkOpen(false); }}
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
                  {USER_MENU_ITEMS.map(({ href, label, page }) => (
                    <Link
                      key={page}
                      href={href}
                      onClick={() => setUserOpen(false)}
                      className={`block px-4 py-2 text-sm transition-colors ${
                        activePage === page
                          ? 'text-proton-purple bg-proton-purple/5 font-medium'
                          : 'text-zinc-300 hover:text-white hover:bg-zinc-800/60'
                      }`}
                    >
                      {label}
                    </Link>
                  ))}
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

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-zinc-800 px-4 py-3 space-y-1">
          {MAIN_NAV.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>
              {label}
            </Link>
          ))}

          {/* Network group */}
          <button
            onClick={() => setMobileNetworkOpen(!mobileNetworkOpen)}
            className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm ${
              isNetworkActive ? 'text-proton-purple bg-proton-purple/10 font-medium' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            Network
            <svg className={`w-4 h-4 transition-transform ${mobileNetworkOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {mobileNetworkOpen && (
            <div className="pl-4 space-y-1">
              {NETWORK_ITEMS.map(({ href, label, page }) => (
                <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>
                  {label}
                </Link>
              ))}
            </div>
          )}

          <div className="my-2 border-t border-zinc-800" />

          {USER_MENU_ITEMS.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>
              {label}
            </Link>
          ))}

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
