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

export async function checkNameAvailability(name: string): Promise<{ available: boolean; reason?: string }> {
  return apiFetch(`/api/check-name/${encodeURIComponent(name)}`);
}

export async function getPricing(): Promise<{ prices: Array<{ token_symbol: string; amount: number; display: string }> }> {
  return apiFetch('/api/pricing');
}

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

export async function deployAgent(req: DeployRequest) {
  return apiFetch('/api/deploy', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getAgentStatus(agent: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return apiFetch(`/api/status/${encodeURIComponent(agent)}`, { headers });
}

export async function getDeployments(owner: string) {
  return apiFetch(`/api/deployments?owner=${encodeURIComponent(owner)}`);
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
