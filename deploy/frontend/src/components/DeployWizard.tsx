import { useState, useEffect } from 'react';
import { useProton } from '@/contexts/ProtonContext';
import { checkNameAvailability, deployAgent, type DeployRequest } from '@/lib/deploy-api';
import { getNetworkConfig } from '@/lib/networks';

type Step = 'connect' | 'configure' | 'integrations' | 'review' | 'deploying' | 'done';

interface FormData {
  agentName: string;
  displayName: string;
  description: string;
  capabilities: string[];
  plan: 'hosted' | 'selfhosted';
  anthropicApiKey: string;
  telegramToken: string;
  discordToken: string;
  slackToken: string;
}

const CAPABILITY_OPTIONS: { label: string; emoji: string; tip: string }[] = [
  { label: 'Code Generation', emoji: '💻', tip: 'Write, review, and debug code in multiple languages' },
  { label: 'Content Writing', emoji: '✍️', tip: 'Create articles, blog posts, marketing copy, and more' },
  { label: 'Data Analysis', emoji: '📊', tip: 'Analyze datasets, generate charts, and extract insights' },
  { label: 'Image Generation', emoji: '🎨', tip: 'Create AI-generated images via Replicate' },
  { label: 'DeFi Trading', emoji: '📈', tip: 'Trade tokens on DEX, AMM swaps, OTC escrow, yield farming' },
  { label: 'NFT Management', emoji: '🖼️', tip: 'Mint, list, buy, and manage NFTs on AtomicAssets' },
  { label: 'Research', emoji: '🔍', tip: 'Web research, data gathering, and report compilation' },
  { label: 'Customer Support', emoji: '💬', tip: 'Handle customer queries via chat, Telegram, or Discord' },
  { label: 'Social Media', emoji: '📱', tip: 'Post to Shellbook, manage social presence' },
  { label: 'Smart Contracts', emoji: '📝', tip: 'Inspect, scaffold, and audit smart contracts on XPR Network' },
];

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex ml-1 cursor-help">
      <span className="text-gray-500 hover:text-gray-300 text-xs">ⓘ</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {text}
      </span>
    </span>
  );
}

function StepIndicator({ current, steps }: { current: Step; steps: { id: Step; label: string; emoji: string }[] }) {
  const currentIndex = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {steps.map((s, i) => {
        const isActive = i === currentIndex;
        const isDone = i < currentIndex;
        return (
          <div key={s.id} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-0.5 mx-1 ${isDone ? 'bg-xpr-purple' : 'bg-xpr-border'}`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-xpr-purple/20 text-xpr-purple border border-xpr-purple/50'
                  : isDone
                  ? 'bg-green-900/20 text-green-400 border border-green-800/50'
                  : 'bg-xpr-dark text-gray-500 border border-xpr-border'
              }`}
            >
              <span>{isDone ? '✅' : s.emoji}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WIZARD_STEPS: { id: Step; label: string; emoji: string }[] = [
  { id: 'connect', label: 'Connect', emoji: '🔗' },
  { id: 'configure', label: 'Configure', emoji: '⚙️' },
  { id: 'integrations', label: 'Integrations', emoji: '🔌' },
  { id: 'review', label: 'Review', emoji: '✨' },
];

export function DeployWizard() {
  const { session, login, transact, jwtToken } = useProton();
  const [step, setStep] = useState<Step>('connect');
  const [form, setForm] = useState<FormData>({
    agentName: '',
    displayName: '',
    description: '',
    capabilities: [],
    plan: 'hosted',
    anthropicApiKey: '',
    telegramToken: '',
    discordToken: '',
    slackToken: '',
  });
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const [nameChecking, setNameChecking] = useState(false);
  const [error, setError] = useState('');
  const [deployResult, setDeployResult] = useState<any>(null);
  const [deployProgress, setDeployProgress] = useState('');

  // Auto-advance past connect step when session is active
  useEffect(() => {
    if (session && step === 'connect') {
      setStep('configure');
    }
  }, [session, step]);

  // Debounced name availability check
  useEffect(() => {
    if (form.agentName.length < 3) {
      setNameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setNameChecking(true);
      try {
        const result = await checkNameAvailability(form.agentName);
        setNameAvailable(result.available);
      } catch {
        setNameAvailable(null);
      } finally {
        setNameChecking(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.agentName]);

  const handleDeploy = async () => {
    setStep('deploying');
    setError('');

    try {
      setDeployProgress('Creating subscription on-chain...');

      // Step 1: Call subscribe on agentdeploy contract
      const networkConfig = getNetworkConfig();
      const deployContract = 'agentdeploy'; // TODO: configurable

      try {
        await transact([
          {
            account: deployContract,
            name: 'subscribe',
            data: {
              owner: session!.auth.actor,
              agent: form.agentName,
              plan: form.plan,
            },
          },
        ]);
      } catch (e: any) {
        // If contract isn't deployed yet, continue anyway for MVP
        console.warn('Subscribe tx failed (contract may not be deployed):', e.message);
      }

      // Step 2: Send payment (XMD transfer with sub: memo)
      setDeployProgress('Processing payment...');

      try {
        await transact([
          {
            account: 'xmd.token',
            name: 'transfer',
            data: {
              from: session!.auth.actor,
              to: deployContract,
              quantity: '15.0000 XMD',
              memo: `sub:${form.agentName}`,
            },
          },
        ]);
      } catch (e: any) {
        console.warn('Payment tx failed:', e.message);
        // For MVP/testnet, proceed without payment
      }

      // Step 3: Trigger backend provisioning
      setDeployProgress('🤖 Provisioning agent (this may take a minute)...');

      const req: DeployRequest = {
        owner: session!.auth.actor,
        agentName: form.agentName,
        displayName: form.displayName,
        description: form.description,
        capabilities: JSON.stringify(form.capabilities),
        plan: form.plan,
        anthropicApiKey: form.anthropicApiKey,
        telegramToken: form.telegramToken || undefined,
        discordToken: form.discordToken || undefined,
        slackToken: form.slackToken || undefined,
      };

      if (!jwtToken) {
        throw new Error('Wallet authentication required. Please reconnect your wallet.');
      }

      const result = await deployAgent(req, jwtToken);
      setDeployResult(result);

      if (result.dashboardToken) {
        localStorage.setItem(`dashboard_token_${result.agentAccount}`, result.dashboardToken);
      }

      setStep('done');
    } catch (e: any) {
      setError(e.message || 'Deployment failed');
      setStep('review'); // Go back so user can retry
    }
  };

  const toggleCapability = (cap: string) => {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }));
  };

  // ============== RENDER STEPS ==============

  if (step === 'connect') {
    return (
      <div className="max-w-lg mx-auto">
        <StepIndicator current={step} steps={WIZARD_STEPS} />
        <div className="card text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h2 className="text-2xl font-bold mb-4">Deploy Your AI Agent</h2>
          <p className="text-gray-400 mb-2">
            Launch an autonomous AI agent on XPR Network in minutes.
          </p>
          <p className="text-gray-500 text-sm mb-6">
            Your agent comes pre-loaded with <span className="text-xpr-purple font-medium">184+ tools</span> and{' '}
            <span className="text-xpr-purple font-medium">13 built-in skills</span> including DeFi trading,
            NFT management, code generation, and more.
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8 text-center">
            <div className="bg-xpr-dark rounded-lg p-3">
              <div className="text-2xl mb-1">⚡</div>
              <div className="text-xs text-gray-400">Ready in minutes</div>
            </div>
            <div className="bg-xpr-dark rounded-lg p-3">
              <div className="text-2xl mb-1">🔒</div>
              <div className="text-xs text-gray-400">Dedicated account</div>
            </div>
            <div className="bg-xpr-dark rounded-lg p-3">
              <div className="text-2xl mb-1">🌐</div>
              <div className="text-xs text-gray-400">Edge-deployed</div>
            </div>
          </div>

          <button onClick={login} className="btn-primary text-lg px-8 py-3 w-full">
            🔗 Connect Wallet to Get Started
          </button>
          <p className="text-xs text-gray-600 mt-3">
            You'll need a{' '}
            <a href="https://webauth.com" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
              WebAuth wallet
            </a>{' '}
            on XPR Network
          </p>
        </div>
      </div>
    );
  }

  if (step === 'configure') {
    return (
      <div className="max-w-2xl mx-auto">
        <StepIndicator current={step} steps={WIZARD_STEPS} />
        <div className="card">
          <h2 className="text-2xl font-bold mb-1">⚙️ Configure Your Agent</h2>
          <p className="text-gray-400 text-sm mb-6">Set up your agent's identity and capabilities.</p>

          {/* Agent Name */}
          <div className="mb-5">
            <label className="label flex items-center">
              🏷️ Agent Account Name
              <Tooltip text="This becomes your agent's on-chain account (e.g. myagent12345). It must be unique and cannot be changed later." />
            </label>
            <div className="relative">
              <input
                type="text"
                className="input"
                placeholder="myagent12345"
                maxLength={12}
                value={form.agentName}
                onChange={(e) => setForm({ ...form, agentName: e.target.value.toLowerCase().replace(/[^a-z1-5.]/g, '') })}
              />
              <span className="absolute right-3 top-2.5 text-sm">
                {nameChecking && <span className="text-gray-400">⏳ checking...</span>}
                {!nameChecking && nameAvailable === true && <span className="text-green-400">✅ available</span>}
                {!nameChecking && nameAvailable === false && <span className="text-red-400">❌ taken</span>}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              12 characters max. Lowercase letters a-z, numbers 1-5, and periods only.
            </p>
          </div>

          {/* Display Name */}
          <div className="mb-5">
            <label className="label flex items-center">
              ✨ Display Name
              <Tooltip text="A friendly name shown to users. Can be anything — e.g. 'My Trading Bot' or 'Alice's Assistant'." />
            </label>
            <input
              type="text"
              className="input"
              placeholder="My Awesome Agent"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>

          {/* Description */}
          <div className="mb-5">
            <label className="label flex items-center">
              📝 Description
              <Tooltip text="Describe what your agent does. This is displayed publicly on the agent registry and helps others understand your agent's purpose." />
            </label>
            <textarea
              className="input min-h-[80px]"
              placeholder="An AI assistant that helps with DeFi trading and portfolio management..."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          {/* Capabilities */}
          <div className="mb-5">
            <label className="label flex items-center">
              🧰 Capabilities
              <Tooltip text="Select what your agent can do. This configures which tools and skills are enabled. You can change these later from the dashboard." />
            </label>
            <p className="text-xs text-gray-500 mb-2">Click to select — hover for details.</p>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((cap) => (
                <button
                  key={cap.label}
                  onClick={() => toggleCapability(cap.label)}
                  title={cap.tip}
                  className={`group px-3 py-1.5 rounded-full text-sm transition-all ${
                    form.capabilities.includes(cap.label)
                      ? 'bg-xpr-purple text-white shadow-md shadow-xpr-purple/20'
                      : 'bg-xpr-dark border border-xpr-border text-gray-400 hover:border-xpr-purple hover:text-gray-200'
                  }`}
                >
                  <span className="mr-1">{cap.emoji}</span>
                  {cap.label}
                </button>
              ))}
            </div>
          </div>

          {/* Anthropic API Key */}
          <div className="mb-5">
            <label className="label flex items-center">
              🔑 Anthropic API Key
              <Tooltip text="Powers your agent's AI brain (Claude). Your key is sent over HTTPS, stored encrypted, and never logged. Only your agent uses it." />
            </label>
            <input
              type="password"
              className="input"
              placeholder="sk-ant-api03-..."
              value={form.anthropicApiKey}
              onChange={(e) => setForm({ ...form, anthropicApiKey: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-1">
              🔒 Your key is encrypted and only used to power your agent.{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
                Get a key from Anthropic →
              </a>
            </p>
          </div>

          {/* Plan */}
          <div className="mb-6">
            <label className="label flex items-center">
              🏠 Hosting Plan
              <Tooltip text="Hosted = we run everything for you on Cloudflare's edge network. Self-Hosted = you provide your own Cloudflare account and deploy key." />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setForm({ ...form, plan: 'hosted' })}
                className={`card text-left cursor-pointer transition-all ${
                  form.plan === 'hosted' ? 'border-xpr-purple shadow-md shadow-xpr-purple/10' : 'hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  ☁️ Hosted
                  <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded-full">Recommended</span>
                </div>
                <div className="text-sm text-gray-400 mt-1">~15 XMD/month</div>
                <div className="text-xs text-gray-500 mt-1">We manage everything — zero DevOps</div>
              </button>
              <button
                onClick={() => setForm({ ...form, plan: 'selfhosted' })}
                className={`card text-left cursor-pointer transition-all ${
                  form.plan === 'selfhosted' ? 'border-xpr-purple shadow-md shadow-xpr-purple/10' : 'hover:border-gray-600'
                }`}
              >
                <div className="font-medium">🔧 Self-Hosted</div>
                <div className="text-sm text-gray-400 mt-1">Your Cloudflare</div>
                <div className="text-xs text-gray-500 mt-1">Bring your own CF account & token</div>
              </button>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('connect')} className="btn-secondary">
              ← Back
            </button>
            <button
              onClick={() => setStep('integrations')}
              disabled={!form.agentName || !form.displayName || !form.anthropicApiKey || nameAvailable === false}
              className="btn-primary"
            >
              Next: Integrations →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'integrations') {
    return (
      <div className="max-w-2xl mx-auto">
        <StepIndicator current={step} steps={WIZARD_STEPS} />
        <div className="card">
          <h2 className="text-2xl font-bold mb-1">🔌 Chat Integrations</h2>
          <p className="text-gray-400 text-sm mb-6">
            Connect your agent to messaging platforms so users can chat with it. <span className="text-gray-500">All integrations are optional — you can add them later from the dashboard.</span>
          </p>

          {/* Telegram */}
          <div className="mb-5 p-4 rounded-lg bg-xpr-dark/50 border border-xpr-border">
            <label className="label flex items-center text-base">
              <span className="text-xl mr-2">✈️</span>
              Telegram Bot Token
              <Tooltip text="A Telegram bot token lets your agent respond to messages in Telegram. You create a bot via @BotFather and paste the token here." />
            </label>
            <input
              type="password"
              className="input mb-2"
              placeholder="123456789:AAH-abc123def456..."
              value={form.telegramToken}
              onChange={(e) => setForm({ ...form, telegramToken: e.target.value })}
            />
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                <strong className="text-gray-400">How to get a token:</strong>
              </p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>
                  Open{' '}
                  <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
                    @BotFather
                  </a>{' '}
                  in Telegram
                </li>
                <li>Send <code className="bg-gray-800 px-1 rounded">/newbot</code> and follow the prompts</li>
                <li>Copy the token and paste it above</li>
              </ol>
            </div>
          </div>

          {/* Discord */}
          <div className="mb-5 p-4 rounded-lg bg-xpr-dark/50 border border-xpr-border">
            <label className="label flex items-center text-base">
              <span className="text-xl mr-2">🎮</span>
              Discord Bot Token
              <Tooltip text="A Discord bot token lets your agent respond to messages in Discord servers. Create a bot in the Discord Developer Portal." />
            </label>
            <input
              type="password"
              className="input mb-2"
              placeholder="MTE4NzYz..."
              value={form.discordToken}
              onChange={(e) => setForm({ ...form, discordToken: e.target.value })}
            />
            <div className="text-xs text-gray-500">
              <p>
                Create a bot at the{' '}
                <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
                  Discord Developer Portal →
                </a>
              </p>
              <p className="mt-0.5">Go to your app → Bot → Reset Token → Copy.</p>
            </div>
          </div>

          {/* Slack */}
          <div className="mb-6 p-4 rounded-lg bg-xpr-dark/50 border border-xpr-border">
            <label className="label flex items-center text-base">
              <span className="text-xl mr-2">💼</span>
              Slack Bot Token
              <Tooltip text="A Slack bot token lets your agent respond in Slack workspaces. Create a Slack app and install it to your workspace." />
            </label>
            <input
              type="password"
              className="input mb-2"
              placeholder="xoxb-..."
              value={form.slackToken}
              onChange={(e) => setForm({ ...form, slackToken: e.target.value })}
            />
            <div className="text-xs text-gray-500">
              <p>
                Create a Slack app at{' '}
                <a href="https://api.slack.com/apps" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
                  api.slack.com/apps →
                </a>
              </p>
              <p className="mt-0.5">Install to workspace → OAuth & Permissions → Copy Bot User OAuth Token.</p>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('configure')} className="btn-secondary">
              ← Back
            </button>
            <button onClick={() => setStep('review')} className="btn-primary">
              Next: Review →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="max-w-2xl mx-auto">
        <StepIndicator current={step} steps={WIZARD_STEPS} />
        <div className="card">
          <h2 className="text-2xl font-bold mb-1">✨ Review & Deploy</h2>
          <p className="text-gray-400 text-sm mb-6">Double-check everything before launching your agent.</p>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm flex items-start gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-0 mb-6 bg-xpr-dark rounded-lg overflow-hidden">
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">🏷️ Account</span>
              <span className="font-mono">{form.agentName}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">✨ Display Name</span>
              <span>{form.displayName}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">👤 Owner</span>
              <span className="font-mono">{session?.auth.actor}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">🏠 Plan</span>
              <span>{form.plan === 'hosted' ? '☁️ Hosted (~15 XMD/mo)' : '🔧 Self-Hosted'}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border items-start">
              <span className="text-gray-400">🧰 Capabilities</span>
              <span className="text-right max-w-[60%]">
                {form.capabilities.length > 0 ? (
                  <span className="flex flex-wrap gap-1 justify-end">
                    {form.capabilities.map((c) => {
                      const opt = CAPABILITY_OPTIONS.find((o) => o.label === c);
                      return (
                        <span key={c} className="text-xs bg-xpr-purple/20 text-xpr-purple px-2 py-0.5 rounded-full">
                          {opt?.emoji} {c}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span className="text-gray-500">None selected</span>
                )}
              </span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">🔑 Anthropic Key</span>
              <span className="text-green-400">{form.anthropicApiKey ? '✅ Set' : '❌ Not set'}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">✈️ Telegram</span>
              <span>{form.telegramToken ? '✅ Configured' : '⏭️ Skipped'}</span>
            </div>
            <div className="flex justify-between py-3 px-4 border-b border-xpr-border">
              <span className="text-gray-400">🎮 Discord</span>
              <span>{form.discordToken ? '✅ Configured' : '⏭️ Skipped'}</span>
            </div>
            <div className="flex justify-between py-3 px-4">
              <span className="text-gray-400">💼 Slack</span>
              <span>{form.slackToken ? '✅ Configured' : '⏭️ Skipped'}</span>
            </div>
          </div>

          <div className="bg-gradient-to-r from-xpr-purple/10 to-blue-900/10 border border-xpr-purple/20 rounded-lg p-4 mb-6 text-sm">
            <p className="font-medium text-white mb-3">🚀 What happens when you click Deploy:</p>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-400">
              <li>💳 Your wallet will prompt for payment (~15 XMD first month)</li>
              <li>🏷️ A dedicated XPR account is created for your agent</li>
              <li>📋 Agent registered on-chain with OpenClaw + 184 tools</li>
              <li>☁️ Deployed to Cloudflare's global edge network</li>
              <li>🔗 You can claim ownership via the agent registry</li>
            </ol>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('integrations')} className="btn-secondary">
              ← Back
            </button>
            <button onClick={handleDeploy} className="btn-primary text-lg px-6 py-2.5">
              🚀 Deploy Agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'deploying') {
    return (
      <div className="card max-w-lg mx-auto text-center">
        <div className="animate-spin w-12 h-12 border-4 border-xpr-purple border-t-transparent rounded-full mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">🤖 Deploying Your Agent...</h2>
        <p className="text-gray-400">{deployProgress}</p>
        <p className="text-xs text-gray-600 mt-4">This usually takes 30-60 seconds. Please don't close this page.</p>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="card max-w-lg mx-auto text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold mb-2">Agent Deployed!</h2>
        <p className="text-gray-400 mb-6">
          Your agent <span className="font-mono text-white bg-xpr-purple/20 px-2 py-0.5 rounded">{deployResult?.agentAccount}</span> is live and ready to go.
        </p>

        <div className="space-y-3 text-left mb-6">
          {deployResult?.endpoint && (
            <div className="bg-xpr-dark rounded-lg p-4">
              <div className="text-xs text-gray-400 mb-1">🌐 Agent Endpoint</div>
              <a href={deployResult.endpoint} target="_blank" rel="noopener" className="text-xpr-purple hover:underline font-mono text-sm break-all">
                {deployResult.endpoint}
              </a>
            </div>
          )}
          {deployResult?.claimPending && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3 text-sm text-yellow-300 flex items-start gap-2">
              <span>⏳</span>
              <span>Ownership claim is pending. Visit the agent registry to complete it.</span>
            </div>
          )}
          {deployResult?.dashboardToken && (
            <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-3 text-sm text-blue-300 flex items-start gap-2">
              <span>🔐</span>
              <span>Your dashboard access token has been saved to this browser. If you clear browser data, contact support to regenerate it.</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <a href="/dashboard" className="btn-primary text-lg px-6">
            📊 Go to Dashboard
          </a>
          <button onClick={() => { setStep('configure'); setDeployResult(null); }} className="btn-secondary">
            ➕ Deploy Another
          </button>
        </div>
      </div>
    );
  }

  return null;
}
