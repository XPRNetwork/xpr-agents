import {
  Agent,
  AgentRaw,
  Plugin,
  PluginRaw,
  AgentPlugin,
  AgentPluginRaw,
  AgentCoreConfig,
  AgentListOptions,
  RegisterAgentData,
  UpdateAgentData,
  TransactionResult,
  JsonRpc,
  ProtonSession,
  PluginCategory,
  PaginatedResult,
  TrustScore,
  AgentScore,
} from './types';
import { parseCapabilities, safeJsonParse, formatXpr, calculateTrustScore } from './utils';

const DEFAULT_CONTRACT = 'agentcore';

// Valid protocols for agent endpoints
const VALID_PROTOCOLS = ['http', 'https', 'grpc', 'websocket', 'mqtt', 'wss'] as const;

// Valid endpoint URL prefixes
const VALID_ENDPOINT_PREFIXES = ['http://', 'https://', 'grpc://', 'wss://'];

/**
 * Validates agent registration/update data before sending to the blockchain.
 * Throws descriptive errors for invalid input.
 *
 * CRITICAL FIX: Validates TRIMMED length to prevent whitespace padding bypass.
 */
function validateAgentData(data: {
  name?: string;
  description?: string;
  endpoint?: string;
  protocol?: string;
  capabilities?: string[];
}): void {
  // Validate name: 1-64 characters after trimming, non-empty
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      throw new Error('Name must be a string');
    }
    const trimmedName = data.name.trim();
    // CRITICAL FIX: Check trimmed length to prevent whitespace padding bypass
    if (trimmedName.length < 1 || trimmedName.length > 64) {
      throw new Error('Name must be 1-64 characters (after trimming whitespace)');
    }
  }

  // Validate description: 1-256 characters after trimming, non-empty
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      throw new Error('Description must be a string');
    }
    const trimmedDesc = data.description.trim();
    // CRITICAL FIX: Check trimmed length to prevent whitespace padding bypass
    if (trimmedDesc.length < 1 || trimmedDesc.length > 256) {
      throw new Error('Description must be 1-256 characters (after trimming whitespace)');
    }
  }

  // Validate endpoint: 1-256 characters after trimming, must start with valid protocol prefix
  if (data.endpoint !== undefined) {
    if (typeof data.endpoint !== 'string') {
      throw new Error('Endpoint must be a string');
    }
    const trimmedEndpoint = data.endpoint.trim();
    // CRITICAL FIX: Check trimmed length to prevent whitespace padding bypass
    if (trimmedEndpoint.length < 1 || trimmedEndpoint.length > 256) {
      throw new Error('Endpoint must be 1-256 characters and start with http://, https://, grpc://, or wss://');
    }
    const hasValidPrefix = VALID_ENDPOINT_PREFIXES.some(prefix =>
      trimmedEndpoint.toLowerCase().startsWith(prefix)
    );
    if (!hasValidPrefix) {
      throw new Error('Endpoint must be 1-256 characters and start with http://, https://, grpc://, or wss://');
    }
  }

  // Validate protocol: must be one of the valid protocols (case-insensitive)
  if (data.protocol !== undefined) {
    const normalizedProtocol = data.protocol.toLowerCase();
    if (!VALID_PROTOCOLS.includes(normalizedProtocol as typeof VALID_PROTOCOLS[number])) {
      throw new Error(`Protocol must be one of: ${VALID_PROTOCOLS.join(', ')}`);
    }
  }

  // Validate capabilities: array, when stringified must be <= 2048 characters
  if (data.capabilities !== undefined) {
    if (!Array.isArray(data.capabilities)) {
      throw new Error('Capabilities must be an array with stringified length <= 2048 characters');
    }
    const stringified = JSON.stringify(data.capabilities);
    if (stringified.length > 2048) {
      throw new Error('Capabilities must be an array with stringified length <= 2048 characters');
    }
  }
}

export class AgentRegistry {
  private rpc: JsonRpc;
  private session: ProtonSession | null;
  private contract: string;

  constructor(rpc: JsonRpc, session?: ProtonSession, contract?: string) {
    this.rpc = rpc;
    this.session = session || null;
    this.contract = contract || DEFAULT_CONTRACT;
  }

  // ============== READ OPERATIONS ==============

  /**
   * Get a single agent by account name
   */
  async getAgent(account: string): Promise<Agent | null> {
    const result = await this.rpc.get_table_rows<AgentRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agents',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parseAgent(result.rows[0]);
  }

  /**
   * List all agents with optional filters and pagination
   * @returns PaginatedResult with items, hasMore flag, and nextCursor for pagination
   */
  async listAgents(options: AgentListOptions = {}): Promise<PaginatedResult<Agent>> {
    const { limit = 100, cursor, active_only = true } = options;

    const result = await this.rpc.get_table_rows<AgentRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agents',
      lower_bound: cursor,
      limit: limit + 1, // Fetch one extra to check if there are more
    });

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    let agents = rows.map((row) => this.parseAgent(row));

    // Apply filters after fetching
    if (active_only) {
      agents = agents.filter((a) => a.active);
    }

    // Note: Agents use system staking (eosio::voters), not contract-managed staking
    // To filter by stake, query system staking separately

    // Get next cursor from the last row if there are more
    const nextCursor = hasMore && rows.length > 0
      ? rows[rows.length - 1].account
      : undefined;

    return {
      items: agents,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Iterate through all agents with automatic pagination
   */
  async *listAgentsIterator(options: Omit<AgentListOptions, 'cursor'> = {}): AsyncGenerator<Agent> {
    let cursor: string | undefined;

    do {
      const result = await this.listAgents({ ...options, cursor });
      for (const agent of result.items) {
        yield agent;
      }
      cursor = result.nextCursor;
    } while (cursor);
  }

  /**
   * Get a plugin by ID
   */
  async getPlugin(id: number): Promise<Plugin | null> {
    const result = await this.rpc.get_table_rows<PluginRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'plugins',
      lower_bound: String(id),
      upper_bound: String(id),
      limit: 1,
    });

    if (result.rows.length === 0) return null;
    return this.parsePlugin(result.rows[0]);
  }

  /**
   * List all plugins
   */
  async listPlugins(category?: PluginCategory): Promise<Plugin[]> {
    const result = await this.rpc.get_table_rows<PluginRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'plugins',
      limit: 1000,
    });

    let plugins = result.rows.map((row) => this.parsePlugin(row));

    if (category) {
      plugins = plugins.filter((p) => p.category === category);
    }

    return plugins;
  }

  /**
   * Get plugins assigned to an agent
   */
  async getAgentPlugins(account: string): Promise<AgentPlugin[]> {
    const result = await this.rpc.get_table_rows<AgentPluginRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agentplugs',
      index_position: 2,
      key_type: 'name',
      lower_bound: account,
      upper_bound: account,
      limit: 100,
    });

    return result.rows.map((row) => this.parseAgentPlugin(row));
  }

  // Note: Agents use system staking via eosio::voters table, not contract-managed staking
  // There is no unstakes table in agentcore - agents stake/unstake via system resources
  // Use agentcore::getagentinfo action to query an agent's system stake

  /**
   * Get trust score for an agent (0-100)
   * Combines KYC level, stake, reputation, and longevity
   */
  async getTrustScore(account: string): Promise<TrustScore | null> {
    // Get agent
    const agent = await this.getAgent(account);
    if (!agent) return null;

    // Get agent score from agentfeed
    const feedContract = 'agentfeed'; // Default feed contract
    const scoreResult = await this.rpc.get_table_rows<{
      agent: string;
      total_score: string;
      total_weight: string;
      feedback_count: string;
      avg_score: string;
      last_updated: string;
    }>({
      json: true,
      code: feedContract,
      scope: feedContract,
      table: 'agentscores',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });

    const agentScore: AgentScore | null = scoreResult.rows.length > 0
      ? {
          agent: scoreResult.rows[0].agent,
          total_score: parseInt(scoreResult.rows[0].total_score),
          total_weight: parseInt(scoreResult.rows[0].total_weight),
          feedback_count: parseInt(scoreResult.rows[0].feedback_count),
          avg_score: parseInt(scoreResult.rows[0].avg_score || '0'),
          last_updated: parseInt(scoreResult.rows[0].last_updated),
        }
      : null;

    // Get KYC level from the OWNER (not the agent)
    // This is the key insight: agents inherit trust from their human sponsor
    let kycLevel = 0;
    if (agent.owner) {
      const kycResult = await this.rpc.get_table_rows<{
        acc: string;
        kyc: Array<{ kyc_level: number | string; kyc_provider?: string }>;
      }>({
        json: true,
        code: 'eosio.proton',
        scope: 'eosio.proton',
        table: 'usersinfo',
        lower_bound: agent.owner,
        upper_bound: agent.owner,
        limit: 1,
      });

      if (kycResult.rows.length > 0 && kycResult.rows[0].kyc?.length > 0) {
        // Find the highest KYC level, handling various formats:
        // - number: 3
        // - string number: "3"
        // - provider:level: "metallicus:3"
        // - comma-separated multi-provider: "provA:3,provB:1"
        const levels: number[] = [];

        for (const k of kycResult.rows[0].kyc) {
          if (typeof k.kyc_level === 'number') {
            levels.push(k.kyc_level);
          } else {
            const levelStr = String(k.kyc_level);
            // Handle comma-separated multi-provider strings (e.g., "provA:3,provB:1")
            const providers = levelStr.split(',');
            for (const provider of providers) {
              const trimmed = provider.trim();
              if (trimmed.includes(':')) {
                // "provider:level" format - take the level part
                const parts = trimmed.split(':');
                const level = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(level)) levels.push(level);
              } else {
                // Plain number string
                const level = parseInt(trimmed, 10);
                if (!isNaN(level)) levels.push(level);
              }
            }
          }
        }

        // P2 FIX: Safe max - fallback to 0 if no valid levels found
        // Math.max(...[]) returns -Infinity, which would poison trust scores
        kycLevel = levels.length > 0 ? Math.max(...levels) : 0;
      }
    }

    // Get system stake from eosio::voters
    const votersResult = await this.rpc.get_table_rows<{
      owner: string;
      staked: string;
    }>({
      json: true,
      code: 'eosio',
      scope: 'eosio',
      table: 'voters',
      lower_bound: account,
      upper_bound: account,
      limit: 1,
    });

    let stakeAmount = 0;
    if (votersResult.rows.length > 0 && votersResult.rows[0].staked) {
      stakeAmount = parseInt(votersResult.rows[0].staked);
    }

    return calculateTrustScore(agent, agentScore, kycLevel, stakeAmount);
  }

  /**
   * Get contract configuration
   */
  async getConfig(): Promise<AgentCoreConfig> {
    const result = await this.rpc.get_table_rows<{
      owner: string;
      min_stake: string;
      registration_fee: string;
      claim_fee: string;
      feed_contract: string;
      valid_contract: string;
      escrow_contract: string;
      paused: number;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'config',
      limit: 1,
    });

    if (result.rows.length === 0) {
      throw new Error('Contract not initialized');
    }

    const row = result.rows[0];
    return {
      owner: row.owner,
      min_stake: parseInt(row.min_stake),
      registration_fee: parseInt(row.registration_fee),
      claim_fee: parseInt(row.claim_fee || '0'),
      feed_contract: row.feed_contract,
      valid_contract: row.valid_contract,
      escrow_contract: row.escrow_contract,
      paused: row.paused === 1,
    };
  }

  // ============== WRITE OPERATIONS ==============

  /**
   * Register a new agent
   */
  async register(data: RegisterAgentData): Promise<TransactionResult> {
    this.requireSession();

    // Validate input before sending to blockchain
    validateAgentData({
      name: data.name,
      description: data.description,
      endpoint: data.endpoint,
      protocol: data.protocol,
      capabilities: data.capabilities,
    });

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'register',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            name: data.name,
            description: data.description,
            endpoint: data.endpoint,
            protocol: data.protocol,
            capabilities: JSON.stringify(data.capabilities),
          },
        },
      ],
    });
  }

  /**
   * Update agent metadata
   */
  async update(data: UpdateAgentData): Promise<TransactionResult> {
    this.requireSession();

    // Validate input before sending to blockchain
    // Only validate fields that are provided (UpdateAgentData has optional fields)
    validateAgentData({
      name: data.name,
      description: data.description,
      endpoint: data.endpoint,
      protocol: data.protocol,
      capabilities: data.capabilities,
    });

    // Get current agent data to merge with updates
    const current = await this.getAgent(this.session!.auth.actor);
    if (!current) {
      throw new Error('Agent not found');
    }

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'update',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            name: data.name ?? current.name,
            description: data.description ?? current.description,
            endpoint: data.endpoint ?? current.endpoint,
            protocol: data.protocol ?? current.protocol,
            capabilities: JSON.stringify(data.capabilities ?? current.capabilities),
          },
        },
      ],
    });
  }

  /**
   * Set agent active status
   */
  async setStatus(active: boolean): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'setstatus',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            active,
          },
        },
      ],
    });
  }

  // ============== SYSTEM STAKING NOTE ==============
  // Agents use XPR Network's native system staking (eosio::voters table)
  // instead of contract-managed staking. To stake/unstake:
  //
  // 1. Stake: Use system stake action or resources.xprnetwork.org
  // 2. Unstake: Use system unstake action
  // 3. Query stake: Call agentcore::getagentinfo action or query eosio::voters table
  //
  // This design leverages the existing staking infrastructure and allows
  // agents to earn staking rewards while meeting minimum stake requirements.

  /**
   * Add plugin to agent
   */
  async addPlugin(pluginId: number, config: object = {}): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'addplugin',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent: this.session!.auth.actor,
            plugin_id: pluginId,
            config: JSON.stringify(config),
          },
        },
      ],
    });
  }

  /**
   * Remove plugin from agent
   */
  async removePlugin(agentPluginId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'rmplugin',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent: this.session!.auth.actor,
            agentplugin_id: agentPluginId,
          },
        },
      ],
    });
  }

  /**
   * Register a new plugin
   */
  async registerPlugin(
    name: string,
    version: string,
    contract: string,
    action: string,
    schema: object,
    category: PluginCategory
  ): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'regplugin',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            author: this.session!.auth.actor,
            name,
            version,
            contract,
            action,
            schema: JSON.stringify(schema),
            category,
          },
        },
      ],
    });
  }

  // ============== OWNERSHIP ==============

  /**
   * Step 1: Agent approves a human to claim them.
   * This is called by the AGENT to give consent.
   *
   * @param newOwner - The KYC'd human being approved to claim
   */
  async approveClaim(newOwner: string): Promise<TransactionResult> {
    this.requireSession();

    // The session holder IS the agent giving consent
    const agent = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'approveclaim',
          authorization: [
            {
              actor: agent,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
            new_owner: newOwner,
          },
        },
      ],
    });
  }

  /**
   * Step 2: Human completes the claim after agent approval.
   * Agent must have called approveClaim first.
   *
   * IMPORTANT: Before calling this, you must:
   * 1. Have the agent call approveClaim(yourAccount)
   * 2. Send the claim fee with memo "claim:agentname:yourname"
   *
   * @param agent - The agent account to claim
   */
  async claim(agent: string): Promise<TransactionResult> {
    this.requireSession();

    const owner = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'claim',
          authorization: [
            {
              actor: owner,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Send claim fee and complete the claim in one transaction.
   * Agent must have already called approveClaim first.
   *
   * @param agent - The agent account to claim
   * @param amount - The claim fee amount (e.g., "1.0000 XPR")
   */
  async claimWithFee(agent: string, amount: string): Promise<TransactionResult> {
    this.requireSession();

    const owner = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [
            {
              actor: owner,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            from: owner,
            to: this.contract,
            quantity: amount,
            memo: `claim:${agent}:${owner}`,
          },
        },
        {
          account: this.contract,
          name: 'claim',
          authorization: [
            {
              actor: owner,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Cancel a pending claim approval.
   * Only the agent can cancel their own approval.
   * Any deposit will be refunded to the payer.
   *
   * NOTE: The session holder must be the agent account.
   */
  async cancelClaim(): Promise<TransactionResult> {
    this.requireSession();

    const agent = this.session!.auth.actor;

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'cancelclaim',
          authorization: [
            {
              actor: agent,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Transfer ownership of an agent to a new owner.
   *
   * IMPORTANT: The contract requires THREE signatures:
   * 1. Current owner (must authorize)
   * 2. New owner (must authorize)
   * 3. Agent itself (must consent to the transfer)
   *
   * This method includes only the session holder's authorization.
   * It will FAIL unless the session holder controls all three accounts,
   * which is rare in practice.
   *
   * For most use cases, use `buildTransferProposal()` to create a multi-sig
   * proposal that can be signed by all three parties.
   *
   * @param agent - The agent account
   * @param newOwner - The new owner (must have KYC)
   * @throws Will fail if session holder doesn't control all 3 required accounts
   */
  async transferOwnership(agent: string, newOwner: string): Promise<TransactionResult> {
    this.requireSession();

    // P2 FIX: Warn about the three-signature requirement
    console.warn(
      'transferOwnership requires 3 signatures (current owner, new owner, agent). ' +
      'This will fail unless session controls all accounts. Use buildTransferProposal() for multi-sig.'
    );

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'transfer',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
            new_owner: newOwner,
          },
        },
      ],
    });
  }

  /**
   * Build a transfer ownership action for use in a multi-sig proposal.
   * Returns the action data that can be used with msig.propose.
   *
   * The transfer requires signatures from:
   * 1. Current owner
   * 2. New owner
   * 3. Agent itself
   *
   * @param agent - The agent account
   * @param currentOwner - The current owner account
   * @param newOwner - The new owner account (must have KYC)
   * @returns Action data for multi-sig proposal
   */
  buildTransferProposal(agent: string, currentOwner: string, newOwner: string): {
    account: string;
    name: string;
    authorization: Array<{ actor: string; permission: string }>;
    data: { agent: string; new_owner: string };
  } {
    return {
      account: this.contract,
      name: 'transfer',
      authorization: [
        { actor: currentOwner, permission: 'active' },
        { actor: newOwner, permission: 'active' },
        { actor: agent, permission: 'active' },
      ],
      data: {
        agent,
        new_owner: newOwner,
      },
    };
  }

  /**
   * Release ownership of an agent.
   * Only the current owner can release.
   * Claim deposit is refunded to the owner.
   *
   * @param agent - The agent account to release
   */
  async release(agent: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'release',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Verify an agent's owner still has valid KYC.
   * Anyone can call this to trigger re-verification.
   *
   * If the owner's KYC has dropped below level 1, the ownership
   * is removed and the claim deposit is refunded to the former owner.
   *
   * This helps maintain trust score integrity by allowing community
   * enforcement of KYC requirements.
   *
   * @param agent - The agent account to verify
   */
  async verifyClaim(agent: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'verifyclaim',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            agent,
          },
        },
      ],
    });
  }

  /**
   * Get agents owned by a specific account
   */
  async getAgentsByOwner(owner: string, limit: number = 100): Promise<Agent[]> {
    // Use secondary index to query by owner
    const result = await this.rpc.get_table_rows<AgentRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agents',
      index_position: 2, // byOwner secondary index
      key_type: 'name',
      lower_bound: owner,
      upper_bound: owner,
      limit,
    });

    return result.rows.map((row) => this.parseAgent(row));
  }

  // ============== HELPERS ==============

  private requireSession(): void {
    if (!this.session) {
      throw new Error('Session required for write operations');
    }
  }

  private parseAgent(raw: AgentRaw): Agent {
    return {
      account: raw.account,
      owner: raw.owner || null,  // Empty string means no owner
      pending_owner: raw.pending_owner || null,
      name: raw.name,
      description: raw.description,
      endpoint: raw.endpoint,
      protocol: raw.protocol,
      capabilities: parseCapabilities(raw.capabilities),
      total_jobs: parseInt(raw.total_jobs),
      registered_at: parseInt(raw.registered_at),
      active: raw.active === 1,
      claim_deposit: parseInt(raw.claim_deposit || '0'),
      deposit_payer: raw.deposit_payer || null,
      // Note: stake is queried from system staking (eosio::voters), not stored here
    };
  }

  private parsePlugin(raw: PluginRaw): Plugin {
    return {
      id: parseInt(raw.id),
      name: raw.name,
      version: raw.version,
      contract: raw.contract,
      action: raw.action,
      schema: safeJsonParse(raw.schema, {}),
      category: raw.category as PluginCategory,
      author: raw.author,
      verified: raw.verified === 1,
    };
  }

  private parseAgentPlugin(raw: AgentPluginRaw): AgentPlugin {
    return {
      id: parseInt(raw.id),
      agent: raw.agent,
      plugin_id: parseInt(raw.plugin_id),
      config: safeJsonParse(raw.config, {}),
      enabled: raw.enabled === 1,
    };
  }
}
