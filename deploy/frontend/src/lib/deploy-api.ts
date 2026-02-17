const API_BASE = process.env.NEXT_PUBLIC_DEPLOY_API || 'http://localhost:3500';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `API error: ${res.status}`);
  }

  return data;
}

// --- Public endpoints (no auth) ---

export async function checkNameAvailability(name: string): Promise<{ available: boolean; reason?: string }> {
  return apiFetch(`/api/check-name/${encodeURIComponent(name)}`);
}

export async function getPricing(): Promise<{ prices: Array<{ token_symbol: string; amount: number; display: string }> }> {
  return apiFetch('/api/pricing');
}

// --- Wallet auth ---

export async function loginWithProof(proof: {
  account: string;
  chainId: string;
  serializedTransaction: string;
  signatures: string[];
}): Promise<{ token: string; account: string; expiresAt: number }> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ proof }),
  });
}

// --- Wallet-authenticated endpoints ---

export interface DeployRequest {
  owner: string;
  agentName: string;
  displayName: string;
  description: string;
  capabilities: string;
  plan: 'hosted' | 'selfhosted';
  anthropicApiKey: string;
  telegramToken?: string;
  discordToken?: string;
  slackToken?: string;
}

export async function deployAgent(req: DeployRequest, jwtToken: string) {
  return apiFetch('/api/deploy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwtToken}` },
    body: JSON.stringify(req),
  });
}

export async function getDeployments(jwtToken: string) {
  return apiFetch('/api/deployments', {
    headers: { Authorization: `Bearer ${jwtToken}` },
  });
}

// --- Dashboard-token-authenticated endpoints ---

export async function getAgentStatus(agent: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return apiFetch(`/api/status/${encodeURIComponent(agent)}`, { headers });
}

export async function chatWithAgent(agent: string, message: string, token: string) {
  return apiFetch(`/api/chat/${encodeURIComponent(agent)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
}

export async function updateAgentConfig(agent: string, config: Record<string, string>, token: string) {
  return apiFetch(`/api/config/${encodeURIComponent(agent)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(config),
  });
}

export async function getAgentLogs(agent: string, token: string) {
  return apiFetch(`/api/logs/${encodeURIComponent(agent)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// --- On-chain subscription check (direct RPC read) ---

export async function checkOnChainSubscription(agentName: string): Promise<{
  exists: boolean;
  active: boolean;
  paid_until?: number;
  owner?: string;
}> {
  const { getNetworkConfig } = await import('@/lib/networks');
  const config = getNetworkConfig();
  const deployContract = process.env.NEXT_PUBLIC_DEPLOY_CONTRACT || 'agentdeploy';

  const res = await fetch(`${config.rpc}/v1/chain/get_table_rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: true,
      code: deployContract,
      scope: deployContract,
      table: 'subs',
      lower_bound: agentName,
      upper_bound: agentName,
      limit: 1,
    }),
  });

  const data = await res.json();
  const row = data.rows?.[0];

  if (!row || row.agent !== agentName) {
    return { exists: false, active: false };
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    exists: true,
    active: row.state === 0 && row.paid_until > now,
    paid_until: row.paid_until,
    owner: row.owner,
  };
}
