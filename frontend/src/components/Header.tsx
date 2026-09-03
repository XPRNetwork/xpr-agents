import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useProton } from '@/hooks/useProton';
import { getSelectedNetwork, switchNetwork, type NetworkId } from '@/lib/networks';
import { ThemeToggle } from './ThemeToggle';
import { TaskBell } from './TaskBell';
import { Logo } from './Logo';

export type Page = 'discover' | 'services' | 'jobs' | 'leaderboard' | 'validators' | 'arbitrators' | 'how-it-works' | 'get-started' | 'dashboard';

const MORE_PAGES: Page[] = ['leaderboard', 'validators', 'arbitrators'];

interface NavItem { href: string; label: string; page: Page
  /** Shown inline only from the xl breakpoint; collapses into More below it. */
  secondary?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Agents', page: 'discover' },
  { href: '/services', label: 'Services', page: 'services' },
  { href: '/jobs', label: 'Jobs', page: 'jobs' },
  { href: '/get-started', label: 'Get started', page: 'get-started', secondary: true },
  { href: '/how-it-works', label: 'How it works', page: 'how-it-works', secondary: true },
];

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

  const isTestnet = currentNetwork === 'testnet';

  const toggle = () => {
    const target = isTestnet ? 'mainnet' : 'testnet';
    // Switching reloads the page; never do it on a stray click.
    if (window.confirm(`Switch to ${target}? The page will reload and unsaved form input will be lost.`)) {
      switchNetwork(target);
    }
  };

  return (
    <button
      onClick={toggle}
      title={`Switch to ${isTestnet ? 'mainnet' : 'testnet'}`}
      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-label transition-colors ${
        isTestnet
          ? 'border-warn/30 bg-warn-soft text-warn'
          : 'border-line text-muted hover:border-line-2 hover:text-ink-2'
      }`}
    >
      {currentNetwork}
    </button>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

export function Header({ activePage }: { activePage?: Page }) {
  const { session, loading, login, logout } = useProton();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const isMoreActive = MORE_PAGES.includes(activePage as Page) || MAIN_NAV.some(i => i.secondary && i.page === activePage);
  const isUserActive = activePage === 'dashboard';

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setMoreOpen(false); setUserOpen(false); setMenuOpen(false); }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const linkClass = (page: Page) =>
    `relative py-1 text-sm transition-colors ${
      activePage === page
        ? 'text-ink font-medium after:absolute after:-bottom-[17px] after:left-0 after:right-0 after:h-[2px] after:bg-accent'
        : 'text-ink-2 hover:text-ink'
    }`;

  const mobileLinkClass = (page: Page) =>
    `block rounded-lg px-3 py-2 text-sm ${
      activePage === page ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface hover:text-ink'
    }`;

  const menuItemClass = (active: boolean) =>
    `block px-3 py-2 text-sm transition-colors ${active ? 'font-medium text-accent' : 'text-ink-2 hover:bg-surface hover:text-ink'}`;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="mr-6 flex shrink-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-2" aria-label="XPR Agents home">
            <Logo className="h-6 w-6" />
            <span className="font-display text-[17px] font-semibold text-ink">XPR Agents</span>
          </Link>
          <NetworkBadge />
        </div>

        <nav className="hidden min-w-0 items-center gap-5 md:flex lg:gap-6" aria-label="Primary">
          {MAIN_NAV.map(({ href, label, page, secondary }) => (
            <Link key={page} href={href} className={`${linkClass(page)} whitespace-nowrap ${secondary ? 'hidden xl:inline-flex' : ''}`}>{label}</Link>
          ))}

          <div ref={moreRef} className="relative">
            <button
              onClick={() => { setMoreOpen(!moreOpen); setUserOpen(false); }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              className={`flex items-center gap-1 py-1 text-sm transition-colors ${
                isMoreActive ? 'font-medium text-ink' : 'text-ink-2 hover:text-ink'
              }`}
            >
              More
              <Chevron open={moreOpen} />
            </button>
            {moreOpen && (
              <div role="menu" className="absolute left-1/2 top-full z-50 mt-3 w-44 -translate-x-1/2 rounded-lg border border-line bg-canvas py-1.5 shadow-lg shadow-ink/5">
                {MAIN_NAV.filter(i => i.secondary).map(({ href, label, page }) => (
                  <Link key={page} href={href} role="menuitem" onClick={() => setMoreOpen(false)} className={`${menuItemClass(activePage === page)} xl:hidden`}>
                    {label}
                  </Link>
                ))}
                <div className="my-1 border-t border-line xl:hidden" aria-hidden="true" />
                {MORE_ITEMS.map(({ href, label, page }) => (
                  <Link key={page} href={href} role="menuitem" onClick={() => setMoreOpen(false)} className={menuItemClass(activePage === page)}>
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          {session && <TaskBell account={String(session.auth.actor)} />}
          {loading ? (
            <div className="h-8 w-24 skeleton-shimmer rounded-md" />
          ) : session ? (
            <div ref={userRef} className="relative">
              <button
                onClick={() => { setUserOpen(!userOpen); setMoreOpen(false); }}
                aria-expanded={userOpen}
                aria-haspopup="menu"
                className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
                  userOpen || isUserActive ? 'bg-surface' : 'hover:bg-surface'
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft font-mono text-[11px] font-semibold text-accent">
                  {String(session.auth.actor).charAt(0).toUpperCase()}
                </span>
                <span className="max-w-[8rem] truncate font-mono text-sm text-ink-2">{session.auth.actor}</span>
                <span className="text-muted"><Chevron open={userOpen} /></span>
              </button>
              {userOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-3 w-44 rounded-lg border border-line bg-canvas py-1.5 shadow-lg shadow-ink/5">
                  <Link href="/dashboard" role="menuitem" onClick={() => setUserOpen(false)} className={menuItemClass(activePage === 'dashboard')}>
                    Dashboard
                  </Link>
                  <div className="my-1 border-t border-line" />
                  <button
                    role="menuitem"
                    onClick={() => { setUserOpen(false); logout(); }}
                    className="block w-full px-3 py-2 text-left text-sm text-crit hover:bg-surface"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={login}
              className="rounded-md bg-ink px-3.5 py-1.5 text-sm font-medium text-canvas transition-colors hover:bg-ink/85"
            >
              Connect wallet
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          {!loading && session && (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft font-mono text-[11px] font-semibold text-accent">
              {String(session.auth.actor).charAt(0).toUpperCase()}
            </span>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-ink-2 hover:text-ink"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            ) : (
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="space-y-1 border-t border-line px-4 py-3 md:hidden" aria-label="Mobile">
          {MAIN_NAV.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>{label}</Link>
          ))}
          <div className="my-2 border-t border-line" />
          <div className="label px-3 pb-1 pt-1">More</div>
          {MORE_ITEMS.map(({ href, label, page }) => (
            <Link key={page} href={href} onClick={() => setMenuOpen(false)} className={mobileLinkClass(page)}>{label}</Link>
          ))}
          {session && (
            <>
              <div className="my-2 border-t border-line" />
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} className={mobileLinkClass('dashboard')}>Dashboard</Link>
            </>
          )}
          <div className="my-2 border-t border-line" />
          {!loading && (
            session ? (
              <button onClick={() => { setMenuOpen(false); logout(); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-crit hover:bg-surface">
                Log out <span className="font-mono text-muted">({session.auth.actor})</span>
              </button>
            ) : (
              <button onClick={() => { setMenuOpen(false); login(); }} className="block w-full rounded-md bg-ink px-3 py-2.5 text-center text-sm font-medium text-canvas">
                Connect wallet
              </button>
            )
          )}
        </nav>
      )}
    </header>
  );
}
