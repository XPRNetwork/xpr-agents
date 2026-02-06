/**
 * Indexer query tools (4 tools)
 * All read-only. Query the XPR Agents indexer REST API.
 *
 * xpr_search_agents, xpr_get_events, xpr_get_stats, xpr_indexer_health
 */

import type { PluginApi, PluginConfig } from '../types';

async function fetchIndexer(indexerUrl: string, path: string): Promise<unknown> {
  const url = `${indexerUrl.replace(/\/$/, '')}/api${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Indexer request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchHealth(indexerUrl: string): Promise<unknown> {
  const url = `${indexerUrl.replace(/\/$/, '')}/health`;
  const response = await fetch(url);
  return {
    status: response.status,
    ...(await response.json() as Record<string, unknown>),
  };
}

export function registerIndexerTools(api: PluginApi, config: PluginConfig): void {
  const indexerUrl = config.indexerUrl;

  api.registerTool({
    name: 'xpr_search_agents',
    description: 'Full-text search across agents by account name, display name, or description via the indexer.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query string' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
    handler: async ({ query, limit = 20 }: { query: string; limit?: number }) => {
      if (!query || typeof query !== 'string') {
        throw new Error('query is required');
      }
      const params = new URLSearchParams({
        q: query,
        limit: String(Math.min(limit, 50)),
      });
      return fetchIndexer(indexerUrl, `/search?${params}`);
    },
  });

  api.registerTool({
    name: 'xpr_get_events',
    description: 'Get recent blockchain events from the indexer. Filter by contract and/or action.',
    parameters: {
      type: 'object',
      properties: {
        contract: {
          type: 'string',
          enum: ['agentcore', 'agentfeed', 'agentvalid', 'agentescrow'],
          description: 'Filter events by contract',
        },
        action: { type: 'string', description: 'Filter events by action name' },
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
      },
    },
    handler: async ({ contract, action, limit = 50 }: {
      contract?: string;
      action?: string;
      limit?: number;
    }) => {
      const params = new URLSearchParams();
      if (contract) params.set('contract', contract);
      if (action) params.set('action', action);
      params.set('limit', String(Math.min(limit, 200)));
      return fetchIndexer(indexerUrl, `/events?${params}`);
    },
  });

  api.registerTool({
    name: 'xpr_get_stats',
    description: 'Get global registry statistics: total agents, active agents, validators, feedback, jobs, etc.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      return fetchIndexer(indexerUrl, '/stats');
    },
  });

  api.registerTool({
    name: 'xpr_indexer_health',
    description: 'Check the health and connection status of the XPR Agents indexer.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        return await fetchHealth(indexerUrl);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'unreachable', error: message, indexerUrl };
      }
    },
  });
}
