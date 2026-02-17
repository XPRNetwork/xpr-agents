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

const CAPABILITY_OPTIONS = [
  'Code Generation',
  'Content Writing',
  'Data Analysis',
  'Image Generation',
  'DeFi Trading',
  'NFT Management',
  'Research',
  'Customer Support',
  'Social Media',
  'Smart Contracts',
];

export function DeployWizard() {
  const { session, login, transact } = useProton();
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
      setDeployProgress('Provisioning agent (this may take a minute)...');

      // In production, the backend would listen for the on-chain payment.
      // For MVP, we call the deploy API directly with an API key.
      const apiSecret = ''; // TODO: proper auth flow
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

      const result = await deployAgent(req, apiSecret);
      setDeployResult(result);
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
      <div className="card max-w-lg mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">Deploy Your AI Agent</h2>
        <p className="text-gray-400 mb-6">
          Connect your XPR Network wallet to get started. Your agent will be provisioned
          with a dedicated account, 184+ tools, and 13 built-in skills.
        </p>
        <button onClick={login} className="btn-primary text-lg px-8 py-3">
          Connect Wallet
        </button>
      </div>
    );
  }

  if (step === 'configure') {
    return (
      <div className="card max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Configure Your Agent</h2>

        {/* Agent Name */}
        <div className="mb-4">
          <label className="label">Agent Account Name</label>
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
              {nameChecking && <span className="text-gray-400">checking...</span>}
              {!nameChecking && nameAvailable === true && <span className="text-green-400">available</span>}
              {!nameChecking && nameAvailable === false && <span className="text-red-400">taken</span>}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">12 characters max. Letters a-z, numbers 1-5, periods.</p>
        </div>

        {/* Display Name */}
        <div className="mb-4">
          <label className="label">Display Name</label>
          <input
            type="text"
            className="input"
            placeholder="My Awesome Agent"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="label">Description</label>
          <textarea
            className="input min-h-[80px]"
            placeholder="What does your agent do?"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {/* Capabilities */}
        <div className="mb-4">
          <label className="label">Capabilities</label>
          <div className="flex flex-wrap gap-2">
            {CAPABILITY_OPTIONS.map((cap) => (
              <button
                key={cap}
                onClick={() => toggleCapability(cap)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  form.capabilities.includes(cap)
                    ? 'bg-xpr-purple text-white'
                    : 'bg-xpr-dark border border-xpr-border text-gray-400 hover:border-xpr-purple'
                }`}
              >
                {cap}
              </button>
            ))}
          </div>
        </div>

        {/* Anthropic API Key */}
        <div className="mb-4">
          <label className="label">Anthropic API Key</label>
          <input
            type="password"
            className="input"
            placeholder="sk-ant-..."
            value={form.anthropicApiKey}
            onChange={(e) => setForm({ ...form, anthropicApiKey: e.target.value })}
          />
          <p className="text-xs text-gray-500 mt-1">
            Your key is encrypted and only used to power your agent.{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
              Get a key
            </a>
          </p>
        </div>

        {/* Plan */}
        <div className="mb-6">
          <label className="label">Hosting Plan</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setForm({ ...form, plan: 'hosted' })}
              className={`card text-left cursor-pointer ${form.plan === 'hosted' ? 'border-xpr-purple' : ''}`}
            >
              <div className="font-medium">Hosted</div>
              <div className="text-sm text-gray-400">~15 XMD/month</div>
              <div className="text-xs text-gray-500 mt-1">We manage everything</div>
            </button>
            <button
              onClick={() => setForm({ ...form, plan: 'selfhosted' })}
              className={`card text-left cursor-pointer ${form.plan === 'selfhosted' ? 'border-xpr-purple' : ''}`}
            >
              <div className="font-medium">Self-Hosted</div>
              <div className="text-sm text-gray-400">Your Cloudflare</div>
              <div className="text-xs text-gray-500 mt-1">You provide CF token</div>
            </button>
          </div>
        </div>

        <div className="flex justify-between">
          <button onClick={() => setStep('connect')} className="btn-secondary">
            Back
          </button>
          <button
            onClick={() => setStep('integrations')}
            disabled={!form.agentName || !form.displayName || !form.anthropicApiKey || nameAvailable === false}
            className="btn-primary"
          >
            Next: Integrations
          </button>
        </div>
      </div>
    );
  }

  if (step === 'integrations') {
    return (
      <div className="card max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">Chat Integrations</h2>
        <p className="text-gray-400 mb-6">Optional: connect your agent to messaging platforms.</p>

        <div className="mb-4">
          <label className="label">Telegram Bot Token</label>
          <input
            type="password"
            className="input"
            placeholder="123456:ABC-..."
            value={form.telegramToken}
            onChange={(e) => setForm({ ...form, telegramToken: e.target.value })}
          />
          <p className="text-xs text-gray-500 mt-1">
            Create a bot via{' '}
            <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-xpr-purple hover:underline">
              @BotFather
            </a>
          </p>
        </div>

        <div className="mb-4">
          <label className="label">Discord Bot Token</label>
          <input
            type="password"
            className="input"
            placeholder="MTE..."
            value={form.discordToken}
            onChange={(e) => setForm({ ...form, discordToken: e.target.value })}
          />
        </div>

        <div className="mb-6">
          <label className="label">Slack Bot Token</label>
          <input
            type="password"
            className="input"
            placeholder="xoxb-..."
            value={form.slackToken}
            onChange={(e) => setForm({ ...form, slackToken: e.target.value })}
          />
        </div>

        <div className="flex justify-between">
          <button onClick={() => setStep('configure')} className="btn-secondary">
            Back
          </button>
          <button onClick={() => setStep('review')} className="btn-primary">
            Next: Review
          </button>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="card max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Review & Deploy</h2>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 mb-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3 mb-6">
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Account</span>
            <span className="font-mono">{form.agentName}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Display Name</span>
            <span>{form.displayName}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Owner</span>
            <span className="font-mono">{session?.auth.actor}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Plan</span>
            <span>{form.plan === 'hosted' ? 'Hosted (~15 XMD/mo)' : 'Self-Hosted'}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Capabilities</span>
            <span>{form.capabilities.join(', ') || 'None selected'}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Anthropic Key</span>
            <span>{form.anthropicApiKey ? 'sk-ant-***' : 'Not set'}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Telegram</span>
            <span>{form.telegramToken ? 'Configured' : 'Not set'}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-xpr-border">
            <span className="text-gray-400">Discord</span>
            <span>{form.discordToken ? 'Configured' : 'Not set'}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-400">Slack</span>
            <span>{form.slackToken ? 'Configured' : 'Not set'}</span>
          </div>
        </div>

        <div className="bg-xpr-dark rounded-lg p-4 mb-6 text-sm text-gray-400">
          <p className="font-medium text-white mb-2">What happens next:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Your wallet will prompt for payment (~15 XMD first month)</li>
            <li>A dedicated XPR account will be created for your agent</li>
            <li>Agent registered on-chain with OpenClaw + 184 tools</li>
            <li>Deployed to Cloudflare edge network</li>
            <li>You can claim ownership via the agent registry</li>
          </ol>
        </div>

        <div className="flex justify-between">
          <button onClick={() => setStep('integrations')} className="btn-secondary">
            Back
          </button>
          <button onClick={handleDeploy} className="btn-primary">
            Deploy Agent
          </button>
        </div>
      </div>
    );
  }

  if (step === 'deploying') {
    return (
      <div className="card max-w-lg mx-auto text-center">
        <div className="animate-spin w-12 h-12 border-4 border-xpr-purple border-t-transparent rounded-full mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Deploying Your Agent</h2>
        <p className="text-gray-400">{deployProgress}</p>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="card max-w-lg mx-auto text-center">
        <div className="text-green-400 text-5xl mb-4">&#10003;</div>
        <h2 className="text-2xl font-bold mb-2">Agent Deployed!</h2>
        <p className="text-gray-400 mb-6">
          Your agent <span className="font-mono text-white">{deployResult?.agentAccount}</span> is live.
        </p>

        <div className="space-y-3 text-left mb-6">
          {deployResult?.endpoint && (
            <div className="flex justify-between py-2 border-b border-xpr-border">
              <span className="text-gray-400">Endpoint</span>
              <a href={deployResult.endpoint} target="_blank" rel="noopener" className="text-xpr-purple hover:underline font-mono text-sm">
                {deployResult.endpoint}
              </a>
            </div>
          )}
          {deployResult?.claimPending && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3 text-sm text-yellow-300">
              Claim is pending. Visit the agent registry to complete ownership claim.
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <a href="/dashboard" className="btn-primary">
            Go to Dashboard
          </a>
          <button onClick={() => { setStep('configure'); setDeployResult(null); }} className="btn-secondary">
            Deploy Another
          </button>
        </div>
      </div>
    );
  }

  return null;
}
