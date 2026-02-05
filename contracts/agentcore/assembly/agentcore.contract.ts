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
  PermissionLevel,
  packer
} from "proton-tsc";

// ============== TABLES ==============

@table("agents")
export class Agent extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public name: string = "",
    public description: string = "",
    public endpoint: string = "",
    public protocol: string = "",
    public capabilities: string = "",
    public stake: u64 = 0,
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

  @secondary
  get byCategory(): u64 {
    return hashString(this.category);
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
}

@table("unstakes")
export class Unstake extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public amount: u64 = 0,
    public request_time: u64 = 0,
    public available_at: u64 = 0
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
}

@table("config", singleton)
export class Config extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public min_stake: u64 = 0, // Optional staking - KYC provides baseline trust
    public unstake_delay: u64 = 604800, // 7 days in seconds
    public registration_fee: u64 = 0,
    public feed_contract: Name = EMPTY_NAME, // Authorized agentfeed contract
    public valid_contract: Name = EMPTY_NAME, // Authorized agentvalid contract
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
}

// ============== CONTRACT ==============

@contract
export class AgentCoreContract extends Contract {
  private agentsTable: TableStore<Agent> = new TableStore<Agent>(this.receiver);
  private pluginsTable: TableStore<Plugin> = new TableStore<Plugin>(this.receiver);
  private agentPlugsTable: TableStore<AgentPlugin> = new TableStore<AgentPlugin>(this.receiver);
  private unstakesTable: TableStore<Unstake> = new TableStore<Unstake>(this.receiver);
  private pluginResultsTable: TableStore<PluginResult> = new TableStore<PluginResult>(this.receiver);
  private configSingleton: Singleton<Config> = new Singleton<Config>(this.receiver);

  private readonly XPR_SYMBOL: Symbol = new Symbol("XPR", 4);
  private readonly TOKEN_CONTRACT: Name = Name.fromString("eosio.token");

  // ============== INITIALIZATION ==============

  @action("init")
  init(
    owner: Name,
    min_stake: u64,
    unstake_delay: u64,
    feed_contract: Name,
    valid_contract: Name
  ): void {
    requireAuth(this.receiver);

    const config = new Config(
      owner,
      min_stake,
      unstake_delay,
      0, // registration_fee
      feed_contract,
      valid_contract,
      false // paused
    );
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(
    min_stake: u64,
    unstake_delay: u64,
    registration_fee: u64,
    feed_contract: Name,
    valid_contract: Name,
    paused: boolean
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    config.min_stake = min_stake;
    config.unstake_delay = unstake_delay;
    config.registration_fee = registration_fee;
    config.feed_contract = feed_contract;
    config.valid_contract = valid_contract;
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

    const agent = new Agent(
      account,
      name,
      description,
      endpoint,
      protocol,
      capabilities,
      0, // stake starts at 0
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
    // Allow agentfeed, agentvalid, or owner to call this
    const config = this.configSingleton.get();
    const isOwner = hasAuth(config.owner);
    const isSelf = hasAuth(this.receiver);
    const isFeedContract = config.feed_contract != EMPTY_NAME && hasAuth(config.feed_contract);
    const isValidContract = config.valid_contract != EMPTY_NAME && hasAuth(config.valid_contract);

    check(
      isOwner || isSelf || isFeedContract || isValidContract,
      "Only authorized contracts can increment jobs"
    );

    const agent = this.agentsTable.requireGet(account.N, "Agent not found");
    agent.total_jobs += 1;

    this.agentsTable.update(agent, this.receiver);
  }

  // ============== STAKING ==============

  @action("unstake")
  unstake(account: Name, amount: u64): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    const agent = this.agentsTable.requireGet(account.N, "Agent not found");

    check(amount > 0, "Amount must be positive");
    check(agent.stake >= amount, "Insufficient stake");

    // Reduce stake
    agent.stake -= amount;
    this.agentsTable.update(agent, this.receiver);

    // Create unstake request
    const unstakeRequest = new Unstake(
      this.unstakesTable.availablePrimaryKey,
      account,
      amount,
      currentTimeSec(),
      currentTimeSec() + config.unstake_delay
    );

    this.unstakesTable.store(unstakeRequest, this.receiver);
  }

  @action("withdraw")
  withdraw(account: Name, unstake_id: u64): void {
    requireAuth(account);

    const unstakeRequest = this.unstakesTable.requireGet(unstake_id, "Unstake request not found");

    check(unstakeRequest.agent == account, "Not your unstake request");
    check(currentTimeSec() >= unstakeRequest.available_at, "Unstake period not complete");

    // Transfer tokens back to agent
    const quantity = new Asset(unstakeRequest.amount, this.XPR_SYMBOL);
    this.sendTokens(account, quantity, "Unstake withdrawal");

    // Remove unstake request
    this.unstakesTable.remove(unstakeRequest);
  }

  @action("cancelunstk")
  cancelUnstake(account: Name, unstake_id: u64): void {
    requireAuth(account);

    const unstakeRequest = this.unstakesTable.requireGet(unstake_id, "Unstake request not found");

    check(unstakeRequest.agent == account, "Not your unstake request");

    // Return stake to agent
    const agent = this.agentsTable.requireGet(account.N, "Agent not found");
    agent.stake += unstakeRequest.amount;
    this.agentsTable.update(agent, this.receiver);

    // Remove unstake request
    this.unstakesTable.remove(unstakeRequest);
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
    const existingPlugs = this.agentPlugsTable.getBySecondaryU64(agent.N, 0);
    for (let i = 0; i < existingPlugs.length; i++) {
      check(existingPlugs[i].plugin_id != plugin_id, "Plugin already added");
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

  // ============== TOKEN TRANSFER HANDLER ==============

  @action("transfer", notify)
  onTransfer(from: Name, to: Name, quantity: Asset, memo: string): void {
    // Only handle incoming transfers
    if (to != this.receiver) return;

    // Ignore outgoing transfers from contract
    if (from == this.receiver) return;

    // Only accept XPR
    check(quantity.symbol == this.XPR_SYMBOL, "Only XPR accepted");
    check(this.firstReceiver == this.TOKEN_CONTRACT, "Invalid token contract");

    // Parse memo for stake action
    if (memo == "stake" || memo.startsWith("stake:")) {
      const agent = this.agentsTable.get(from.N);
      check(agent != null, "Agent not registered. Register first.");

      agent!.stake += quantity.amount;
      this.agentsTable.update(agent!, this.receiver);

      print(`Staked ${quantity.toString()} for agent ${from.toString()}`);
    } else {
      // Reject transfers with unrecognized memos to prevent trapped funds
      check(false, "Invalid memo. Use 'stake' to stake tokens.");
    }
  }

  // ============== HELPERS ==============

  private sendTokens(to: Name, quantity: Asset, memo: string): void {
    const transfer = new InlineAction<Transfer>("transfer");
    const action_data = new Transfer(this.receiver, to, quantity, memo);
    transfer.send(
      this.TOKEN_CONTRACT,
      [new PermissionLevel(this.receiver, Name.fromString("active"))],
      action_data
    );
  }
}

// Transfer action data structure for inline token transfers
@packer
class Transfer extends ActionData {
  constructor(
    public from: Name = EMPTY_NAME,
    public to: Name = EMPTY_NAME,
    public quantity: Asset = new Asset(),
    public memo: string = ""
  ) {
    super();
  }
}
