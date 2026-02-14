import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginApi, PluginConfig, ToolDefinition } from '../src/types';
import { registerAgentTools } from '../src/tools/agent';
import { registerFeedbackTools } from '../src/tools/feedback';
import { registerValidationTools } from '../src/tools/validation';
import { registerEscrowTools } from '../src/tools/escrow';
import { registerIndexerTools } from '../src/tools/indexer';
import { registerA2ATools } from '../src/tools/a2a';
import { resetTransferTracking } from '../src/util/validate';

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
  it('registers 11 agent tools', () => {
    const api = createMockApi();
    registerAgentTools(api, createConfig());
    expect(api.tools.size).toBe(11);
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
    expect(api.tools.has('xpr_approve_claim')).toBe(true);
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

  it('registers 21 escrow tools', () => {
    const api = createMockApi();
    registerEscrowTools(api, createConfig());
    expect(api.tools.size).toBe(21);
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
    expect(api.tools.has('xpr_start_job')).toBe(true);
    expect(api.tools.has('xpr_deliver_job_nft')).toBe(true);
    expect(api.tools.has('xpr_resolve_timeout')).toBe(true);
    // Bidding tools
    expect(api.tools.has('xpr_list_open_jobs')).toBe(true);
    expect(api.tools.has('xpr_list_bids')).toBe(true);
    expect(api.tools.has('xpr_submit_bid')).toBe(true);
    expect(api.tools.has('xpr_select_bid')).toBe(true);
    expect(api.tools.has('xpr_withdraw_bid')).toBe(true);
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

  it('registers 5 A2A tools', () => {
    const api = createMockApi();
    registerA2ATools(api, createConfig());
    expect(api.tools.size).toBe(5);
    expect(api.tools.has('xpr_a2a_discover')).toBe(true);
    expect(api.tools.has('xpr_a2a_send_message')).toBe(true);
    expect(api.tools.has('xpr_a2a_get_task')).toBe(true);
    expect(api.tools.has('xpr_a2a_cancel_task')).toBe(true);
    expect(api.tools.has('xpr_a2a_delegate_job')).toBe(true);
  });

  it('registers 57 total tools', () => {
    const api = createMockApi();
    const config = createConfig();
    registerAgentTools(api, config);
    registerFeedbackTools(api, config);
    registerValidationTools(api, config);
    registerEscrowTools(api, config);
    registerIndexerTools(api, config);
    registerA2ATools(api, config);
    expect(api.tools.size).toBe(57);
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
      protocol: 'https',
      capabilities: ['test'],
    });

    expect(result).toHaveProperty('needs_confirmation', true);
    expect(result).toHaveProperty('action', 'Register Agent');
  });

  it('executes when confirmed is true even with confirmHighRisk', async () => {
    const api = createMockApi();
    const config = createConfig({ confirmHighRisk: true });
    registerAgentTools(api, config);

    const tool = api.tools.get('xpr_register_agent')!;
    const result = await tool.handler({
      name: 'Test Agent',
      description: 'A test agent',
      endpoint: 'https://example.com',
      protocol: 'https',
      capabilities: ['test'],
      confirmed: true,
    });

    // Should bypass confirmation and execute
    expect(result).not.toHaveProperty('needs_confirmation');
  });

  it('executes directly when confirmHighRisk is false', async () => {
    const api = createMockApi();
    const config = createConfig({ confirmHighRisk: false });
    registerAgentTools(api, config);

    const tool = api.tools.get('xpr_register_agent')!;
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

    // Verify second-step confirmed=true bypasses the gate
    const result2 = await fundTool.handler({ job_id: 1, amount: 1000, confirmed: true });
    expect(result2).not.toHaveProperty('needs_confirmation');
  });
});

describe('maxTransferAmount Enforcement', () => {
  let api: ReturnType<typeof createMockApi>;

  // Config with low maxTransferAmount: 10 XPR = 100000 smallest units
  const lowMaxConfig = () => createConfig({ maxTransferAmount: 100000 });

  beforeEach(() => {
    api = createMockApi();
    resetTransferTracking(); // Reset aggregate transfer tracking between tests
  });

  it('rejects xpr_register_agent fee exceeding maxTransferAmount', async () => {
    registerAgentTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_register_agent')!;
    await expect(
      tool.handler({
        name: 'Test',
        description: 'test',
        endpoint: 'https://example.com',
        protocol: 'https',
        capabilities: ['test'],
        fee_amount: 20, // 20 XPR > 10 XPR max
        confirmed: true,
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('rejects xpr_submit_feedback fee exceeding maxTransferAmount', async () => {
    registerFeedbackTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_submit_feedback')!;
    await expect(
      tool.handler({
        agent: 'alice',
        score: 4,
        fee_amount: 20, // 20 XPR > 10 XPR max
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('rejects xpr_stake_validator exceeding maxTransferAmount', async () => {
    registerValidationTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_stake_validator')!;
    await expect(
      tool.handler({
        amount: 20, // 20 XPR > 10 XPR max
        confirmed: true,
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('rejects xpr_create_job amount exceeding maxTransferAmount', async () => {
    registerEscrowTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_create_job')!;
    await expect(
      tool.handler({
        agent: 'alice',
        title: 'Test Job',
        description: 'A test job',
        deliverables: 'deliverables',
        amount: 20, // 20 XPR > 10 XPR max
        confirmed: true,
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('rejects xpr_fund_job amount exceeding maxTransferAmount', async () => {
    registerEscrowTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_fund_job')!;
    await expect(
      tool.handler({
        job_id: 1,
        amount: 20, // 20 XPR > 10 XPR max
        confirmed: true,
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('rejects xpr_submit_bid amount exceeding maxTransferAmount', async () => {
    registerEscrowTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_submit_bid')!;
    await expect(
      tool.handler({
        job_id: 1,
        amount: 20, // 20 XPR > 10 XPR max
        timeline: 604800,
        proposal: 'I can do this',
        confirmed: true,
      })
    ).rejects.toThrow('exceeds maximum');
  });

  it('allows amounts within maxTransferAmount', async () => {
    registerAgentTools(api, lowMaxConfig());
    const tool = api.tools.get('xpr_register_agent')!;
    // 5 XPR is within the 10 XPR max
    const result = await tool.handler({
      name: 'Test',
      description: 'test',
      endpoint: 'https://example.com',
      protocol: 'https',
      capabilities: ['test'],
      fee_amount: 5,
      confirmed: true,
    });
    // Should not throw, should return transaction result
    expect(result).not.toHaveProperty('needs_confirmation');
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
    registerA2ATools(api, config);

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
    registerA2ATools(api, config);

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
    registerA2ATools(api, config);

    for (const name of api.tools.keys()) {
      expect(name.startsWith('xpr_'), `${name} should start with xpr_`).toBe(true);
    }
  });
});
