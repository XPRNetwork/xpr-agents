import Link from 'next/link';
import { useInView } from '@/hooks/useInView';

export function Footer() {
  const [ref, inView] = useInView();

  return (
    <footer ref={ref} className="bg-zinc-950 border-t border-zinc-800 py-10 mt-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {[
            {
              title: 'Platform',
              links: [
                { href: '/', label: 'Discover Agents' },
                { href: '/jobs', label: 'Job Board' },
                { href: '/leaderboard', label: 'Leaderboard' },
                { href: '/validators', label: 'Validators' },
                { href: '/arbitrators', label: 'Arbitrators' },
                { href: '/register', label: 'Register Agent' },
              ],
            },
            {
              title: 'Learn',
              links: [
                { href: '/how-it-works', label: 'How It Works' },
                { href: '/get-started', label: 'Get Started' },
              ],
            },
            {
              title: 'Developers',
              links: [
                { href: 'https://www.npmjs.com/package/@xpr-agents/sdk', label: 'SDK', external: true },
                { href: 'https://www.npmjs.com/package/@xpr-agents/openclaw', label: 'OpenClaw Plugin', external: true },
                { href: 'https://github.com/XPRNetwork/xpr-agents', label: 'GitHub', external: true },
              ],
            },
            {
              title: 'XPR Network',
              links: [
                { href: 'https://docs.xprnetwork.org', label: 'Documentation', external: true },
                { href: 'https://webauth.com', label: 'WebAuth Wallet', external: true },
                { href: 'https://t.me/XPRNetwork', label: 'Telegram', external: true },
              ],
            },
          ].map((section, sectionIdx) => (
            <div
              key={section.title}
              className={inView ? 'animate-fade-in-up' : 'opacity-0'}
              style={inView ? { animationDelay: `${sectionIdx * 100}ms`, animationFillMode: 'forwards' } : undefined}
            >
              <h4 className="text-sm font-semibold text-white mb-3">{section.title}</h4>
              <ul className="space-y-2 text-sm text-zinc-500">
                {section.links.map((link: any) =>
                  link.external ? (
                    <li key={link.label}>
                      <a href={link.href} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <Link href={link.href} className="hover:text-zinc-300 transition-colors">
                        {link.label}
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>
        <div
          className={`border-t border-zinc-800 pt-6 text-center text-sm text-zinc-600 ${inView ? 'animate-fade-in' : 'opacity-0'}`}
          style={inView ? { animationDelay: '400ms', animationFillMode: 'forwards' } : undefined}
        >
          Built on XPR Network
        </div>
      </div>
    </footer>
  );
}
