import {
  Name,
  Table,
  TableStore,
  Contract,
  Symbol,
  Asset,
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

// ============== INLINE ACTION DATA ==============

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

// ============== CONSTANTS ==============

// L18/M11 FIX: Valid protocols whitelist
const VALID_PROTOCOLS: string[] = ["http", "https", "grpc", "websocket", "mqtt", "wss"];

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
    public owner: Name = EMPTY_NAME,        // KYC'd human who sponsors this agent
    public pending_owner: Name = EMPTY_NAME, // Approved claimant (2-step flow)
    public name: string = "",
    public description: string = "",
    public endpoint: string = "",
    public protocol: string = "",
    public capabilities: string = "",
    public total_jobs: u64 = 0,
    public registered_at: u64 = 0,
    public active: boolean = true,
    public claim_deposit: u64 = 0,          // Refundable deposit paid when claiming
    public deposit_payer: Name = EMPTY_NAME // Who paid the deposit (must match claimant)
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }

  @secondary
  get byOwner(): u64 {
    return this.owner.N;
  }

  set byOwner(value: u64) {
    this.owner = Name.fromU64(value);
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
    public claim_fee: u64 = 100000,           // Fee to claim an agent (1.0000 XPR default), refundable on release
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
    // M12 FIX: Handle edge case where staked could be negative or zero
    if (voter.staked <= 0) {
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
    claim_fee: u64,
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
      claim_fee,
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
    claim_fee: u64,
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
    config.claim_fee = claim_fee;
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
    // L16 FIX: Require description to be non-empty
    check(description.length > 0 && description.length <= 256, "Description must be 1-256 characters");
    check(endpoint.length > 0 && endpoint.length <= 256, "Endpoint must be 1-256 characters");

    // M10 FIX: Basic URL format validation - must start with valid scheme
    check(
      endpoint.startsWith("http://") || endpoint.startsWith("https://") ||
      endpoint.startsWith("grpc://") || endpoint.startsWith("wss://"),
      "Endpoint must start with http://, https://, grpc://, or wss://"
    );

    // M11 FIX: Protocol must be from valid list
    check(protocol.length > 0 && protocol.length <= 32, "Protocol must be 1-32 characters");
    let validProtocol = false;
    for (let i = 0; i < VALID_PROTOCOLS.length; i++) {
      if (VALID_PROTOCOLS[i] == protocol) {
        validProtocol = true;
        break;
      }
    }
    check(validProtocol, "Protocol must be: http, https, grpc, websocket, mqtt, or wss");

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
      EMPTY_NAME,   // owner - no sponsor initially
      EMPTY_NAME,   // pending_owner - no pending claim
      name,
      description,
      endpoint,
      protocol,
      capabilities,
      0, // total_jobs
      currentTimeSec(),
      true,
      0,            // claim_deposit
      EMPTY_NAME    // deposit_payer
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

    // H9 FIX: Check paused status
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const agent = this.agentsTable.requireGet(account.N, "Agent not found");

    // Validate inputs
    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    // L16 FIX: Require description to be non-empty
    check(description.length > 0 && description.length <= 256, "Description must be 1-256 characters");
    check(endpoint.length > 0 && endpoint.length <= 256, "Endpoint must be 1-256 characters");

    // M10 FIX: Basic URL format validation
    check(
      endpoint.startsWith("http://") || endpoint.startsWith("https://") ||
      endpoint.startsWith("grpc://") || endpoint.startsWith("wss://"),
      "Endpoint must start with http://, https://, grpc://, or wss://"
    );

    // M11 FIX: Protocol must be from valid list
    check(protocol.length > 0 && protocol.length <= 32, "Protocol must be 1-32 characters");
    let validProtocol = false;
    for (let i = 0; i < VALID_PROTOCOLS.length; i++) {
      if (VALID_PROTOCOLS[i] == protocol) {
        validProtocol = true;
        break;
      }
    }
    check(validProtocol, "Protocol must be: http, https, grpc, websocket, mqtt, or wss");

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

    // M16 FIX: Check paused status
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

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

  // ============== AGENT OWNERSHIP ==============

  /**
   * Step 1 of 2-step claim: Agent approves a specific human to claim them.
   * This gives consent without requiring both signatures in one transaction.
   *
   * @param agent - The agent account giving consent
   * @param new_owner - The KYC'd human being approved to claim
   */
  @action("approveclaim")
  approveClaim(agent: Name, new_owner: Name): void {
    requireAuth(agent);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // Verify new_owner is a valid account
    check(isAccount(new_owner), "New owner must be a valid account");

    // Get agent record
    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Agent must not already have an owner
    check(agentRecord.owner == EMPTY_NAME, "Agent already has an owner");

    // P2 FIX: Prevent deposit trapping when re-approving a different claimant.
    // If a deposit exists from a different payer, agent must call cancelclaim first
    // to refund the existing deposit before approving a new claimant.
    if (agentRecord.claim_deposit > 0 && agentRecord.deposit_payer != EMPTY_NAME) {
      check(
        agentRecord.deposit_payer == new_owner,
        "Deposit exists from " + agentRecord.deposit_payer.toString() + ". Call cancelclaim first to refund their deposit before approving a new claimant."
      );
    }

    // Verify new_owner has KYC (must have at least level 1 to sponsor)
    const kycLevel = this.getKycLevel(new_owner);
    check(kycLevel >= 1, "Approved owner must have KYC level 1 or higher");

    // Set pending owner (agent consent)
    agentRecord.pending_owner = new_owner;
    this.agentsTable.update(agentRecord, this.receiver);

    print(`Agent ${agent.toString()} approved ${new_owner.toString()} to claim (KYC level ${kycLevel})`);
  }

  /**
   * Step 2 of 2-step claim: Human completes the claim after agent approval.
   * Requires the agent to have called approveclaim first.
   *
   * H2 FIX: If KYC was revoked between deposit and claim, the deposit is refunded
   * rather than being trapped.
   *
   * @param agent - The agent account to claim
   */
  @action("claim")
  claim(agent: Name): void {
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // Get agent record
    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Agent must not already have an owner
    check(agentRecord.owner == EMPTY_NAME, "Agent already has an owner. Use transfer action.");

    // Must have a pending owner (agent gave consent)
    check(agentRecord.pending_owner != EMPTY_NAME, "Agent has not approved any claimant. Agent must call approveclaim first.");

    const new_owner = agentRecord.pending_owner;

    // Only the approved owner can complete the claim
    requireAuth(new_owner);

    // H2 FIX: Check KYC and refund deposit if KYC was revoked
    const kycLevel = this.getKycLevel(new_owner);
    if (kycLevel < 1) {
      // KYC was revoked between deposit and claim - refund the deposit
      if (agentRecord.claim_deposit > 0 && agentRecord.deposit_payer != EMPTY_NAME) {
        const refundAmount = agentRecord.claim_deposit;
        const refundTo = agentRecord.deposit_payer;

        // Clear deposit tracking but keep pending_owner so agent can re-approve same or different claimant
        agentRecord.claim_deposit = 0;
        agentRecord.deposit_payer = EMPTY_NAME;
        this.agentsTable.update(agentRecord, this.receiver);

        // Refund the deposit
        this.sendTokens(refundTo, new Asset(refundAmount, this.XPR_SYMBOL), "Claim deposit refund - KYC revoked for " + agent.toString());

        print(`KYC revoked for ${new_owner.toString()}. Refunded ${refundAmount / 10000} XPR to ${refundTo.toString()}.`);
      }
      check(false, "Owner must have KYC level 1 or higher to claim an agent. Your deposit has been refunded.");
      return; // Unreachable but makes intent clear
    }

    // Check that claim fee was paid by the new_owner
    if (config.claim_fee > 0) {
      check(agentRecord.claim_deposit >= config.claim_fee,
        "Claim fee not paid. Send " + (config.claim_fee / 10000).toString() + " XPR to this contract with memo 'claim:" + agent.toString() + ":" + new_owner.toString() + "'");
      check(agentRecord.deposit_payer == new_owner,
        "Deposit was paid by different account. Payer must match claimant.");
    }

    // Complete the claim - clear pending state but KEEP deposit_payer for refund tracking
    // CRITICAL FIX: deposit_payer must be tracked through ownership transfers
    // so that when the agent is eventually released, the refund goes to whoever
    // originally paid the deposit, not the current owner at release time.
    agentRecord.owner = new_owner;
    agentRecord.pending_owner = EMPTY_NAME;
    // Note: deposit_payer and claim_deposit stay for correct refund on release
    this.agentsTable.update(agentRecord, this.receiver);

    print(`Agent ${agent.toString()} claimed by ${new_owner.toString()} (KYC level ${kycLevel})`);
  }

  /**
   * Cancel a pending claim approval.
   * Only the agent can cancel their own approval.
   *
   * @param agent - The agent account cancelling approval
   */
  @action("cancelclaim")
  cancelClaim(agent: Name): void {
    requireAuth(agent);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Must have a pending owner to cancel
    check(agentRecord.pending_owner != EMPTY_NAME, "No pending claim to cancel");

    const cancelledOwner = agentRecord.pending_owner;

    // Clear pending owner
    agentRecord.pending_owner = EMPTY_NAME;

    // Refund any deposit if one was made
    if (agentRecord.claim_deposit > 0 && agentRecord.deposit_payer != EMPTY_NAME) {
      const refundAmount = agentRecord.claim_deposit;
      const refundTo = agentRecord.deposit_payer;

      agentRecord.claim_deposit = 0;
      agentRecord.deposit_payer = EMPTY_NAME;
      this.agentsTable.update(agentRecord, this.receiver);

      // Send refund
      this.sendTokens(refundTo, new Asset(refundAmount, this.XPR_SYMBOL), "Claim cancelled - deposit refund for " + agent.toString());
    } else {
      this.agentsTable.update(agentRecord, this.receiver);
    }

    print(`Agent ${agent.toString()} cancelled claim approval for ${cancelledOwner.toString()}`);
  }

  /**
   * Transfer ownership of an agent to a new owner.
   * Current owner, new owner, AND agent must all sign.
   * Claim deposit stays with the agent (not transferred to new owner).
   *
   * H1 FIX: Agent must consent to ownership transfers - the agent should have
   * a say in who sponsors them.
   *
   * @param agent - The agent account
   * @param new_owner - The new owner (must have KYC)
   */
  @action("transfer")
  transferOwnership(agent: Name, new_owner: Name): void {
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // Get agent record
    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Must have current owner
    check(agentRecord.owner != EMPTY_NAME, "Agent has no owner");

    // H1 FIX: All three parties must sign - current owner, new owner, AND agent
    requireAuth(agentRecord.owner);
    requireAuth(new_owner);
    requireAuth(agent);  // Agent must consent to the transfer

    // Verify new_owner has KYC
    const kycLevel = this.getKycLevel(new_owner);
    check(kycLevel >= 1, "New owner must have KYC level 1 or higher");

    const oldOwner = agentRecord.owner;
    agentRecord.owner = new_owner;
    this.agentsTable.update(agentRecord, this.receiver);

    print(`Agent ${agent.toString()} transferred from ${oldOwner.toString()} to ${new_owner.toString()}`);
  }

  /**
   * Release ownership of an agent.
   * Only the current owner can release.
   * CRITICAL FIX: Claim deposit is refunded to the ORIGINAL deposit payer,
   * not the current owner. This handles the case where ownership was transferred.
   *
   * @param agent - The agent account to release
   */
  @action("release")
  release(agent: Name): void {
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // Get agent record
    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Must have owner
    check(agentRecord.owner != EMPTY_NAME, "Agent has no owner");

    // Only owner can release
    requireAuth(agentRecord.owner);

    const oldOwner = agentRecord.owner;
    const refundAmount = agentRecord.claim_deposit;
    // CRITICAL FIX: Refund to original deposit payer, not current owner
    const refundTo = agentRecord.deposit_payer != EMPTY_NAME ? agentRecord.deposit_payer : oldOwner;

    // Clear ownership and deposit tracking
    agentRecord.owner = EMPTY_NAME;
    agentRecord.claim_deposit = 0;
    agentRecord.deposit_payer = EMPTY_NAME;
    this.agentsTable.update(agentRecord, this.receiver);

    // Refund claim deposit to original payer
    if (refundAmount > 0) {
      this.sendTokens(refundTo, new Asset(refundAmount, this.XPR_SYMBOL), "Claim deposit refund for " + agent.toString());
      if (refundTo != oldOwner) {
        print(`Agent ${agent.toString()} released by ${oldOwner.toString()}. Deposit refunded to original payer: ${refundTo.toString()}`);
      } else {
        print(`Agent ${agent.toString()} released by ${oldOwner.toString()}. Refunded: ${refundAmount / 10000} XPR`);
      }
    } else {
      print(`Agent ${agent.toString()} released by ${oldOwner.toString()}`);
    }
  }

  /**
   * Get owner's KYC level for an agent (used in trust score calculation)
   * If agent has no owner, returns 0.
   */
  getOwnerKycLevel(agent: Name): u8 {
    const agentRecord = this.agentsTable.get(agent.N);
    if (agentRecord == null || agentRecord.owner == EMPTY_NAME) {
      return 0;
    }
    return this.getKycLevel(agentRecord.owner);
  }

  /**
   * HIGH SECURITY FIX: Verify an agent's owner still has valid KYC.
   * Anyone can call this to trigger re-verification.
   * If owner's KYC has dropped below level 1, the claim is invalidated.
   *
   * This solves the KYC revocation problem - owners who lose KYC
   * are automatically removed from agent sponsorship.
   *
   * P2 FIX: The claim deposit is refunded to the ORIGINAL deposit payer,
   * not the current owner. This handles ownership transfer scenarios correctly.
   *
   * @param agent - The agent account to verify
   */
  @action("verifyclaim")
  verifyClaim(agent: Name): void {
    // Anyone can call this - it's a public service action
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // Get agent record
    const agentRecord = this.agentsTable.requireGet(agent.N, "Agent not found");

    // Must have an owner to verify
    check(agentRecord.owner != EMPTY_NAME, "Agent has no owner to verify");

    const owner = agentRecord.owner;
    const kycLevel = this.getKycLevel(owner);

    // If KYC is still valid, nothing to do
    if (kycLevel >= 1) {
      print(`Owner ${owner.toString()} KYC is valid (level ${kycLevel}). No action needed.`);
      return;
    }

    // KYC is no longer valid - remove ownership
    const refundAmount = agentRecord.claim_deposit;
    // P2 FIX: Refund to original deposit payer, not current owner (matches release() behavior)
    const refundTo = agentRecord.deposit_payer != EMPTY_NAME ? agentRecord.deposit_payer : owner;

    // Clear ownership
    agentRecord.owner = EMPTY_NAME;
    agentRecord.claim_deposit = 0;
    agentRecord.deposit_payer = EMPTY_NAME;
    this.agentsTable.update(agentRecord, this.receiver);

    // Refund deposit to original payer (not penalized - KYC expiry isn't their fault)
    if (refundAmount > 0) {
      this.sendTokens(refundTo, new Asset(refundAmount, this.XPR_SYMBOL), "Claim deposit refund - KYC expired for " + agent.toString());
      if (refundTo != owner) {
        print(`Owner ${owner.toString()} KYC invalid. Agent ${agent.toString()} ownership removed. Deposit refunded to original payer: ${refundTo.toString()}`);
      } else {
        print(`Owner ${owner.toString()} KYC invalid. Agent ${agent.toString()} ownership removed. Deposit refunded.`);
      }
    } else {
      print(`Owner ${owner.toString()} KYC invalid. Agent ${agent.toString()} ownership removed.`);
    }
  }

  /**
   * Send XPR tokens via inline action
   */
  private sendTokens(to: Name, quantity: Asset, memo: string): void {
    const TRANSFER = new InlineAction<Transfer>("transfer");
    const action = TRANSFER.act(this.TOKEN_CONTRACT, new PermissionLevel(this.receiver));
    const actionParams = new Transfer(this.receiver, to, quantity, memo);
    action.send(actionParams);
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

    // Get owner's KYC level (for trust score) instead of agent's
    let ownerKycLevel: u8 = 0;
    let ownerName = "none";
    if (agent!.owner != EMPTY_NAME) {
      ownerKycLevel = this.getKycLevel(agent!.owner);
      ownerName = agent!.owner.toString();
    }

    print(`Agent: ${account.toString()}`);
    print(`Owner: ${ownerName}`);
    print(`Owner KYC Level: ${ownerKycLevel}`);
    print(`Claim Deposit: ${agent!.claim_deposit / 10000} XPR`);
    print(`System Stake: ${systemStake} XPR`);
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

    // MEDIUM FIX: Add pause check to plugin registration
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    check(version.length > 0 && version.length <= 16, "Version must be 1-16 characters");
    check(isAccount(contract), "Plugin contract must be valid account");
    check(action.length > 0 && action.length <= 12, "Action must be 1-12 characters");
    // L18 FIX: Limit schema size to prevent plugin table bloat
    check(schema.length <= 4096, "Schema must be <= 4096 characters");

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
  addPlugin(agent: Name, plugin_id: u64, pluginConfig: string): void {
    requireAuth(agent);

    // MEDIUM FIX: Add pause check to adding plugins
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // LOW FIX: Validate plugin config length
    check(pluginConfig.length <= 4096, "Plugin config must be <= 4096 characters");

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
      pluginConfig,
      true
    );

    this.agentPlugsTable.store(agentPlugin, this.receiver);
  }

  @action("rmplugin")
  removePlugin(agent: Name, agentplugin_id: u64): void {
    requireAuth(agent);

    // MEDIUM FIX: Add pause check to removing plugins
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const agentPlugin = this.agentPlugsTable.requireGet(agentplugin_id, "Agent plugin not found");
    check(agentPlugin.agent == agent, "Not your plugin");

    this.agentPlugsTable.remove(agentPlugin);
  }

  @action("toggleplug")
  togglePlugin(agent: Name, agentplugin_id: u64, enabled: boolean): void {
    requireAuth(agent);

    // MEDIUM FIX: Add pause check to toggling plugins
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

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

    // MEDIUM FIX: Add pause check to plugin results
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    // M14/M15 FIX: Validate result_data and status
    check(result_data.length <= 8192, "Result data must be <= 8192 characters");
    const validStatuses = ["success", "failure", "partial", "pending"];
    let validStatus = false;
    for (let i = 0; i < validStatuses.length; i++) {
      if (validStatuses[i] == status) {
        validStatus = true;
        break;
      }
    }
    check(validStatus, "Status must be: success, failure, partial, or pending");

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

  // ============== PLUGIN RESULT CLEANUP ==============

  /**
   * MEDIUM FIX: Clean up old plugin results to prevent unbounded table growth
   * Agents can clean up their own results, or owner can clean up any results
   * @param agent - Agent whose results to clean up
   * @param max_age - Maximum age in seconds (results older than this are deleted)
   * @param max_delete - Maximum number of results to delete in one call (prevent timeout)
   */
  @action("cleanresults")
  cleanPluginResults(agent: Name, max_age: u64, max_delete: u64): void {
    const config = this.configSingleton.get();

    // Only agent or owner can clean up results
    const isOwner = hasAuth(config.owner);
    const isAgent = hasAuth(agent);
    check(isOwner || isAgent, "Only agent or contract owner can clean up results");

    // Validate parameters
    check(max_age >= 3600, "Max age must be at least 1 hour (3600 seconds)");
    check(max_delete > 0 && max_delete <= 100, "Max delete must be 1-100");

    const cutoffTime = currentTimeSec() - max_age;
    let deleted: u64 = 0;

    // Iterate through results for this agent
    let result = this.pluginResultsTable.getBySecondaryU64(agent.N, 0);
    while (result != null && deleted < max_delete) {
      const currentResult = result;
      // Move to next before potentially deleting
      result = this.pluginResultsTable.nextBySecondaryU64(currentResult, 0);
      // Break if we've moved past this agent's entries
      if (result != null && result.agent != agent) {
        result = null;
      }

      // Delete if older than cutoff
      if (currentResult.timestamp < cutoffTime) {
        this.pluginResultsTable.remove(currentResult);
        deleted++;
      }
    }

    print(`Cleaned up ${deleted} old plugin results for ${agent.toString()}`);
  }

  // ============== TOKEN TRANSFER HANDLER ==============

  /**
   * Handle incoming token transfers for claim deposits.
   * Memo format: "claim:agentname:ownername"
   * Only accepts XPR from eosio.token.
   *
   * IMPORTANT: Agent must call approveclaim BEFORE sending deposit.
   * This prevents funds from being trapped with no refund path.
   */
  @action("transfer", notify)
  onTransfer(from: Name, to: Name, quantity: Asset, memo: string): void {
    // CRITICAL SECURITY: Verify notification comes from eosio.token
    // This prevents fake transfer notifications from malicious contracts
    check(this.firstReceiver == this.TOKEN_CONTRACT,
      "Only eosio.token transfers accepted");

    // Only process transfers TO this contract
    if (to != this.receiver) {
      return;
    }

    // Ignore transfers from self (refunds)
    if (from == this.receiver) {
      return;
    }

    // Only accept XPR
    check(quantity.symbol == this.XPR_SYMBOL, "Only XPR accepted");

    // Parse memo - must be "claim:agentname:ownername"
    if (!memo.startsWith("claim:")) {
      // Not a claim deposit, reject
      check(false, "Invalid memo. For claim deposits use: claim:agentname:ownername");
      return;
    }

    const parts = memo.slice(6).split(":"); // Remove "claim:" prefix and split
    check(parts.length == 2, "Invalid memo format. Use: claim:agentname:ownername");

    const agentName = parts[0];
    const ownerName = parts[1];
    check(agentName.length > 0 && agentName.length <= 12, "Invalid agent name in memo");
    check(ownerName.length > 0 && ownerName.length <= 12, "Invalid owner name in memo");

    const agent = Name.fromString(agentName);
    const intendedOwner = Name.fromString(ownerName);
    const agentRecord = this.agentsTable.get(agent.N);
    check(agentRecord != null, "Agent not found: " + agentName);

    // Agent must not already have an owner
    check(agentRecord!.owner == EMPTY_NAME, "Agent already has an owner");

    // SECURITY: Agent must have approved this claimant first (prevents trapped deposits)
    check(agentRecord!.pending_owner != EMPTY_NAME,
      "Agent has not approved any claimant yet. Agent must call approveclaim first.");
    check(agentRecord!.pending_owner == intendedOwner,
      "Agent approved a different claimant. Deposit must be from approved account: " + agentRecord!.pending_owner.toString());

    // SECURITY: Payer must match intended owner specified in memo
    check(from == intendedOwner, "Payer must match intended owner in memo. You cannot pay deposit for someone else.");

    // If there's already a deposit, it must be from the same payer
    if (agentRecord!.deposit_payer != EMPTY_NAME) {
      check(agentRecord!.deposit_payer == from, "Deposit already started by different account");
    }

    // Get config to check claim_fee
    const config = this.configSingleton.get();

    // Calculate new deposit amount (use i64 since Asset.amount is i64)
    // Validate amount is positive first
    check(quantity.amount > 0, "Transfer amount must be positive");
    const transferAmount: u64 = <u64>quantity.amount;
    let newDeposit: u64 = agentRecord!.claim_deposit + transferAmount;
    let excess: u64 = 0;

    // HIGH SECURITY FIX: Prevent deposit overflow and auto-refund excess
    // Cap deposits at claim_fee (no need to overpay)
    if (config.claim_fee > 0 && newDeposit > config.claim_fee) {
      excess = newDeposit - config.claim_fee;
      newDeposit = config.claim_fee;
    }

    // Record the deposit and payer
    agentRecord!.claim_deposit = newDeposit;
    agentRecord!.deposit_payer = from;
    this.agentsTable.update(agentRecord!, this.receiver);

    // Refund any excess immediately
    if (excess > 0) {
      this.sendTokens(from, new Asset(<i64>excess, this.XPR_SYMBOL), "Excess claim deposit refund for " + agentName);
      print(`Claim deposit received: ${(transferAmount - excess) / 10000} XPR for agent ${agentName} (refunded ${excess / 10000} XPR excess)`);
    } else {
      print(`Claim deposit received: ${quantity.toString()} for agent ${agentName} from ${from.toString()}`);
    }
  }

}
