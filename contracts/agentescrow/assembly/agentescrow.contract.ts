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

// ============== JOB STATES ==============
// 0 = CREATED    - Job created, awaiting funding
// 1 = FUNDED     - Client has deposited funds
// 2 = ACCEPTED   - Agent has accepted the job
// 3 = INPROGRESS - Work is being done
// 4 = DELIVERED  - Agent claims work is complete
// 5 = DISPUTED   - Either party has raised a dispute
// 6 = COMPLETED  - Job finished, payment released
// 7 = REFUNDED   - Job cancelled, client refunded
// 8 = ARBITRATED - Resolved by arbitrator

// ============== TABLES ==============

@table("jobs")
export class Job extends Table {
  constructor(
    public id: u64 = 0,
    public client: Name = EMPTY_NAME,           // Who is paying
    public agent: Name = EMPTY_NAME,            // Who is doing the work
    public title: string = "",
    public description: string = "",
    public deliverables: string = "",           // JSON array of expected deliverables
    public amount: u64 = 0,                     // Total payment amount
    public symbol: string = "XPR",              // Payment token symbol
    public funded_amount: u64 = 0,              // Amount deposited
    public released_amount: u64 = 0,            // Amount released to agent
    public state: u8 = 0,                       // Job state
    public deadline: u64 = 0,                   // Unix timestamp
    public arbitrator: Name = EMPTY_NAME,       // Optional arbitrator
    public job_hash: string = "",               // Hash for linking to off-chain agreement
    public created_at: u64 = 0,
    public updated_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byClient(): u64 {
    return this.client.N;
  }

  set byClient(value: u64) {
    this.client = Name.fromU64(value);
  }

  @secondary
  get byAgent(): u64 {
    return this.agent.N;
  }

  set byAgent(value: u64) {
    this.agent = Name.fromU64(value);
  }

  // Note: No secondary index on state - u8 to u64 conversion causes WASM validation issues
  // Use getBySecondaryU64 on byClient or byAgent instead and filter by state in code
}

@table("milestones")
export class Milestone extends Table {
  constructor(
    public id: u64 = 0,
    public job_id: u64 = 0,
    public title: string = "",
    public description: string = "",
    public amount: u64 = 0,                     // Amount for this milestone
    public order: u8 = 0,                       // Milestone order (1, 2, 3...)
    public state: u8 = 0,                       // 0=pending, 1=submitted, 2=approved, 3=disputed
    public evidence_uri: string = "",           // Proof of completion
    public submitted_at: u64 = 0,
    public approved_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byJob(): u64 {
    return this.job_id;
  }

  set byJob(value: u64) {
    this.job_id = value;
  }
}

@table("disputes")
export class EscrowDispute extends Table {
  constructor(
    public id: u64 = 0,
    public job_id: u64 = 0,
    public raised_by: Name = EMPTY_NAME,
    public reason: string = "",
    public evidence_uri: string = "",
    public client_amount: u64 = 0,              // Proposed split for client
    public agent_amount: u64 = 0,               // Proposed split for agent
    public resolution: u8 = 0,                  // 0=pending, 1=client wins, 2=agent wins, 3=split
    public resolver: Name = EMPTY_NAME,
    public resolution_notes: string = "",
    public created_at: u64 = 0,
    public resolved_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byJob(): u64 {
    return this.job_id;
  }

  set byJob(value: u64) {
    this.job_id = value;
  }
}

@table("arbitrators")
export class Arbitrator extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public stake: u64 = 0,                      // Staked XPR for accountability
    public fee_percent: u64 = 0,                // Fee in basis points (100 = 1%)
    public total_cases: u64 = 0,
    public successful_cases: u64 = 0,           // Cases without appeal/overturn
    public active_disputes: u64 = 0,            // Count of currently active disputes
    public active: boolean = true
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

@table("config", singleton)
export class EscrowConfig extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public core_contract: Name = EMPTY_NAME,
    public feed_contract: Name = EMPTY_NAME,
    public platform_fee: u64 = 100,             // 1% platform fee (in basis points)
    public min_job_amount: u64 = 10000,         // Minimum job value (1.0000 XPR)
    public default_deadline_days: u64 = 30,
    public dispute_window: u64 = 259200,        // 3 days after delivery
    public acceptance_timeout: u64 = 604800,    // 7 days for agent to accept
    public min_arbitrator_stake: u64 = 10000000, // 1000.0000 XPR minimum stake
    public arb_unstake_delay: u64 = 604800,     // 7 days unstaking delay for arbitrators
    public paused: boolean = false
  ) {
    super();
  }
}

// CRITICAL FIX: Track arbitrator unstaking requests
@table("arbunstakes")
export class ArbUnstake extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public amount: u64 = 0,                     // Amount being unstaked
    public requested_at: u64 = 0,               // When unstake was requested
    public available_at: u64 = 0                // When withdrawal is available
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// External table reference for agent verification
// Note: Agents use system staking (eosio::voters), not contract-managed staking
@table("agents", "agentcore")
export class AgentRef extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public owner: Name = EMPTY_NAME,
    public pending_owner: Name = EMPTY_NAME,
    public name: string = "",
    public description: string = "",
    public endpoint: string = "",
    public protocol: string = "",
    public capabilities: string = "",
    public total_jobs: u64 = 0,
    public registered_at: u64 = 0,
    public active: boolean = true,
    public claim_deposit: u64 = 0,
    public deposit_payer: Name = EMPTY_NAME
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// ============== CONTRACT ==============

@contract
export class AgentEscrowContract extends Contract {
  private jobsTable: TableStore<Job> = new TableStore<Job>(this.receiver);
  private milestonesTable: TableStore<Milestone> = new TableStore<Milestone>(this.receiver);
  private disputesTable: TableStore<EscrowDispute> = new TableStore<EscrowDispute>(this.receiver);
  private arbitratorsTable: TableStore<Arbitrator> = new TableStore<Arbitrator>(this.receiver);
  private arbUnstakesTable: TableStore<ArbUnstake> = new TableStore<ArbUnstake>(this.receiver);
  private configSingleton: Singleton<EscrowConfig> = new Singleton<EscrowConfig>(this.receiver);

  // Helper to get agent from configured core contract
  private getAgentRef(agent: Name): AgentRef | null {
    const config = this.configSingleton.get();
    const agentRefTable = new TableStore<AgentRef>(config.core_contract, config.core_contract);
    return agentRefTable.get(agent.N);
  }

  private requireAgentRef(agent: Name): AgentRef {
    const agentRef = this.getAgentRef(agent);
    check(agentRef != null, "Agent not registered in agentcore");
    return agentRef!;
  }

  private readonly XPR_SYMBOL: Symbol = new Symbol("XPR", 4);
  private readonly TOKEN_CONTRACT: Name = Name.fromString("eosio.token");

  // ============== INITIALIZATION ==============

  @action("init")
  init(owner: Name, core_contract: Name, feed_contract: Name, platform_fee: u64): void {
    requireAuth(this.receiver);

    // EscrowConfig: owner, core_contract, feed_contract, platform_fee, min_job_amount,
    //               default_deadline_days, dispute_window, acceptance_timeout, min_arbitrator_stake, paused
    const config = new EscrowConfig(
      owner,
      core_contract,
      feed_contract,
      platform_fee,
      10000,       // min_job_amount (1.0000 XPR)
      30,          // default_deadline_days
      259200,      // dispute_window (3 days)
      604800,      // acceptance_timeout (7 days)
      10000000,    // min_arbitrator_stake (1000.0000 XPR)
      false        // paused
    );
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(
    platform_fee: u64,
    min_job_amount: u64,
    default_deadline_days: u64,
    dispute_window: u64,
    paused: boolean
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    // Validate all config parameters
    check(platform_fee <= 1000, "Platform fee cannot exceed 10%");
    check(min_job_amount > 0, "Minimum job amount must be positive");
    check(default_deadline_days >= 1 && default_deadline_days <= 365, "Default deadline must be 1-365 days");
    // M15 FIX: Enforce minimum and maximum dispute window
    check(dispute_window >= 86400, "Dispute window must be at least 1 day (86400 seconds)");
    check(dispute_window <= 2592000, "Dispute window cannot exceed 30 days (2592000 seconds)");

    config.platform_fee = platform_fee;
    config.min_job_amount = min_job_amount;
    config.default_deadline_days = default_deadline_days;
    config.dispute_window = dispute_window;
    config.paused = paused;

    this.configSingleton.set(config, this.receiver);
  }

  @action("setowner")
  setOwner(new_owner: Name): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);
    check(isAccount(new_owner), "New owner account does not exist");
    config.owner = new_owner;
    this.configSingleton.set(config, this.receiver);
  }

  // ============== JOB LIFECYCLE ==============

  @action("createjob")
  createJob(
    client: Name,
    agent: Name,
    title: string,
    description: string,
    deliverables: string,
    amount: u64,
    symbol: string,
    deadline: u64,
    arbitrator: Name,
    job_hash: string
  ): void {
    requireAuth(client);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(isAccount(agent), "Agent account does not exist");
    check(client != agent, "Client and agent must be different");
    check(title.length > 0 && title.length <= 128, "Title must be 1-128 characters");
    // Add validation for description and deliverables
    check(description.length > 0 && description.length <= 2048, "Description must be 1-2048 characters");
    check(deliverables.length > 0 && deliverables.length <= 2048, "Deliverables must be 1-2048 characters");
    check(job_hash.length <= 128, "Job hash must be <= 128 characters");
    check(amount >= config.min_job_amount, "Amount below minimum");

    // SECURITY: Verify agent exists in agentcore registry (uses config.core_contract)
    const agentRef = this.requireAgentRef(agent);
    check(agentRef.active, "Agent is not active");

    // Set deadline
    let jobDeadline = deadline;
    if (jobDeadline == 0) {
      jobDeadline = currentTimeSec() + (config.default_deadline_days * 86400);
    }
    check(jobDeadline > currentTimeSec(), "Deadline must be in the future");

    // Validate arbitrator if specified
    if (arbitrator != EMPTY_NAME) {
      const arb = this.arbitratorsTable.get(arbitrator.N);
      check(arb != null && arb.active, "Invalid arbitrator");
    }

    const job = new Job(
      this.jobsTable.availablePrimaryKey,
      client,
      agent,
      title,
      description,
      deliverables,
      amount,
      symbol,
      0, // funded_amount
      0, // released_amount
      0, // state = CREATED
      jobDeadline,
      arbitrator,
      job_hash,
      currentTimeSec(),
      currentTimeSec()
    );

    this.jobsTable.store(job, this.receiver);

    print(`Job ${job.id} created: ${title}`);
  }

  @action("addmilestone")
  addMilestone(
    client: Name,
    job_id: u64,
    title: string,
    description: string,
    amount: u64,
    order: u8
  ): void {
    requireAuth(client);

    // NEW FIX: Validate milestone title and description
    check(title.length > 0 && title.length <= 128, "Title must be 1-128 characters");
    check(description.length > 0 && description.length <= 2048, "Description must be 1-2048 characters");

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.client == client, "Only client can add milestones");
    check(job.state == 0, "Can only add milestones to unfunded jobs");

    // Validate total milestone amounts don't exceed job amount
    let existingMilestone = this.milestonesTable.getBySecondaryU64(job_id, 0);
    let totalMilestoneAmount: u64 = amount;
    while (existingMilestone != null) {
      const ms = existingMilestone!;
      // SECURITY: Overflow check before accumulating milestone amounts
      check(
        totalMilestoneAmount <= U64.MAX_VALUE - ms.amount,
        "Milestone sum would overflow"
      );
      totalMilestoneAmount += ms.amount;
      existingMilestone = this.milestonesTable.nextBySecondaryU64(ms, 0);
      if (existingMilestone != null && existingMilestone!.job_id != job_id) { existingMilestone = null; }
    }
    check(totalMilestoneAmount <= job.amount, "Milestone total exceeds job amount");

    const milestone = new Milestone(
      this.milestonesTable.availablePrimaryKey,
      job_id,
      title,
      description,
      amount,
      order,
      0, // pending
      "",
      0,
      0
    );

    this.milestonesTable.store(milestone, this.receiver);
  }

  @action("acceptjob")
  acceptJob(agent: Name, job_id: u64): void {
    requireAuth(agent);

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.agent == agent, "Only assigned agent can accept");
    check(job.state == 1, "Job must be funded to accept");

    job.state = 2; // ACCEPTED
    job.updated_at = currentTimeSec();

    this.jobsTable.update(job, this.receiver);

    print(`Job ${job_id} accepted by ${agent.toString()}`);
  }

  @action("startjob")
  startJob(agent: Name, job_id: u64): void {
    requireAuth(agent);

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.agent == agent, "Only assigned agent can start");
    check(job.state == 2, "Job must be accepted to start");

    job.state = 3; // INPROGRESS
    job.updated_at = currentTimeSec();

    this.jobsTable.update(job, this.receiver);
  }

  @action("submitmile")
  submitMilestone(agent: Name, milestone_id: u64, evidence_uri: string): void {
    requireAuth(agent);

    // NEW FIX: Validate evidence URI
    check(evidence_uri.length > 0 && evidence_uri.length <= 2048, "Evidence URI must be 1-2048 characters");

    const milestone = this.milestonesTable.requireGet(milestone_id, "Milestone not found");
    const job = this.jobsTable.requireGet(milestone.job_id, "Job not found");

    check(job.agent == agent, "Only assigned agent can submit");
    check(job.state == 3, "Job must be in progress");
    check(milestone.state == 0, "Milestone already submitted");

    milestone.state = 1; // submitted
    milestone.evidence_uri = evidence_uri;
    milestone.submitted_at = currentTimeSec();

    this.milestonesTable.update(milestone, this.receiver);
  }

  @action("approvemile")
  approveMilestone(client: Name, milestone_id: u64): void {
    requireAuth(client);

    const milestone = this.milestonesTable.requireGet(milestone_id, "Milestone not found");
    const job = this.jobsTable.requireGet(milestone.job_id, "Job not found");

    check(job.client == client, "Only client can approve");
    check(milestone.state == 1, "Milestone must be submitted");

    // M13 FIX: Enforce milestone order - all prior milestones must be approved first
    let priorMilestone = this.milestonesTable.getBySecondaryU64(milestone.job_id, 0);
    while (priorMilestone != null) {
      const pm = priorMilestone!;
      if (pm.job_id == milestone.job_id && pm.order < milestone.order) {
        check(pm.state == 2, `Milestone "${pm.title}" (order ${pm.order}) must be approved first`);
      }
      priorMilestone = this.milestonesTable.nextBySecondaryU64(pm, 0);
      if (priorMilestone != null && priorMilestone!.job_id != milestone.job_id) { priorMilestone = null; }
    }

    milestone.state = 2; // approved
    milestone.approved_at = currentTimeSec();

    this.milestonesTable.update(milestone, this.receiver);

    // Release milestone payment to agent
    this.releasePayment(job, milestone.amount);
  }

  @action("deliver")
  deliverJob(agent: Name, job_id: u64, evidence_uri: string): void {
    requireAuth(agent);

    // MEDIUM FIX: Validate evidence_uri for consistency with other actions
    check(evidence_uri.length <= 2048, "Evidence URI must be <= 2048 characters");

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.agent == agent, "Only assigned agent can deliver");
    check(job.state == 3, "Job must be in progress");

    job.state = 4; // DELIVERED
    job.updated_at = currentTimeSec();

    this.jobsTable.update(job, this.receiver);

    print(`Job ${job_id} delivered`);
  }

  @action("approve")
  approveDelivery(client: Name, job_id: u64): void {
    requireAuth(client);

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.client == client, "Only client can approve");
    check(job.state == 4, "Job must be delivered");

    // CRITICAL FIX: Check if job has milestones - all must be approved first
    let milestone = this.milestonesTable.getBySecondaryU64(job_id, 0);
    while (milestone != null) {
      const ms = milestone!;
      check(
        ms.state == 2, // 2 = approved
        `Milestone "${ms.title}" must be approved before final delivery approval`
      );
      milestone = this.milestonesTable.nextBySecondaryU64(ms, 0);
      if (milestone != null && milestone!.job_id != job_id) { milestone = null; }
    }

    // Release remaining funds to agent
    const remainingAmount = job.funded_amount - job.released_amount;
    this.releasePayment(job, remainingAmount);

    job.state = 6; // COMPLETED
    job.updated_at = currentTimeSec();

    this.jobsTable.update(job, this.receiver);

    // CRITICAL FIX: Increment agent's job count in agentcore
    this.incrementAgentJobs(job.agent);

    print(`Job ${job_id} completed`);
  }

  // ============== DISPUTES ==============

  @action("dispute")
  raiseDispute(
    raised_by: Name,
    job_id: u64,
    reason: string,
    evidence_uri: string
  ): void {
    requireAuth(raised_by);

    const config = this.configSingleton.get();
    const job = this.jobsTable.requireGet(job_id, "Job not found");

    check(
      raised_by == job.client || raised_by == job.agent,
      "Only client or agent can raise dispute"
    );
    check(
      job.state == 3 || job.state == 4,
      "Can only dispute in-progress or delivered jobs"
    );
    check(reason.length > 0 && reason.length <= 512, "Reason must be 1-512 characters");
    // NEW FIX: Validate evidence URI
    check(evidence_uri.length <= 2048, "Evidence URI must be <= 2048 characters");

    // Check dispute window for delivered jobs
    if (job.state == 4) {
      check(
        currentTimeSec() <= job.updated_at + config.dispute_window,
        "Dispute window expired"
      );
    }

    // H9 FIX: Check if dispute already exists for this job
    let existingDispute: EscrowDispute | null = this.disputesTable.getBySecondaryU64(job_id, 0);
    while (existingDispute != null) {
      const dispute = existingDispute!;
      check(dispute.resolution != 0, "Job already has an active dispute");
      const nextDispute = this.disputesTable.nextBySecondaryU64(dispute, 0);
      existingDispute = (nextDispute != null && nextDispute.job_id == job_id) ? nextDispute : null;
    }

    job.state = 5; // DISPUTED
    job.updated_at = currentTimeSec();
    this.jobsTable.update(job, this.receiver);

    // Increment active_disputes counter on the assigned arbitrator
    if (job.arbitrator != EMPTY_NAME) {
      const arb = this.arbitratorsTable.get(job.arbitrator.N);
      if (arb != null) {
        arb.active_disputes += 1;
        this.arbitratorsTable.update(arb, this.receiver);
      }
    }

    const dispute = new EscrowDispute(
      this.disputesTable.availablePrimaryKey,
      job_id,
      raised_by,
      reason,
      evidence_uri,
      0,
      0,
      0, // pending
      EMPTY_NAME,
      "",
      currentTimeSec(),
      0
    );

    this.disputesTable.store(dispute, this.receiver);

    print(`Dispute raised for job ${job_id}`);
  }

  @action("arbitrate")
  arbitrateDispute(
    arbitrator: Name,
    dispute_id: u64,
    client_percent: u64,
    resolution_notes: string
  ): void {
    // SECURITY FIX: requireAuth must come BEFORE permission checks to prevent
    // unauthorized users from causing the permission check to fail first
    requireAuth(arbitrator);

    const dispute = this.disputesTable.requireGet(dispute_id, "Dispute not found");
    const job = this.jobsTable.requireGet(dispute.job_id, "Job not found");

    // Verify arbitrator is authorized for this job
    // TRAPPED FUNDS FIX: If job has no designated arbitrator, allow contract owner as fallback
    const config = this.configSingleton.get();
    let isOwnerFallback = false;
    let arb: Arbitrator | null = null;

    if (job.arbitrator == EMPTY_NAME) {
      // No arbitrator assigned - owner fallback
      check(arbitrator == config.owner, "No arbitrator assigned. Only contract owner can resolve.");
      isOwnerFallback = true;
    } else if (job.arbitrator == arbitrator) {
      // Designated arbitrator is resolving
      arb = this.arbitratorsTable.requireGet(arbitrator.N, "Arbitrator not registered");
      check(arb!.active, "Arbitrator is not active");
      check(arb!.stake >= config.min_arbitrator_stake, "Arbitrator has insufficient stake");
    } else if (arbitrator == config.owner) {
      // AUDIT FIX: Owner fallback for when designated arbitrator is unavailable
      // (deactivated, insufficient stake, or otherwise unable to resolve)
      // This prevents funds from being permanently locked in disputed jobs
      const designatedArb = this.arbitratorsTable.get(job.arbitrator.N);
      const arbUnavailable = designatedArb == null
        || !designatedArb!.active
        || designatedArb!.stake < config.min_arbitrator_stake;
      check(arbUnavailable, "Designated arbitrator is available. Owner fallback not needed.");
      isOwnerFallback = true;
    } else {
      check(false, "Not authorized to arbitrate this job");
    }

    check(dispute.resolution == 0, "Dispute already resolved");
    // AUDIT FIX: Explicit state check for defense-in-depth
    check(job.state == 5, "Job must be in DISPUTED state");
    check(client_percent <= 100, "Invalid percentage");

    // M14 FIX: Require resolution notes for audit trail
    check(
      resolution_notes.length > 0 && resolution_notes.length <= 1024,
      "Resolution notes must be 1-1024 characters with clear reasoning"
    );

    // H5 FIX: Verify job state consistency
    check(job.funded_amount >= job.released_amount, "Invalid job state");
    const remainingAmount = job.funded_amount - job.released_amount;

    // Calculate and deduct arbitrator fee (no fee for owner fallback)
    let arbFee: u64 = 0;
    let amountAfterFee = remainingAmount;

    if (!isOwnerFallback && arb != null && arb!.fee_percent > 0) {
      // H3 FIX: Runtime validation of arbitrator fee cap (guards against corrupted records)
      check(arb!.fee_percent <= 500, "Invalid arbitrator fee");
      // H5/NEW FIX: Overflow check before fee calculation
      check(
        remainingAmount <= U64.MAX_VALUE / arb!.fee_percent,
        "Arbitrator fee calculation would overflow"
      );
      arbFee = (remainingAmount * arb!.fee_percent) / 10000;
      // H5 FIX: Ensure arbFee doesn't exceed remaining (defensive check)
      check(arbFee <= remainingAmount, "Arbitrator fee exceeds remaining amount");
      amountAfterFee = remainingAmount - arbFee;
    }

    // Split remaining amount between client and agent
    const clientAmount = (amountAfterFee * client_percent) / 100;
    const agentAmount = amountAfterFee - clientAmount;

    // P3 FIX (CEI PATTERN): Update ALL state BEFORE any external calls
    // This prevents reentrancy and ensures consistent state

    // Update dispute
    dispute.client_amount = clientAmount;
    dispute.agent_amount = agentAmount;
    dispute.resolution = client_percent == 100 ? 1 : (client_percent == 0 ? 2 : 3);
    dispute.resolver = arbitrator;
    dispute.resolution_notes = resolution_notes;
    dispute.resolved_at = currentTimeSec();
    this.disputesTable.update(dispute, this.receiver);

    // Update job state BEFORE token transfers
    job.state = 8; // ARBITRATED
    job.released_amount = job.funded_amount;
    job.updated_at = currentTimeSec();
    this.jobsTable.update(job, this.receiver);

    // Update arbitrator stats (only for registered arbitrators, not owner fallback)
    if (!isOwnerFallback && arb != null) {
      arb!.total_cases += 1;
      arb!.successful_cases += 1;
      if (arb!.active_disputes > 0) {
        arb!.active_disputes -= 1;
      }
      this.arbitratorsTable.update(arb!, this.receiver);
    } else if (isOwnerFallback) {
      // Decrement active_disputes on the designated arbitrator (if any) even for owner fallback
      if (job.arbitrator != EMPTY_NAME) {
        const designatedArb = this.arbitratorsTable.get(job.arbitrator.N);
        if (designatedArb != null && designatedArb.active_disputes > 0) {
          designatedArb.active_disputes -= 1;
          this.arbitratorsTable.update(designatedArb, this.receiver);
        }
      }
    }

    // Now safe to make external calls after all state is finalized
    // Process payments - arbitrator fee first
    if (arbFee > 0) {
      this.sendTokens(arbitrator, new Asset(arbFee, this.XPR_SYMBOL), `Arbitration fee for job ${job.id}`);
    }
    if (clientAmount > 0) {
      this.sendTokens(job.client, new Asset(clientAmount, this.XPR_SYMBOL), "Dispute refund");
    }
    if (agentAmount > 0) {
      this.sendTokens(job.agent, new Asset(agentAmount, this.XPR_SYMBOL), "Dispute payment");
      // CRITICAL FIX: If agent received payment, count as completed job
      this.incrementAgentJobs(job.agent);
    }

    print(`Dispute ${dispute_id} resolved: ${client_percent}% to client, ${arbFee} arbitration fee`);
  }

  // ============== CANCELLATION & REFUND ==============

  @action("cancel")
  cancelJob(client: Name, job_id: u64): void {
    requireAuth(client);

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(job.client == client, "Only client can cancel");
    check(job.state <= 1, "Can only cancel unfunded or funded jobs before acceptance");

    // Store refund amount before state changes
    const refundAmount = job.funded_amount;

    // P3 FIX (CEI PATTERN): Update all state BEFORE external calls

    // Delete all milestones associated with this job
    let milestoneCount: u64 = 0;
    let milestoneToDelete = this.milestonesTable.getBySecondaryU64(job_id, 0);
    while (milestoneToDelete != null && milestoneToDelete!.job_id == job_id) {
      const ms = milestoneToDelete!;
      this.milestonesTable.remove(ms);
      milestoneCount++;
      // Get next milestone (after removal, need to re-query)
      milestoneToDelete = this.milestonesTable.getBySecondaryU64(job_id, 0);
    }

    // Update job state BEFORE token transfer
    job.state = 7; // REFUNDED
    job.updated_at = currentTimeSec();
    this.jobsTable.update(job, this.receiver);

    // Now safe to make external calls after all state is finalized
    if (refundAmount > 0) {
      this.sendTokens(job.client, new Asset(refundAmount, this.XPR_SYMBOL), "Job cancelled - refund");
    }

    print(`Job ${job_id} cancelled, ${milestoneCount} milestones deleted`);
  }

  @action("timeout")
  claimTimeout(claimer: Name, job_id: u64): void {
    // C4 FIX: Require auth upfront before revealing job state
    requireAuth(claimer);

    // AUDIT FIX: Check pause state to prevent fund extraction during emergencies
    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const job = this.jobsTable.requireGet(job_id, "Job not found");
    check(currentTimeSec() > job.deadline, "Deadline not reached");
    check(job.state >= 1 && job.state <= 4, "Invalid job state for timeout");

    const remainingAmount = job.funded_amount - job.released_amount;

    if (job.state == 4) {
      // Delivered but not approved - auto-approve after deadline
      check(claimer == job.agent, "Only agent can claim delivered job timeout");
      // CRITICAL FIX: Use releasePayment to ensure platform fees are deducted
      // Note: releasePayment already follows CEI (state update before token transfer)
      this.releasePayment(job, remainingAmount);
      job.state = 6; // COMPLETED
      job.updated_at = currentTimeSec();
      this.jobsTable.update(job, this.receiver);
      // CRITICAL FIX: Increment agent's job count
      this.incrementAgentJobs(job.agent);
    } else {
      // Not delivered - refund client
      check(claimer == job.client, "Only client can claim undelivered job timeout");

      // P3 FIX (CEI PATTERN): Update state BEFORE token transfer
      job.state = 7; // REFUNDED
      job.released_amount = job.funded_amount;
      job.updated_at = currentTimeSec();
      this.jobsTable.update(job, this.receiver);

      // Now safe to send refund after state is finalized
      this.sendTokens(job.client, new Asset(remainingAmount, this.XPR_SYMBOL), "Timeout refund");
    }

    print(`Job ${job_id} timeout claimed`);
  }

  @action("accpttimeout")
  claimAcceptanceTimeout(client: Name, job_id: u64): void {
    requireAuth(client);

    const config = this.configSingleton.get();
    // AUDIT FIX: Check pause state to prevent fund extraction during emergencies
    check(!config.paused, "Contract is paused");

    const job = this.jobsTable.requireGet(job_id, "Job not found");

    check(job.client == client, "Only client can claim acceptance timeout");
    check(job.state == 1, "Job must be in FUNDED state");
    check(
      currentTimeSec() > job.updated_at + config.acceptance_timeout,
      "Acceptance timeout not reached"
    );

    // Store refund amount before state changes
    const refundAmount = job.funded_amount;

    // P3 FIX (CEI PATTERN): Update state BEFORE token transfer
    job.state = 7; // REFUNDED
    job.released_amount = job.funded_amount;
    job.updated_at = currentTimeSec();
    this.jobsTable.update(job, this.receiver);

    // Now safe to send refund after state is finalized
    if (refundAmount > 0) {
      this.sendTokens(job.client, new Asset(refundAmount, this.XPR_SYMBOL), "Acceptance timeout refund");
    }

    print(`Job ${job_id} refunded due to acceptance timeout`);
  }

  // ============== ARBITRATOR MANAGEMENT ==============

  @action("regarb")
  registerArbitrator(account: Name, fee_percent: u64): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    check(isAccount(account), "Account does not exist");
    check(fee_percent <= 500, "Fee cannot exceed 5%");

    const existing = this.arbitratorsTable.get(account.N);
    if (existing == null) {
      // New arbitrator - starts with 0 stake, must stake via transfer
      const arb = new Arbitrator(account, 0, fee_percent, 0, 0, 0, false);
      this.arbitratorsTable.store(arb, this.receiver);
      print(`Arbitrator ${account.toString()} registered. Stake required: ${config.min_arbitrator_stake}`);
    } else {
      existing.fee_percent = fee_percent;
      this.arbitratorsTable.update(existing, this.receiver);
    }
  }

  @action("activatearb")
  activateArbitrator(account: Name): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    const arb = this.arbitratorsTable.requireGet(account.N, "Arbitrator not found");

    check(arb.stake >= config.min_arbitrator_stake, "Insufficient arbitrator stake");
    arb.active = true;
    this.arbitratorsTable.update(arb, this.receiver);
  }

  @action("deactarb")
  deactivateArbitrator(account: Name): void {
    requireAuth(account);

    const arb = this.arbitratorsTable.requireGet(account.N, "Arbitrator not found");
    arb.active = false;
    this.arbitratorsTable.update(arb, this.receiver);
  }

  /**
   * CRITICAL FIX: Request to unstake arbitrator funds.
   * Starts a time-delayed withdrawal process.
   * Arbitrator must be deactivated and have no pending disputes.
   *
   * @param account - Arbitrator account
   * @param amount - Amount to unstake (must be <= current stake)
   */
  @action("unstakearb")
  unstakeArbitrator(account: Name, amount: u64): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    const arb = this.arbitratorsTable.requireGet(account.N, "Arbitrator not found");

    // Must be deactivated to unstake (prevents unstaking while actively arbitrating)
    check(!arb.active, "Deactivate arbitrator before unstaking");

    // Validate amount
    check(amount > 0, "Amount must be positive");
    check(amount <= arb.stake, "Cannot unstake more than current stake");

    // Check for pending disputes assigned to this arbitrator
    check(arb.active_disputes == 0, "Cannot unstake while assigned to pending disputes");

    // Check for existing unstake request
    let unstakeRecord = this.arbUnstakesTable.get(account.N);
    const now = currentTimeSec();

    if (unstakeRecord == null) {
      // Create new unstake request
      unstakeRecord = new ArbUnstake(
        account,
        amount,
        now,
        now + config.arb_unstake_delay
      );
      this.arbUnstakesTable.store(unstakeRecord, this.receiver);
    } else {
      // Update existing request (adds to pending amount, resets timer)
      // Overflow check
      check(
        unstakeRecord.amount <= U64.MAX_VALUE - amount,
        "Unstake amount would overflow"
      );
      unstakeRecord.amount += amount;
      unstakeRecord.requested_at = now;
      unstakeRecord.available_at = now + config.arb_unstake_delay;
      this.arbUnstakesTable.update(unstakeRecord, this.receiver);
    }

    // Reduce stake immediately (locked in unstake record)
    arb.stake -= amount;
    this.arbitratorsTable.update(arb, this.receiver);

    print(`Arbitrator ${account.toString()} unstaking ${amount / 10000} XPR. Available at: ${unstakeRecord.available_at}`);
  }

  /**
   * CRITICAL FIX: Withdraw unstaked arbitrator funds after delay period.
   *
   * @param account - Arbitrator account
   */
  @action("withdrawarb")
  withdrawArbitratorStake(account: Name): void {
    requireAuth(account);

    const unstakeRecord = this.arbUnstakesTable.requireGet(account.N, "No pending unstake request");
    const now = currentTimeSec();

    check(now >= unstakeRecord.available_at, "Unstake delay not complete. Available at: " + unstakeRecord.available_at.toString());

    const withdrawAmount = unstakeRecord.amount;

    // Remove unstake record
    this.arbUnstakesTable.remove(unstakeRecord);

    // Send tokens
    this.sendTokens(account, new Asset(withdrawAmount, this.XPR_SYMBOL), "Arbitrator stake withdrawal");

    print(`Arbitrator ${account.toString()} withdrew ${withdrawAmount / 10000} XPR`);
  }

  /**
   * Cancel a pending unstake request (returns funds to active stake).
   *
   * @param account - Arbitrator account
   */
  @action("cancelunstk")
  cancelUnstake(account: Name): void {
    requireAuth(account);

    const unstakeRecord = this.arbUnstakesTable.requireGet(account.N, "No pending unstake request");
    const arb = this.arbitratorsTable.requireGet(account.N, "Arbitrator not found");

    const returnAmount = unstakeRecord.amount;

    // C1 FIX: Check for overflow before adding to stake
    check(arb.stake <= U64.MAX_VALUE - returnAmount, "Stake would overflow on cancel");

    // Return to stake
    arb.stake += returnAmount;
    this.arbitratorsTable.update(arb, this.receiver);

    // Remove unstake record
    this.arbUnstakesTable.remove(unstakeRecord);

    print(`Arbitrator ${account.toString()} cancelled unstake. Returned ${returnAmount / 10000} XPR to stake`);
  }

  // ============== TOKEN HANDLING ==============

  @action("transfer", notify)
  onTransfer(from: Name, to: Name, quantity: Asset, memo: string): void {
    if (to != this.receiver) return;
    if (from == this.receiver) return;

    check(quantity.symbol == this.XPR_SYMBOL, "Only XPR accepted");
    check(this.firstReceiver == this.TOKEN_CONTRACT, "Invalid token contract");

    // Parse memo: "fund:JOB_ID" or "arbstake"
    if (memo.startsWith("fund:")) {
      // H2 FIX: Validate memo format before parsing
      const jobIdStr = memo.substring(5);
      check(jobIdStr.length > 0 && jobIdStr.length <= 20, "Invalid job ID format");
      // Validate it contains only digits
      for (let i = 0; i < jobIdStr.length; i++) {
        const c = jobIdStr.charCodeAt(i);
        check(c >= 48 && c <= 57, "Job ID must be numeric");
      }
      const jobId = U64.parseInt(jobIdStr);

      const job = this.jobsTable.requireGet(jobId, "Job not found");
      check(job.client == from, "Only client can fund");
      check(job.state == 0, "Job already funded");
      check(<u64>quantity.amount >= job.amount, "Insufficient funding");

      // Calculate excess before state update
      const excess = quantity.amount - job.amount;

      // AUDIT FIX (CEI): Update state BEFORE external calls (sendTokens)
      // Previously the refund was dispatched before jobsTable.update
      job.funded_amount = job.amount;
      job.state = 1; // FUNDED
      job.updated_at = currentTimeSec();
      this.jobsTable.update(job, this.receiver);

      // Now safe to send refund after state is finalized
      if (excess > 0) {
        this.sendTokens(from, new Asset(excess, this.XPR_SYMBOL), `Overfunding refund for job ${jobId}`);
      }

      print(`Job ${jobId} funded with ${job.amount}. Excess refunded: ${excess}`);
    } else if (memo == "arbstake" || memo.startsWith("arbstake:")) {
      // Arbitrator staking
      const arb = this.arbitratorsTable.get(from.N);
      check(arb != null, "Register as arbitrator first");

      // AUDIT FIX: Overflow check for arbitrator staking
      check(arb!.stake <= U64.MAX_VALUE - <u64>quantity.amount, "Stake would overflow");
      arb!.stake += <u64>quantity.amount;
      this.arbitratorsTable.update(arb!, this.receiver);

      print(`Arbitrator ${from.toString()} staked ${quantity.toString()}`);
    } else {
      // Reject transfers with unrecognized memos to prevent trapped funds
      check(false, "Invalid memo. Use 'fund:JOB_ID' or 'arbstake'");
    }
  }

  // ============== HELPERS ==============

  private releasePayment(job: Job, amount: u64): void {
    if (amount == 0) return;

    // C2 FIX: Verify state consistency before calculating remaining
    check(job.funded_amount >= job.released_amount, "Invalid job state: released exceeds funded");

    // CRITICAL: Prevent releasing more than funded
    const remaining = job.funded_amount - job.released_amount;
    check(amount <= remaining, "Cannot release more than remaining funded amount");

    const config = this.configSingleton.get();

    // Calculate platform fee
    // SECURITY: Overflow check - amount * platform_fee must not overflow u64
    check(
      config.platform_fee == 0 || amount <= U64.MAX_VALUE / config.platform_fee,
      "Fee calculation would overflow"
    );
    const fee = (amount * config.platform_fee) / 10000;
    const agentAmount = amount - fee;

    // CRITICAL CEI FIX: Update state BEFORE external calls to prevent reentrancy
    // This follows the Checks-Effects-Interactions pattern
    job.released_amount += amount;
    this.jobsTable.update(job, this.receiver);

    // Now safe to make external calls after state is finalized
    // Send to agent
    this.sendTokens(job.agent, new Asset(agentAmount, this.XPR_SYMBOL), `Job ${job.id} payment`);

    // Send fee to platform (owner)
    if (fee > 0) {
      this.sendTokens(config.owner, new Asset(fee, this.XPR_SYMBOL), `Job ${job.id} platform fee`);
    }
  }

  private sendTokens(to: Name, quantity: Asset, memo: string): void {
    const TRANSFER = new InlineAction<Transfer>("transfer");
    const action = TRANSFER.act(this.TOKEN_CONTRACT, new PermissionLevel(this.receiver));
    const actionParams = new Transfer(this.receiver, to, quantity, memo);
    action.send(actionParams);
  }

  // CRITICAL FIX: Notify agentcore to increment job count when job completes
  private incrementAgentJobs(agent: Name): void {
    const config = this.configSingleton.get();
    if (config.core_contract == EMPTY_NAME) return;

    const INCJOBS = new InlineAction<IncJobs>("incjobs");
    const action = INCJOBS.act(config.core_contract, new PermissionLevel(this.receiver));
    const actionParams = new IncJobs(agent);
    action.send(actionParams);
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

// IncJobs action data for calling agentcore::incjobs
@packer
class IncJobs extends ActionData {
  constructor(
    public account: Name = EMPTY_NAME
  ) {
    super();
  }
}
