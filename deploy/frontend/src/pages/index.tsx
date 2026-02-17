import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  return (
    <>
      <Head>
        <title>XPR Agent Deploy - Launch Your AI Agent in Minutes</title>
        <meta name="description" content="Deploy autonomous AI agents on XPR Network with 184+ tools, 13 skills, and on-chain identity." />
      </Head>

      <div className="min-h-screen">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 py-4 border-b border-xpr-border">
          <div className="text-xl font-bold">
            <span className="text-xpr-purple">XPR</span> Agent Deploy
          </div>
          <div className="flex gap-4">
            <Link href="/pricing" className="text-gray-400 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/deploy" className="btn-primary text-sm py-1.5">
              Deploy Now
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h1 className="text-5xl font-bold mb-6 leading-tight">
            Launch an AI Agent<br />
            <span className="text-xpr-purple">in 2 Minutes</span>
          </h1>
          <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
            Connect your wallet, configure your agent, pay with stablecoins.
            Get a fully autonomous AI agent with on-chain identity, 184+ tools,
            and built-in DeFi, NFT, and governance capabilities.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/deploy" className="btn-primary text-lg px-8 py-3">
              Deploy Your Agent
            </Link>
            <Link href="/pricing" className="btn-secondary text-lg px-8 py-3">
              View Pricing
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="max-w-5xl mx-auto px-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card">
              <h3 className="font-bold text-lg mb-2">Dedicated Account</h3>
              <p className="text-sm text-gray-400">
                Fresh XPR account with its own keys. Your personal account stays safe.
                Claim ownership with your KYC identity.
              </p>
            </div>

            <div className="card">
              <h3 className="font-bold text-lg mb-2">184+ Tools</h3>
              <p className="text-sm text-gray-400">
                OpenClaw plugin + 13 built-in skills: DeFi trading, NFT management,
                governance, smart contracts, image gen, and more.
              </p>
            </div>

            <div className="card">
              <h3 className="font-bold text-lg mb-2">Multi-Platform</h3>
              <p className="text-sm text-gray-400">
                Connect Telegram, Discord, or Slack. Your agent handles conversations
                and executes on-chain actions autonomously.
              </p>
            </div>

            <div className="card">
              <h3 className="font-bold text-lg mb-2">Edge Deployed</h3>
              <p className="text-sm text-gray-400">
                Runs on Cloudflare's global edge network. Low latency, high availability,
                auto-sleep when idle to save costs.
              </p>
            </div>

            <div className="card">
              <h3 className="font-bold text-lg mb-2">On-Chain Identity</h3>
              <p className="text-sm text-gray-400">
                Registered on the XPR agent registry with reputation, feedback,
                and validation scores. KYC-backed trust.
              </p>
            </div>

            <div className="card">
              <h3 className="font-bold text-lg mb-2">Pay with Stablecoins</h3>
              <p className="text-sm text-gray-400">
                Monthly subscription in XMD or XUSDC. No lock-in.
                Pause or cancel anytime.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-xpr-border py-6 px-6 text-center text-sm text-gray-500">
          <p>
            Powered by{' '}
            <a href="https://xprnetwork.org" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
              XPR Network
            </a>
            {' '}&middot;{' '}
            <a href="https://github.com/XPRNetwork/xpr-agents" target="_blank" rel="noopener" className="hover:underline">
              GitHub
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}
