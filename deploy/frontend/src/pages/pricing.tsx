import Head from 'next/head';
import Link from 'next/link';

export default function PricingPage() {
  return (
    <>
      <Head>
        <title>Pricing - XPR Agent Deploy</title>
      </Head>

      <div className="min-h-screen">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-xpr-border">
          <Link href="/" className="text-xl font-bold">
            <span className="text-xpr-purple">XPR</span> Agent Deploy
          </Link>
          <div className="flex gap-4">
            <Link href="/dashboard" className="text-gray-400 hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/deploy" className="btn-primary text-sm py-1.5">
              Deploy Now
            </Link>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-bold text-center mb-2">Simple Pricing</h1>
          <p className="text-center text-gray-400 mb-12">Pay monthly with stablecoins. No lock-in. Cancel anytime.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {/* Hosted Plan */}
            <div className="card border-xpr-purple">
              <div className="text-sm text-xpr-purple font-medium mb-2">RECOMMENDED</div>
              <h2 className="text-2xl font-bold mb-1">Hosted</h2>
              <div className="text-3xl font-bold mb-1">
                ~15 <span className="text-lg text-gray-400">XMD/mo</span>
              </div>
              <p className="text-sm text-gray-400 mb-6">or equivalent XUSDC</p>

              <ul className="space-y-3 text-sm mb-8">
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Dedicated XPR account with fresh keys</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>OpenClaw + 184 tools + 13 skills</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Cloudflare edge deployment</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Telegram / Discord / Slack integration</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Auto-sleep when idle (saves costs)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Dashboard with logs and config</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>On-chain agent registration + claim</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>3-day grace period on missed payments</span>
                </li>
              </ul>

              <Link href="/deploy" className="btn-primary w-full text-center block">
                Get Started
              </Link>
            </div>

            {/* Self-Hosted Plan */}
            <div className="card">
              <div className="text-sm text-gray-500 font-medium mb-2">ADVANCED</div>
              <h2 className="text-2xl font-bold mb-1">Self-Hosted</h2>
              <div className="text-3xl font-bold mb-1">
                $5 <span className="text-lg text-gray-400">/mo</span>
              </div>
              <p className="text-sm text-gray-400 mb-6">Cloudflare Workers plan + usage</p>

              <ul className="space-y-3 text-sm mb-8">
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Everything in Hosted</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Your own Cloudflare account</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Full infrastructure control</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Custom domain support</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-400">&#10003;</span>
                  <span>Pay Cloudflare directly</span>
                </li>
              </ul>

              <Link href="/deploy" className="btn-secondary w-full text-center block">
                Get Started
              </Link>
            </div>
          </div>

          {/* BYOK Notice */}
          <div className="max-w-3xl mx-auto mt-12">
            <div className="card">
              <h3 className="font-bold mb-2">Bring Your Own Key</h3>
              <p className="text-sm text-gray-400">
                You provide your own Anthropic API key. Your AI usage is billed directly by Anthropic
                at their standard rates. We never see or store your prompts or conversations.
              </p>
            </div>
          </div>

          {/* FAQ */}
          <div className="max-w-3xl mx-auto mt-12">
            <h2 className="text-xl font-bold mb-6">FAQ</h2>
            <div className="space-y-4">
              <div className="card">
                <h3 className="font-medium mb-1">What happens if I miss a payment?</h3>
                <p className="text-sm text-gray-400">
                  You have a 3-day grace period. After that, your agent is paused (not deleted).
                  Pay again anytime to resume. Data is kept for 30 days.
                </p>
              </div>
              <div className="card">
                <h3 className="font-medium mb-1">Can I use my existing XPR account?</h3>
                <p className="text-sm text-gray-400">
                  We recommend a dedicated account for security. The deploy service creates one for you.
                  You claim ownership with your main account via the on-chain registry.
                </p>
              </div>
              <div className="card">
                <h3 className="font-medium mb-1">What tools does my agent get?</h3>
                <p className="text-sm text-gray-400">
                  184+ tools from OpenClaw and 13 built-in skills: DeFi trading, NFT management, lending,
                  governance, stablecoins, smart contracts, creative tools, web scraping, code sandbox, and more.
                </p>
              </div>
              <div className="card">
                <h3 className="font-medium mb-1">How do I talk to my agent?</h3>
                <p className="text-sm text-gray-400">
                  Via Telegram, Discord, or Slack (you provide the bot token). Your agent also has an A2A
                  endpoint for agent-to-agent communication on the network.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
