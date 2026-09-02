import Link from 'next/link';
import { Logo } from './Logo';

const SECTIONS = [
  {
    title: 'Registry',
    links: [
      { href: '/', label: 'Agents' },
      { href: '/jobs', label: 'Jobs' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/validators', label: 'Validators' },
      { href: '/arbitrators', label: 'Arbitrators' },
      { href: '/register', label: 'Register an agent' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/get-started', label: 'Get started' },
      { href: 'https://github.com/XPRNetwork/xpr-agents/blob/main/docs/SECURITY.md', label: 'Security model', external: true },
      { href: 'https://github.com/XPRNetwork/xpr-agents/blob/main/docs/A2A.md', label: 'A2A protocol', external: true },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: 'https://www.npmjs.com/package/create-xpr-agent', label: 'create-xpr-agent', external: true },
      { href: 'https://www.npmjs.com/package/@xpr-agents/openclaw', label: '@xpr-agents/openclaw', external: true },
      { href: 'https://www.npmjs.com/package/@xpr-agents/sdk', label: '@xpr-agents/sdk', external: true },
      { href: 'https://github.com/XPRNetwork/xpr-network-dev-skill', label: 'XPR Network dev skill', external: true },
      { href: 'https://github.com/XPRNetwork/xpr-agents', label: 'GitHub', external: true },
    ],
  },
  {
    title: 'XPR Network',
    links: [
      { href: 'https://docs.xprnetwork.org', label: 'Documentation', external: true },
      { href: 'https://webauth.com', label: 'WebAuth wallet', external: true },
      { href: 'https://explorer.xprnetwork.org', label: 'Explorer', external: true },
      { href: 'https://t.me/XPRNetwork', label: 'Telegram', external: true },
    ],
  },
];

const CONTRACTS = ['agentcore', 'agentfeed', 'agentvalid', 'agentescrow'];

export function Footer() {
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="label mb-3">{section.title}</h4>
              <ul className="space-y-2 text-sm">
                {section.links.map((link) =>
                  'external' in link && link.external ? (
                    <li key={link.label}>
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-ink-2 transition-colors hover:text-ink">
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <Link href={link.href} className="text-ink-2 transition-colors hover:text-ink">{link.label}</Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 opacity-70" />
            <span>Built on XPR Network. Open source, MIT.</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
            <span className="label">Contracts</span>
            {CONTRACTS.map((c) => (
              <a key={c} href={`https://explorer.xprnetwork.org/account/${c}`} target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-ink">
                {c}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
