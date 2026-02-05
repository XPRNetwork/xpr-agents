import {
  Agent,
  AgentRaw,
  Plugin,
  PluginRaw,
  AgentPlugin,
  AgentPluginRaw,
  Unstake,
  AgentCoreConfig,
  AgentListOptions,
  RegisterAgentData,
  UpdateAgentData,
  TransactionResult,
  JsonRpc,
  ProtonSession,
  PluginCategory,
} from './types';
import { parseCapabilities, safeJsonParse, formatXpr } from './utils';

const DEFAULT_CONTRACT = 'agentcore';

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
   * List all agents with optional filters
   */
  async listAgents(options: AgentListOptions = {}): Promise<Agent[]> {
    const { limit = 100, active_only = true } = options;

    const result = await this.rpc.get_table_rows<AgentRaw>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'agents',
      limit,
    });

    let agents = result.rows.map((row) => this.parseAgent(row));

    if (active_only) {
      agents = agents.filter((a) => a.active);
    }

    if (options.min_stake !== undefined) {
      agents = agents.filter((a) => a.stake >= options.min_stake!);
    }

    return agents;
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
      key_type: 'i64',
      limit: 100,
    });

    // Filter by agent since secondary index returns all
    return result.rows
      .filter((row) => row.agent === account)
      .map((row) => this.parseAgentPlugin(row));
  }

  /**
   * Get pending unstake requests for an agent
   */
  async getUnstakeRequests(account: string): Promise<Unstake[]> {
    const result = await this.rpc.get_table_rows<{
      id: string;
      agent: string;
      amount: string;
      request_time: string;
      available_at: string;
    }>({
      json: true,
      code: this.contract,
      scope: this.contract,
      table: 'unstakes',
      index_position: 2,
      key_type: 'i64',
      limit: 100,
    });

    return result.rows
      .filter((row) => row.agent === account)
      .map((row) => ({
        id: parseInt(row.id),
        agent: row.agent,
        amount: parseInt(row.amount),
        request_time: parseInt(row.request_time),
        available_at: parseInt(row.available_at),
      }));
  }

  /**
   * Get contract configuration
   */
  async getConfig(): Promise<AgentCoreConfig> {
    const result = await this.rpc.get_table_rows<{
      owner: string;
      min_stake: string;
      unstake_delay: string;
      registration_fee: string;
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
      unstake_delay: parseInt(row.unstake_delay),
      registration_fee: parseInt(row.registration_fee),
      paused: row.paused === 1,
    };
  }

  // ============== WRITE OPERATIONS ==============

  /**
   * Register a new agent
   */
  async register(data: RegisterAgentData): Promise<TransactionResult> {
    this.requireSession();

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

  /**
   * Stake XPR to agent (requires separate token transfer)
   */
  async stake(amount: string): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            from: this.session!.auth.actor,
            to: this.contract,
            quantity: amount,
            memo: 'stake',
          },
        },
      ],
    });
  }

  /**
   * Request unstake
   */
  async unstake(amount: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'unstake',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            amount,
          },
        },
      ],
    });
  }

  /**
   * Withdraw completed unstake
   */
  async withdraw(unstakeId: number): Promise<TransactionResult> {
    this.requireSession();

    return this.session!.link.transact({
      actions: [
        {
          account: this.contract,
          name: 'withdraw',
          authorization: [
            {
              actor: this.session!.auth.actor,
              permission: this.session!.auth.permission,
            },
          ],
          data: {
            account: this.session!.auth.actor,
            unstake_id: unstakeId,
          },
        },
      ],
    });
  }

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

  // ============== HELPERS ==============

  private requireSession(): void {
    if (!this.session) {
      throw new Error('Session required for write operations');
    }
  }

  private parseAgent(raw: AgentRaw): Agent {
    return {
      account: raw.account,
      name: raw.name,
      description: raw.description,
      endpoint: raw.endpoint,
      protocol: raw.protocol,
      capabilities: parseCapabilities(raw.capabilities),
      stake: parseInt(raw.stake),
      total_jobs: parseInt(raw.total_jobs),
      registered_at: parseInt(raw.registered_at),
      active: raw.active === 1,
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
