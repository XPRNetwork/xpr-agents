import {
  Name,
  Table,
  TableStore,
  Contract,
  Asset,
  Symbol,
  check,
  requireAuth,
  currentTimeSec,
  isAccount,
  hasAuth,
  print,
  EMPTY_NAME,
  Singleton,
  InlineAction,
  ActionData,
  PermissionLevel
} from "proton-tsc";

// ============== EXTERNAL TABLES ==============

// Read staking info from eosio::voters table (system staking)
@table("voters", noabigen)
export class VoterInfo extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public proxy: Name = EMPTY_NAME,
    public producers: Name[] = [],
    public staked: i64 = 0,              // Staked amount in smallest units (divide by 10000 for XPR)
    public last_vote_weight: f64 = 0,
    public proxied_vote_weight: f64 = 0,
    public is_proxy: u8 = 0,
    public flags1: u32 = 0,
    public reserved2: u32 = 0,
    public reserved3: string = ""
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.owner.N;
  }
}

// Read KYC info from eosio.proton::usersinfo table
@table("usersinfo", noabigen)
export class UserInfo extends Table {
  constructor(
    public acc: Name = EMPTY_NAME,
    public name: string = "",
    public avatar: string = "",
    public verified: u8 = 0,             // 0 = unverified, 1 = verified
    public date: u64 = 0,
    public verifiedon: u64 = 0,
    public verifier: Name = EMPTY_NAME,
    public raccs: Name[] = [],
    public aacts: string[] = [],
    public ac: u64[] = [],
    public kyc: u8[] = []                // KYC levels array
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.acc.N;
  }
}

// ============== LOCAL TABLES ==============

@table("agents")
export class Agent extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public name: string = "",
    public description: string = "",
    public endpoint: string = "",
    public protocol: string = "",
    public capabilities: string = "",
    public total_jobs: u64 = 0,
    public registered_at: u64 = 0,
    public active: boolean = true
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// Hash function for string to u64 secondary index
function hashString(s: string): u64 {
  let hash: u64 = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + <u64>s.charCodeAt(i);
  }
  return hash;
}

@table("plugins")
export class Plugin extends Table {
  constructor(
    public id: u64 = 0,
    public name: string = "",
    public version: string = "",
    public contract: Name = EMPTY_NAME,
    public action: string = "",
    public schema: string = "",
    public category: string = "",
    public author: Name = EMPTY_NAME,
    public verified: boolean = false
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byAuthor(): u64 {
    return this.author.N;
  }

  set byAuthor(value: u64) {
    this.author = Name.fromU64(value);
  }

  @secondary
  get byCategory(): u64 {
    return hashString(this.category);
  }

  set byCategory(value: u64) {
    // Category is derived from hash, setter is a no-op
  }
}

@table("agentplugs")
export class AgentPlugin extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public plugin_id: u64 = 0,
    public config: string = "",
    public enabled: boolean = true
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byAgent(): u64 {
    return this.agent.N;
  }

  set byAgent(value: u64) {
    this.agent = Name.fromU64(value);
  }
}

@table("config", singleton)
export class Config extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public min_stake: u64 = 0, // Optional minimum stake requirement (reads from system)
    public registration_fee: u64 = 0,
    public feed_contract: Name = EMPTY_NAME, // Authorized agentfeed contract
    public valid_contract: Name = EMPTY_NAME, // Authorized agentvalid contract
    public escrow_contract: Name = EMPTY_NAME, // Authorized agentescrow contract
    public paused: boolean = false
  ) {
    super();
  }
}

@table("pluginres")
export class PluginResult extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public plugin_id: u64 = 0,
    public job_id: u64 = 0,
    public status: string = "",
    public result_data: string = "",
    public timestamp: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byAgent(): u64 {
    return this.agent.N;
  }

  set byAgent(value: u64) {
    this.agent = Name.fromU64(value);
  }
}

// ============== CONTRACT ==============

@contract
export class AgentCoreContract extends Contract {
  // Local tables
  private agentsTable: TableStore<Agent> = new TableStore<Agent>(this.receiver);
  private pluginsTable: TableStore<Plugin> = new TableStore<Plugin>(this.receiver);
  private agentPlugsTable: TableStore<AgentPlugin> = new TableStore<AgentPlugin>(this.receiver);
  private pluginResultsTable: TableStore<PluginResult> = new TableStore<PluginResult>(this.receiver);
  private configSingleton: Singleton<Config> = new Singleton<Config>(this.receiver);

  // External tables - read system staking and KYC
  private readonly EOSIO: Name = Name.fromString("eosio");
  private readonly EOSIO_PROTON: Name = Name.fromString("eosio.proton");

  private readonly XPR_SYMBOL: Symbol = new Symbol("XPR", 4);
  private readonly TOKEN_CONTRACT: Name = Name.fromString("eosio.token");

  // ============== EXTERNAL DATA HELPERS ==============

  /**
   * Get account's staked XPR from system eosio::voters table
   * @returns Staked amount in XPR units (not smallest units)
   */
  getSystemStake(account: Name): u64 {
    const votersTable = new TableStore<VoterInfo>(this.EOSIO, this.EOSIO);
    const voter = votersTable.get(account.N);
    if (voter == null) {
      return 0;
    }
    // staked is in smallest units (divide by 10000 for XPR)
    return <u64>(voter.staked / 10000);
  }

  /**
   * Get account's KYC level from eosio.proton::usersinfo table
   * @returns Max KYC level (0-4)
   */
  getKycLevel(account: Name): u8 {
    const usersTable = new TableStore<UserInfo>(this.EOSIO_PROTON, this.EOSIO_PROTON);
    const user = usersTable.get(account.N);
    if (user == null) {
      return 0;
    }
    // Return max KYC level from array, or 0 if empty
    let maxLevel: u8 = 0;
    for (let i = 0; i < user.kyc.length; i++) {
      if (user.kyc[i] > maxLevel) {
        maxLevel = user.kyc[i];
      }
    }
    return maxLevel;
  }

  /**
   * Check if account is verified in eosio.proton
   */
  isVerified(account: Name): boolean {
    const usersTable = new TableStore<UserInfo>(this.EOSIO_PROTON, this.EOSIO_PROTON);
    const user = usersTable.get(account.N);
    return user != null && user.verified == 1;
  }

  // ============== INITIALIZATION ==============

  @action("init")
  init(
    owner: Name,
    min_stake: u64,
    feed_contract: Name,
    valid_contract: Name,
    escrow_contract: Name
  ): void {
    requireAuth(this.receiver);

    // H7 FIX: Validate contract accounts exist
    check(isAccount(owner), "Owner must be a valid account");
    if (feed_contract != EMPTY_NAME) {
      check(isAccount(feed_contract), "Feed contract must be a valid account");
    }
    if (valid_contract != EMPTY_NAME) {
      check(isAccount(valid_contract), "Valid contract must be a valid account");
    }
    if (escrow_contract != EMPTY_NAME) {
      check(isAccount(escrow_contract), "Escrow contract must be a valid account");
    }

    const config = new Config(
      owner,
      min_stake,
      0, // registration_fee
      feed_contract,
      valid_contract,
      escrow_contract,
      false // paused
    );
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(
    min_stake: u64,
    registration_fee: u64,
    feed_contract: Name,
    valid_contract: Name,
    escrow_contract: Name,
    paused: boolean
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    // H7 FIX: Validate contract accounts exist
    if (feed_contract != EMPTY_NAME) {
      check(isAccount(feed_contract), "Feed contract must be a valid account");
    }
    if (valid_contract != EMPTY_NAME) {
      check(isAccount(valid_contract), "Valid contract must be a valid account");
    }
    if (escrow_contract != EMPTY_NAME) {
      check(isAccount(escrow_contract), "Escrow contract must be a valid account");
    }

    config.min_stake = min_stake;
    config.registration_fee = registration_fee;
    config.feed_contract = feed_contract;
    config.valid_contract = valid_contract;
    config.escrow_contract = escrow_contract;
    config.paused = paused;

    this.configSingleton.set(config, this.receiver);
  }

  // ============== AGENT REGISTRATION ==============

  @action("register")
  register(
    account: Name,
    name: string,
    description: string,
    endpoint: string,
    protocol: string,
    capabilities: string
  ): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(isAccount(account), "Account does not exist");
    check(this.agentsTable.get(account.N) == null, "Agent already registered");

    // Validate inputs
    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    check(description.length <= 256, "Description must be <= 256 characters");
    check(endpoint.length > 0 && endpoint.length <= 256, "Endpoint must be 1-256 characters");
    check(protocol.length > 0 && protocol.length <= 32, "Protocol must be 1-32 characters");

    // C1 FIX: Validate capabilities field to prevent unbounded storage
    check(capabilities.length <= 2048, "Capabilities must be <= 2048 characters");

    // Check minimum stake requirement (from system staking)
    if (config.min_stake > 0) {
      const systemStake = this.getSystemStake(account);
      check(
        systemStake >= config.min_stake,
        `Insufficient stake. Required: ${config.min_stake} XPR, Current: ${systemStake} XPR. Stake via resources.xprnetwork.org`
      );
    }

    const agent = new Agent(
      account,
      name,
      description,
      endpoint,
      protocol,
      capabilities,
      0, // total_jobs
      currentTimeSec(),
      true
    );

    this.agentsTable.store(agent, this.receiver);
  }

  @action("update")
  update(
    account: Name,
    name: string,
    description: string,
    endpoint: string,
    protocol: string,
    capabilities: string
  ): void {
    requireAuth(account);

    const agent = this.agentsTable.requireGet(account.N, "Agent not found");

    // Validate inputs
    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    check(description.length <= 256, "Description must be <= 256 characters");
    check(endpoint.length > 0 && endpoint.length <= 256, "Endpoint must be 1-256 characters");
    check(protocol.length > 0 && protocol.length <= 32, "Protocol must be 1-32 characters");

    // C1 FIX: Validate capabilities field to prevent unbounded storage
    check(capabilities.length <= 2048, "Capabilities must be <= 2048 characters");

    agent.name = name;
    agent.description = description;
    agent.endpoint = endpoint;
    agent.protocol = protocol;
    agent.capabilities = capabilities;

    this.agentsTable.update(agent, this.receiver);
  }

  @action("setstatus")
  setStatus(account: Name, active: boolean): void {
    requireAuth(account);

    const agent = this.agentsTable.requireGet(account.N, "Agent not found");
    agent.active = active;

    this.agentsTable.update(agent, this.receiver);
  }

  @action("incjobs")
  incrementJobs(account: Name): void {
    // Allow agentfeed, agentvalid, agentescrow, or owner to call this
    const config = this.configSingleton.get();

    // H5 FIX: Respect paused flag
    check(!config.paused, "Contract is paused");

    const isOwner = hasAuth(config.owner);
    const isSelf = hasAuth(this.receiver);
    const isFeedContract = config.feed_contract != EMPTY_NAME && hasAuth(config.feed_contract);
    const isValidContract = config.valid_contract != EMPTY_NAME && hasAuth(config.valid_contract);
    const isEscrowContract = config.escrow_contract != EMPTY_NAME && hasAuth(config.escrow_contract);

    check(
      isOwner || isSelf || isFeedContract || isValidContract || isEscrowContract,
      "Only authorized contracts can increment jobs"
    );

    const agent = this.agentsTable.requireGet(account.N, "Agent not found");

    // C2 FIX: Overflow protection for job counter
    check(agent.total_jobs < U64.MAX_VALUE, "Job counter would overflow");
    agent.total_jobs += 1;

    this.agentsTable.update(agent, this.receiver);
  }

  // ============== TRUST DATA QUERIES ==============

  /**
   * View action to get an agent's trust-related data.
   * Returns system stake and KYC level for trust score calculation.
   */
  @action("getagentinfo")
  getAgentInfo(account: Name): void {
    const agent = this.agentsTable.get(account.N);
    check(agent != null, "Agent not found");

    const systemStake = this.getSystemStake(account);
    const kycLevel = this.getKycLevel(account);
    const verified = this.isVerified(account);

    print(`Agent: ${account.toString()}`);
    print(`System Stake: ${systemStake} XPR`);
    print(`KYC Level: ${kycLevel}`);
    print(`Verified: ${verified ? "Yes" : "No"}`);
    print(`Total Jobs: ${agent!.total_jobs}`);
    print(`Registered: ${agent!.registered_at}`);
    print(`Active: ${agent!.active ? "Yes" : "No"}`);
  }

  // ============== PLUGIN MANAGEMENT ==============

  @action("regplugin")
  registerPlugin(
    author: Name,
    name: string,
    version: string,
    contract: Name,
    action: string,
    schema: string,
    category: string
  ): void {
    requireAuth(author);

    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    check(version.length > 0 && version.length <= 16, "Version must be 1-16 characters");
    check(isAccount(contract), "Plugin contract must be valid account");
    check(action.length > 0 && action.length <= 12, "Action must be 1-12 characters");

    // Valid categories
    const validCategories = ["compute", "storage", "oracle", "payment", "messaging", "ai"];
    let validCategory = false;
    for (let i = 0; i < validCategories.length; i++) {
      if (validCategories[i] == category) {
        validCategory = true;
        break;
      }
    }
    check(validCategory, "Invalid category");

    const plugin = new Plugin(
      this.pluginsTable.availablePrimaryKey,
      name,
      version,
      contract,
      action,
      schema,
      category,
      author,
      false
    );

    this.pluginsTable.store(plugin, this.receiver);
  }

  @action("verifyplugin")
  verifyPlugin(plugin_id: u64, verified: boolean): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const plugin = this.pluginsTable.requireGet(plugin_id, "Plugin not found");
    plugin.verified = verified;

    this.pluginsTable.update(plugin, this.receiver);
  }

  @action("addplugin")
  addPlugin(agent: Name, plugin_id: u64, config: string): void {
    requireAuth(agent);

    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");
    check(agentRecord.active, "Agent is not active");

    const plugin = this.pluginsTable.requireGet(plugin_id, "Plugin not found");

    // Check if agent already has this plugin
    // Iterate through secondary index to find all plugins for this agent
    let existingPlug = this.agentPlugsTable.getBySecondaryU64(agent.N, 0);
    while (existingPlug != null) {
      check(existingPlug.plugin_id != plugin_id, "Plugin already added");
      existingPlug = this.agentPlugsTable.nextBySecondaryU64(existingPlug, 0);
      // Break if we've moved past this agent's entries
      if (existingPlug != null && existingPlug.agent != agent) break;
    }

    const agentPlugin = new AgentPlugin(
      this.agentPlugsTable.availablePrimaryKey,
      agent,
      plugin_id,
      config,
      true
    );

    this.agentPlugsTable.store(agentPlugin, this.receiver);
  }

  @action("rmplugin")
  removePlugin(agent: Name, agentplugin_id: u64): void {
    requireAuth(agent);

    const agentPlugin = this.agentPlugsTable.requireGet(agentplugin_id, "Agent plugin not found");
    check(agentPlugin.agent == agent, "Not your plugin");

    this.agentPlugsTable.remove(agentPlugin);
  }

  @action("toggleplug")
  togglePlugin(agent: Name, agentplugin_id: u64, enabled: boolean): void {
    requireAuth(agent);

    const agentPlugin = this.agentPlugsTable.requireGet(agentplugin_id, "Agent plugin not found");
    check(agentPlugin.agent == agent, "Not your plugin");

    agentPlugin.enabled = enabled;
    this.agentPlugsTable.update(agentPlugin, this.receiver);
  }

  @action("pluginres")
  pluginResult(
    agent: Name,
    plugin_id: u64,
    job_id: u64,
    status: string,
    result_data: string
  ): void {
    // Only plugin contracts can call this
    const plugin = this.pluginsTable.requireGet(plugin_id, "Plugin not found");
    requireAuth(plugin.contract);

    // C4 FIX: Verify agent is registered and active before accepting results
    const agentRecord = this.agentsTable.get(agent.N);
    check(agentRecord != null, "Agent not found");
    check(agentRecord!.active, "Agent is not active");

    // H4 FIX: Verify agent has this plugin enabled before accepting results
    // This prevents plugins from submitting results for agents that don't use them
    let agentPlugin = this.agentPlugsTable.getBySecondaryU64(agent.N, 0);
    let hasPlugin = false;
    while (agentPlugin != null) {
      if (agentPlugin.plugin_id == plugin_id && agentPlugin.enabled) {
        hasPlugin = true;
        break;
      }
      agentPlugin = this.agentPlugsTable.nextBySecondaryU64(agentPlugin, 0);
      // Break if we've moved past this agent's entries
      if (agentPlugin != null && agentPlugin.agent != agent) break;
    }
    check(hasPlugin, "Agent does not have this plugin enabled");

    const result = new PluginResult(
      this.pluginResultsTable.availablePrimaryKey,
      agent,
      plugin_id,
      job_id,
      status,
      result_data,
      currentTimeSec()
    );

    this.pluginResultsTable.store(result, this.receiver);
  }

}
