import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginApi, PluginConfig, ToolDefinition } from '../src/types';
import { registerAgentTools } from '../src/tools/agent';
import { registerFeedbackTools } from '../src/tools/feedback';
import { registerValidationTools } from '../src/tools/validation';
import { registerEscrowTools } from '../src/tools/escrow';
import { registerIndexerTools } from '../src/tools/indexer';

// Mock PluginApi that collects registered tools
function createMockApi(): PluginApi & { tools: Map<string, ToolDefinition> } {
  const tools = new Map<string, ToolDefinition>();
  return {
    tools,
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    getConfig() {
      return {};
    },
  };
}

// Mock RPC that returns empty results
function createMockRpc() {
  return {
    get_table_rows: vi.fn().mockResolvedValue({ rows: [], more: false }),
  };
}

function createConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    rpc: createMockRpc() as any,
    session: {
      auth: { actor: 'testagent', permission: 'active' },
      link: { transact: vi.fn().mockResolvedValue({ transaction_id: 'abc123', processed: { block_num: 1, block_time: '2024-01-01' } }) },
    },
    network: 'testnet',
    rpcEndpoint: 'https://tn1.protonnz.com',
    indexerUrl: 'http://localhost:3001',
    contracts: {
      agentcore: 'agentcore',
      agentfeed: 'agentfeed',
      agentvalid: 'agentvalid',
      agentescrow: 'agentescrow',
    },
    confirmHighRisk: false,
    maxTransferAmount: 100000000,
    ...overrides,
  };
}

describe('Tool Registration', () => {
  it('registers 10 agent tools', () => {
    const api = createMockApi();
    registerAgentTools(api, createConfig());
    expect(api.tools.size).toBe(10);
    expect(api.tools.has('xpr_get_agent')).toBe(true);
    expect(api.tools.has('xpr_list_agents')).toBe(true);
    expect(api.tools.has('xpr_get_trust_score')).toBe(true);
    expect(api.tools.has('xpr_get_agent_plugins')).toBe(true);
    expect(api.tools.has('xpr_list_plugins')).toBe(true);
    expect(api.tools.has('xpr_get_core_config')).toBe(true);
    expect(api.tools.has('xpr_register_agent')).toBe(true);
    expect(api.tools.has('xpr_update_agent')).toBe(true);
    expect(api.tools.has('xpr_set_agent_status')).toBe(true);
    expect(api.tools.has('xpr_manage_plugin')).toBe(true);
  });

  it('registers 7 feedback tools', () => {
    const api = createMockApi();
    registerFeedbackTools(api, createConfig());
    expect(api.tools.size).toBe(7);
    expect(api.tools.has('xpr_get_feedback')).toBe(true);
    expect(api.tools.has('xpr_list_agent_feedback')).toBe(true);
    expect(api.tools.has('xpr_get_agent_score')).toBe(true);
    expect(api.tools.has('xpr_get_feedback_config')).toBe(true);
    expect(api.tools.has('xpr_submit_feedback')).toBe(true);
    expect(api.tools.has('xpr_dispute_feedback')).toBe(true);
    expect(api.tools.has('xpr_recalculate_score')).toBe(true);
  });

  it('registers 9 validation tools', () => {
    const api = createMockApi();
    registerValidationTools(api, createConfig());
    expect(api.tools.size).toBe(9);
    expect(api.tools.has('xpr_get_validator')).toBe(true);
    expect(api.tools.has('xpr_list_validators')).toBe(true);
    expect(api.tools.has('xpr_get_validation')).toBe(true);
    expect(api.tools.has('xpr_list_agent_validations')).toBe(true);
    expect(api.tools.has('xpr_get_challenge')).toBe(true);
    expect(api.tools.has('xpr_register_validator')).toBe(true);
    expect(api.tools.has('xpr_submit_validation')).toBe(true);
    expect(api.tools.has('xpr_challenge_validation')).toBe(true);
    expect(api.tools.has('xpr_stake_validator')).toBe(true);
  });

  it('registers 13 escrow tools', () => {
    const api = createMockApi();
    registerEscrowTools(api, createConfig());
    expect(api.tools.size).toBe(13);
    expect(api.tools.has('xpr_get_job')).toBe(true);
    expect(api.tools.has('xpr_list_jobs')).toBe(true);
    expect(api.tools.has('xpr_get_milestones')).toBe(true);
    expect(api.tools.has('xpr_get_job_dispute')).toBe(true);
    expect(api.tools.has('xpr_list_arbitrators')).toBe(true);
    expect(api.tools.has('xpr_create_job')).toBe(true);
    expect(api.tools.has('xpr_fund_job')).toBe(true);
    expect(api.tools.has('xpr_accept_job')).toBe(true);
    expect(api.tools.has('xpr_deliver_job')).toBe(true);
    expect(api.tools.has('xpr_approve_delivery')).toBe(true);
    expect(api.tools.has('xpr_raise_dispute')).toBe(true);
    expect(api.tools.has('xpr_submit_milestone')).toBe(true);
    expect(api.tools.has('xpr_arbitrate')).toBe(true);
  });

  it('registers 4 indexer tools', () => {
    const api = createMockApi();
    registerIndexerTools(api, createConfig());
    expect(api.tools.size).toBe(4);
    expect(api.tools.has('xpr_search_agents')).toBe(true);
    expect(api.tools.has('xpr_get_events')).toBe(true);
    expect(api.tools.has('xpr_get_stats')).toBe(true);
    expect(api.tools.has('xpr_indexer_health')).toBe(true);
  });

  it('registers 43 total tools', () => {
    const api = createMockApi();
    const config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
    registerIndexerTools(api, config);
    expect(api.tools.size).toBe(43);
  });
});

describe('Input Validation', () => {
  let api: ReturnType<typeof createMockApi>;
  let config: PluginConfig;

  beforeEach(() => {
    api = createMockApi();
    config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
  });

  it('rejects invalid account names', async () => {
    const tool = api.tools.get('xpr_get_agent')!;
    await expect(tool.handler({ account: '' })).rejects.toThrow('account is required');
    await expect(tool.handler({ account: 'INVALID' })).rejects.toThrow('must contain only a-z');
    await expect(tool.handler({ account: 'toolongaccount1' })).rejects.toThrow('12 characters');
  });

  it('rejects invalid feedback scores', async () => {
    const tool = api.tools.get('xpr_submit_feedback')!;
    await expect(tool.handler({ agent: 'alice', score: 0 })).rejects.toThrow('between 1 and 5');
    await expect(tool.handler({ agent: 'alice', score: 6 })).rejects.toThrow('between 1 and 5');
    await expect(tool.handler({ agent: 'alice', score: 1.5 })).rejects.toThrow('integer');
  });

  it('rejects invalid validation results', async () => {
    const tool = api.tools.get('xpr_submit_validation')!;
    await expect(
      tool.handler({ agent: 'alice', job_hash: 'abc', result: 'invalid', confidence: 50 })
    ).rejects.toThrow("'fail', 'pass', or 'partial'");
  });

  it('rejects invalid confidence values', async () => {
    const tool = api.tools.get('xpr_submit_validation')!;
    await expect(
      tool.handler({ agent: 'alice', job_hash: 'abc', result: 'pass', confidence: 101 })
    ).rejects.toThrow('between 0 and 100');
  });

  it('rejects invalid client_percent for arbitration', async () => {
    const tool = api.tools.get('xpr_arbitrate')!;
    await expect(
      tool.handler({ dispute_id: 1, client_percent: -1, resolution_notes: 'test' })
    ).rejects.toThrow('between 0 and 100');
    await expect(
      tool.handler({ dispute_id: 1, client_percent: 101, resolution_notes: 'test' })
    ).rejects.toThrow('between 0 and 100');
  });
});

describe('Confirmation Gate', () => {
  it('returns confirmation prompt when confirmHighRisk is true', async () => {
    const api = createMockApi();
    const config = createConfig({ confirmHighRisk: true });
    registerAgentTools(api, config);

    const tool = api.tools.get('xpr_register_agent')!;
    const result = await tool.handler({
      name: 'Test Agent',
      description: 'A test agent',
      endpoint: 'https://example.com',
      protocol: 'rest',
      capabilities: ['test'],
    });

    expect(result).toHaveProperty('needs_confirmation', true);
    expect(result).toHaveProperty('action', 'Register Agent');
  });

  it('executes directly when confirmHighRisk is false', async () => {
    const api = createMockApi();
    const config = createConfig({ confirmHighRisk: false });
    registerAgentTools(api, config);

    const tool = api.tools.get('xpr_register_agent')!;
    // This will call through to the SDK which uses our mock RPC
    // It should NOT return a confirmation object
    const result = await tool.handler({
      name: 'Test Agent',
      description: 'A test agent',
      endpoint: 'https://example.com',
      protocol: 'https',
      capabilities: ['test'],
    });

    // Should be a transaction result or throw, not a confirmation
    expect(result).not.toHaveProperty('needs_confirmation');
  });

  it('applies confirmation to high-risk escrow tools', async () => {
    const api = createMockApi();
    const config = createConfig({ confirmHighRisk: true });
    registerEscrowTools(api, config);

    const fundTool = api.tools.get('xpr_fund_job')!;
    const result = await fundTool.handler({ job_id: 1, amount: 1000 });
    expect(result).toHaveProperty('needs_confirmation', true);
    expect(result).toHaveProperty('action', 'Fund Job');
  });
});

describe('Tool Descriptions', () => {
  it('all tools have non-empty descriptions', () => {
    const api = createMockApi();
    const config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
    registerIndexerTools(api, config);

    for (const [name, tool] of api.tools) {
      expect(tool.description.length, `${name} should have a description`).toBeGreaterThan(10);
    }
  });

  it('all tools have valid parameter schemas', () => {
    const api = createMockApi();
    const config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
    registerIndexerTools(api, config);

    for (const [name, tool] of api.tools) {
      expect(tool.parameters.type, `${name} parameters should be object type`).toBe('object');
      expect(typeof tool.parameters.properties, `${name} should have properties`).toBe('object');
    }
  });

  it('all tools follow xpr_ naming convention', () => {
    const api = createMockApi();
    const config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
    registerIndexerTools(api, config);

    for (const name of api.tools.keys()) {
      expect(name.startsWith('xpr_'), `${name} should start with xpr_`).toBe(true);
    }
  });
});
