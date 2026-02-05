import {
  Name,
  Table,
  TableStore,
  Contract,
  check,
  requireAuth,
  currentTimeSec,
  hasAuth,
  print,
  EMPTY_NAME,
  Singleton
} from "proton-tsc";

// ============== TABLES ==============

@table("feedback")
export class Feedback extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public reviewer: Name = EMPTY_NAME,
    public reviewer_kyc_level: u8 = 0,
    public score: u8 = 0,
    public tags: string = "",
    public job_hash: string = "",
    public evidence_uri: string = "",
    public amount_paid: u64 = 0,
    public timestamp: u64 = 0,
    public disputed: boolean = false,
    public resolved: boolean = false
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

  @secondary
  get byReviewer(): u64 {
    return this.reviewer.N;
  }

  set byReviewer(value: u64) {
    this.reviewer = Name.fromU64(value);
  }
}

@table("agentscores")
export class AgentScore extends Table {
  constructor(
    public agent: Name = EMPTY_NAME,
    public total_score: u64 = 0,
    public total_weight: u64 = 0,
    public feedback_count: u64 = 0,
    public avg_score: u64 = 0, // Multiplied by 100 for 2 decimal precision
    public last_updated: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.agent.N;
  }
}

// Context-specific scores (addresses ERC-8004 concern about monopolistic single scores)
// Allows different trust contexts: e.g., "ai", "compute", "payment", etc.
@table("ctxscores")
export class ContextScore extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public context: string = "",              // Trust context (e.g., "ai", "compute")
    public total_score: u64 = 0,
    public total_weight: u64 = 0,
    public feedback_count: u64 = 0,
    public avg_score: u64 = 0,
    public last_updated: u64 = 0
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

// Directional trust (Alice's trust in Bob differs from Charlie's trust in Bob)
// Addresses ERC-8004 concern about directional trust relationships
@table("dirtrust")
export class DirectionalTrust extends Table {
  constructor(
    public id: u64 = 0,
    public truster: Name = EMPTY_NAME,        // The account giving trust
    public trustee: Name = EMPTY_NAME,        // The agent being trusted
    public trust_score: i64 = 0,              // Can be negative (distrust)
    public interactions: u64 = 0,             // Number of interactions
    public last_interaction: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byTruster(): u64 {
    return this.truster.N;
  }

  set byTruster(value: u64) {
    this.truster = Name.fromU64(value);
  }

  @secondary
  get byTrustee(): u64 {
    return this.trustee.N;
  }

  set byTrustee(value: u64) {
    this.trustee = Name.fromU64(value);
  }
}

// External reputation providers (addresses ERC-8004 concern about modular reputation)
// Allows indexing multiple reputation sources rather than forcing single score
@table("repproviders")
export class ReputationProvider extends Table {
  constructor(
    public id: u64 = 0,
    public name: string = "",                 // Provider name (e.g., "virtuals", "creatorbid")
    public contract: Name = EMPTY_NAME,       // Provider contract (if on-chain)
    public api_endpoint: string = "",         // Off-chain API endpoint
    public weight: u64 = 100,                 // Weight in aggregate (100 = 1.0x)
    public active: boolean = true,
    public added_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }
}

// External reputation scores from providers
@table("extscores")
export class ExternalScore extends Table {
  constructor(
    public id: u64 = 0,
    public agent: Name = EMPTY_NAME,
    public provider_id: u64 = 0,
    public score: u64 = 0,                    // Normalized 0-10000 (0-100.00%)
    public raw_score: string = "",            // Original score from provider
    public proof_uri: string = "",            // Proof/attestation URI
    public updated_at: u64 = 0
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

  @secondary
  get byProvider(): u64 {
    return this.provider_id;
  }

  set byProvider(value: u64) {
    this.provider_id = value;
  }
}

// Payment proofs - links feedback to verifiable on-chain payments
// Addresses ERC-8004 discussion about payment proof correlation
@table("payproofs")
export class PaymentProof extends Table {
  constructor(
    public id: u64 = 0,
    public feedback_id: u64 = 0,
    public payer: Name = EMPTY_NAME,
    public payee: Name = EMPTY_NAME,
    public amount: u64 = 0,
    public symbol: string = "",               // e.g., "XPR", "USDC"
    public tx_id: string = "",                // Transaction ID
    public block_num: u64 = 0,
    public verified: boolean = false,         // Whether payment was verified
    public verified_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byFeedback(): u64 {
    return this.feedback_id;
  }

  set byFeedback(value: u64) {
    this.feedback_id = value;
  }

  @secondary
  get byPayer(): u64 {
    return this.payer.N;
  }

  set byPayer(value: u64) {
    this.payer = Name.fromU64(value);
  }
}

@table("disputes")
export class Dispute extends Table {
  constructor(
    public id: u64 = 0,
    public feedback_id: u64 = 0,
    public disputer: Name = EMPTY_NAME,
    public reason: string = "",
    public evidence_uri: string = "",
    public status: u8 = 0, // 0=pending, 1=upheld, 2=rejected
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
  get byFeedback(): u64 {
    return this.feedback_id;
  }

  set byFeedback(value: u64) {
    this.feedback_id = value;
  }
}

@table("config", singleton)
export class Config extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public core_contract: Name = EMPTY_NAME,
    public min_score: u8 = 1,
    public max_score: u8 = 5,
    public dispute_window: u64 = 604800, // 7 days
    public decay_period: u64 = 2592000,  // 30 days - feedback loses weight over time
    public decay_floor: u64 = 50,        // Minimum weight floor (50 = 50%)
    public paused: boolean = false
  ) {
    super();
  }
}

// M3 FIX: Rate limiting table to prevent feedback spam
// Tracks last feedback submission per reviewer-agent pair
@table("feedbackrate")
export class FeedbackRateLimit extends Table {
  constructor(
    public id: u64 = 0,
    public reviewer: Name = EMPTY_NAME,
    public agent: Name = EMPTY_NAME,
    public last_submission: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  // Composite key: reviewer + agent
  @secondary
  get byReviewerAgent(): u64 {
    // Simple combination - XOR the two u64s
    return this.reviewer.N ^ this.agent.N;
  }

  set byReviewerAgent(value: u64) {
    // Setter required but not used for lookups
  }
}

// CRITICAL FIX: Track recalculation state to prevent incomplete pagination from corrupting scores
// When recalculating with pagination, we accumulate in this table until complete,
// then commit to agentscores only when finished.
@table("recalcstate")
export class RecalcState extends Table {
  constructor(
    public agent: Name = EMPTY_NAME,
    public total_score: u64 = 0,        // Accumulated score during recalc
    public total_weight: u64 = 0,       // Accumulated weight during recalc
    public feedback_count: u64 = 0,     // Accumulated count during recalc
    public next_offset: u64 = 0,        // Next offset to process (0 = not started or complete)
    public started_at: u64 = 0,         // When recalc started (for expiry)
    public expires_at: u64 = 0          // Recalc must complete before this time
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.agent.N;
  }
}

// External table reference for agent verification
// Note: Schema must match agentcore::agents table exactly
@table("agents", "agentcore")
export class AgentRef extends Table {
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
    // Note: Agents use system staking (eosio::voters), not contract-managed stake field
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// External table reference for KYC lookup
// CRITICAL: Schema must match eosio.proton::usersinfo exactly
@table("usersinfo", "eosio.proton")
export class UserInfo extends Table {
  constructor(
    public acc: Name = EMPTY_NAME,
    public name: string = "",
    public avatar: string = "",
    public verified: u8 = 0,              // 0 = unverified, 1 = verified (must be u8, not boolean)
    public date: u64 = 0,
    public verifiedon: u64 = 0,
    public verifier: Name = EMPTY_NAME,
    public raccs: Name[] = [],
    public aacts: string[] = [],
    public ac: u64[] = [],
    public kyc: u8[] = []                 // KYC levels array
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.acc.N;
  }
}

// ============== CONTRACT ==============

@contract
export class AgentFeedContract extends Contract {
  private feedbackTable: TableStore<Feedback> = new TableStore<Feedback>(this.receiver);
  private agentScoresTable: TableStore<AgentScore> = new TableStore<AgentScore>(this.receiver);
  private contextScoresTable: TableStore<ContextScore> = new TableStore<ContextScore>(this.receiver);
  private directionalTrustTable: TableStore<DirectionalTrust> = new TableStore<DirectionalTrust>(this.receiver);
  private reputationProvidersTable: TableStore<ReputationProvider> = new TableStore<ReputationProvider>(this.receiver);
  private externalScoresTable: TableStore<ExternalScore> = new TableStore<ExternalScore>(this.receiver);
  private paymentProofsTable: TableStore<PaymentProof> = new TableStore<PaymentProof>(this.receiver);
  private disputesTable: TableStore<Dispute> = new TableStore<Dispute>(this.receiver);
  private recalcStateTable: TableStore<RecalcState> = new TableStore<RecalcState>(this.receiver);
  private feedbackRateLimitTable: TableStore<FeedbackRateLimit> = new TableStore<FeedbackRateLimit>(this.receiver);
  private configSingleton: Singleton<Config> = new Singleton<Config>(this.receiver);

  // M3 FIX: Rate limit constant - 24 hours between feedback submissions per reviewer-agent pair
  private readonly FEEDBACK_COOLDOWN: u64 = 86400;

  // External tables
  private userInfoTable: TableStore<UserInfo> = new TableStore<UserInfo>(
    Name.fromString("eosio.proton"),
    Name.fromString("eosio.proton")
  );

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

  /**
   * C1 FIX: Ensure no active recalculation is in progress for the agent.
   * This prevents a race condition where feedback submitted during recalculation
   * would be lost when the recalculation completes and overwrites the scores.
   */
  private requireNoActiveRecalc(agent: Name): void {
    const recalcState = this.recalcStateTable.get(agent.N);
    if (recalcState != null) {
      const now = currentTimeSec();
      // Only block if recalculation is still active (not expired)
      check(
        now >= recalcState.expires_at,
        "Cannot submit feedback while recalculation is in progress. Wait for completion or expiry."
      );
    }
  }

  /**
   * M3 FIX: Enforce rate limiting - one feedback per reviewer-agent pair per cooldown period.
   * This prevents reputation spam/griefing attacks.
   */
  private checkAndUpdateRateLimit(reviewer: Name, agent: Name): void {
    const now = currentTimeSec();
    const compositeKey = reviewer.N ^ agent.N;

    // Search for existing rate limit record
    let rateLimit = this.feedbackRateLimitTable.getBySecondaryU64(compositeKey, 0);

    // Iterate to find exact match (in case of hash collisions)
    while (rateLimit != null) {
      if (rateLimit.reviewer == reviewer && rateLimit.agent == agent) {
        // Found existing record - check cooldown
        check(
          now >= rateLimit.last_submission + this.FEEDBACK_COOLDOWN,
          "Rate limit exceeded. Wait 24 hours between feedback submissions for the same agent."
        );
        // Update last submission time
        rateLimit.last_submission = now;
        this.feedbackRateLimitTable.update(rateLimit, this.receiver);
        return;
      }
      rateLimit = this.feedbackRateLimitTable.nextBySecondaryU64(rateLimit, 0);
      // Check if we've moved past matching composite keys
      if (rateLimit != null && (rateLimit.reviewer.N ^ rateLimit.agent.N) != compositeKey) {
        rateLimit = null;
      }
    }

    // No existing record - create new one
    const newRateLimit = new FeedbackRateLimit(
      this.feedbackRateLimitTable.availablePrimaryKey,
      reviewer,
      agent,
      now
    );
    this.feedbackRateLimitTable.store(newRateLimit, this.receiver);
  }

  // ============== INITIALIZATION ==============

  @action("init")
  init(owner: Name, core_contract: Name): void {
    requireAuth(this.receiver);

    // Config: owner, core_contract, min_score, max_score, dispute_window, decay_period, decay_floor, paused
    const config = new Config(
      owner,
      core_contract,
      1,        // min_score
      5,        // max_score
      604800,   // dispute_window (7 days)
      2592000,  // decay_period (30 days)
      50,       // decay_floor (50%)
      false     // paused
    );
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(
    core_contract: Name,
    min_score: u8,
    max_score: u8,
    dispute_window: u64,
    decay_period: u64,
    decay_floor: u64,
    paused: boolean
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    // H8 FIX: Validate decay parameters with minimum thresholds
    // Decay period must be at least 1 hour (3600 seconds) to prevent functional collapse
    check(decay_period >= 3600, "Decay period must be at least 3600 seconds (1 hour)");
    // C2 FIX: Enforce minimum decay_floor to ensure old feedback always has some weight
    check(decay_floor >= 10, "Decay floor must be at least 10% to preserve feedback value");
    check(decay_floor <= 100, "Decay floor cannot exceed 100%");
    // Validate score range
    check(min_score <= max_score, "min_score must be <= max_score");
    check(max_score <= 10, "max_score cannot exceed 10");

    config.core_contract = core_contract;
    config.min_score = min_score;
    config.max_score = max_score;
    config.dispute_window = dispute_window;
    config.decay_period = decay_period;
    config.decay_floor = decay_floor;
    config.paused = paused;

    this.configSingleton.set(config, this.receiver);
  }

  // ============== FEEDBACK SUBMISSION ==============

  @action("submit")
  submit(
    reviewer: Name,
    agent: Name,
    score: u8,
    tags: string,
    job_hash: string,
    evidence_uri: string,
    amount_paid: u64
  ): void {
    requireAuth(reviewer);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(reviewer != agent, "Cannot review yourself");
    check(score >= config.min_score && score <= config.max_score, "Score out of range");
    check(tags.length <= 256, "Tags too long");
    check(job_hash.length <= 128, "Job hash too long");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    // SECURITY: Verify agent exists in agentcore registry (uses config.core_contract)
    this.requireAgentRef(agent);

    // C1 FIX: Block feedback during active recalculation to prevent race condition
    // where new feedback is added but then overwritten when recalc completes
    this.requireNoActiveRecalc(agent);

    // M3 FIX: Rate limiting to prevent spam/griefing
    this.checkAndUpdateRateLimit(reviewer, agent);

    // Get reviewer's KYC level
    const kycLevel = this.getKycLevel(reviewer);

    // Create feedback record
    const feedback = new Feedback(
      this.feedbackTable.availablePrimaryKey,
      agent,
      reviewer,
      kycLevel,
      score,
      tags,
      job_hash,
      evidence_uri,
      amount_paid,
      currentTimeSec(),
      false,
      false
    );

    this.feedbackTable.store(feedback, this.receiver);

    // Update agent score
    this.updateAgentScore(agent, score, kycLevel, true);

    print(`Feedback submitted for ${agent.toString()} with score ${score}`);
  }

  @action("dispute")
  dispute(
    disputer: Name,
    feedback_id: u64,
    reason: string,
    evidence_uri: string
  ): void {
    requireAuth(disputer);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const feedback = this.feedbackTable.requireGet(feedback_id, "Feedback not found");
    check(!feedback.disputed, "Feedback already disputed");
    check(!feedback.resolved, "Feedback already resolved");

    // Only agent being reviewed or reviewer can dispute
    check(
      disputer == feedback.agent || disputer == feedback.reviewer,
      "Only agent or reviewer can dispute"
    );

    // Check dispute window
    check(
      currentTimeSec() <= feedback.timestamp + config.dispute_window,
      "Dispute window expired"
    );

    check(reason.length > 0 && reason.length <= 512, "Reason must be 1-512 characters");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    // Mark feedback as disputed
    feedback.disputed = true;
    this.feedbackTable.update(feedback, this.receiver);

    // Create dispute record
    const disputeRecord = new Dispute(
      this.disputesTable.availablePrimaryKey,
      feedback_id,
      disputer,
      reason,
      evidence_uri,
      0, // pending
      EMPTY_NAME,
      "",
      currentTimeSec(),
      0
    );

    this.disputesTable.store(disputeRecord, this.receiver);
  }

  @action("resolve")
  resolve(
    resolver: Name,
    dispute_id: u64,
    upheld: boolean,
    resolution_notes: string
  ): void {
    const config = this.configSingleton.get();
    // Only owner can resolve disputes
    // SECURITY FIX: Previously allowed any account to resolve by passing their own name
    requireAuth(config.owner);
    check(resolver == config.owner, "Resolver must be contract owner");

    // L18 FIX: Validate resolution notes length
    check(resolution_notes.length > 0 && resolution_notes.length <= 1024, "Resolution notes must be 1-1024 characters");

    const disputeRecord = this.disputesTable.requireGet(dispute_id, "Dispute not found");
    check(disputeRecord.status == 0, "Dispute already resolved");

    const feedback = this.feedbackTable.requireGet(disputeRecord.feedback_id, "Feedback not found");

    // Update dispute
    disputeRecord.status = upheld ? 1 : 2;
    disputeRecord.resolver = resolver;
    disputeRecord.resolution_notes = resolution_notes;
    disputeRecord.resolved_at = currentTimeSec();
    this.disputesTable.update(disputeRecord, this.receiver);

    // Update feedback
    feedback.resolved = true;
    this.feedbackTable.update(feedback, this.receiver);

    // If dispute upheld, remove feedback from score calculation
    if (upheld) {
      this.updateAgentScore(feedback.agent, feedback.score, feedback.reviewer_kyc_level, false);

      // FINDING 4 FIX: Also rollback context score if feedback was context-specific
      // Context feedback has tags in format "context:actual_tags"
      if (feedback.tags.includes(":")) {
        const colonIndex = feedback.tags.indexOf(":");
        const context = feedback.tags.substring(0, colonIndex);
        // Only rollback if it's a valid context
        const validContexts = ["ai", "compute", "storage", "oracle", "payment", "messaging", "data", "automation", "analytics", "security"];
        for (let i = 0; i < validContexts.length; i++) {
          if (validContexts[i] == context) {
            this.updateContextScore(feedback.agent, context, feedback.score, feedback.reviewer_kyc_level, false);
            break;
          }
        }
      }

      // FINDING 4 FIX: Also rollback directional trust
      // Directional trust adds (score - 3) as delta, so we reverse by subtracting the same
      this.reverseDirectionalTrust(feedback.reviewer, feedback.agent, feedback.score);
    }
    // Note: If dispute rejected (upheld=false), scores are already included since they were
    // added at submission time. The feedback will be included in recalculate() as well.
  }

  /**
   * FINDING 4 FIX: Reverse directional trust that was added when feedback was submitted
   * This undoes the trust delta that was applied by updateDirectionalTrust()
   */
  private reverseDirectionalTrust(truster: Name, trustee: Name, originalScore: u8): void {
    // Calculate the original delta that was added
    const originalDelta: i64 = <i64>originalScore - 3;

    // Find the directional trust record
    let existingTrust = this.directionalTrustTable.getBySecondaryU64(truster.N, 0);
    let trust: DirectionalTrust | null = null;

    while (existingTrust != null) {
      if (existingTrust.trustee == trustee) {
        trust = existingTrust;
        break;
      }
      existingTrust = this.directionalTrustTable.nextBySecondaryU64(existingTrust, 0);
      if (existingTrust != null && existingTrust.truster != truster) break;
    }

    if (trust != null) {
      // Reverse the delta (subtract what was added)
      trust.trust_score -= originalDelta;
      // Keep within bounds
      if (trust.trust_score > 1000) trust.trust_score = 1000;
      if (trust.trust_score < -1000) trust.trust_score = -1000;
      // Decrement interaction count if possible
      if (trust.interactions > 0) trust.interactions -= 1;
      this.directionalTrustTable.update(trust, this.receiver);
    }
    // If trust record doesn't exist, nothing to reverse
  }

  @action("reinstate")
  reinstateFeedback(feedback_id: u64): void {
    // SECURITY: Only contract owner can reinstate feedback
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const feedback = this.feedbackTable.requireGet(feedback_id, "Feedback not found");
    check(feedback.disputed, "Feedback was not disputed");
    check(feedback.resolved, "Dispute not yet resolved");

    // Find the dispute record to check if it was rejected
    let dispute = this.disputesTable.getBySecondaryU64(feedback_id, 0);
    let disputeRejected = false;
    while (dispute != null) {
      if (dispute.status == 2) { // status 2 = rejected
        disputeRejected = true;
        break;
      }
      dispute = this.disputesTable.nextBySecondaryU64(dispute, 0);
      if (dispute != null && dispute.feedback_id != feedback_id) break;
    }

    check(disputeRejected, "Dispute was upheld, feedback cannot be reinstated");

    // Clear the disputed flag since dispute was rejected
    feedback.disputed = false;
    this.feedbackTable.update(feedback, this.receiver);

    // Note: The score was already added when feedback was submitted.
    // This action just clears the disputed flag for clarity.
    // If a full recalculation is needed, call recalculate(agent) separately.

    print(`Feedback ${feedback_id} reinstated after rejected dispute`);
  }

  /**
   * CRITICAL FIX: Recalculate agent scores with proper pagination state tracking.
   * Prevents incomplete recalculations from corrupting agent scores.
   *
   * The recalculation process:
   * 1. First call (offset=0) creates/resets RecalcState and accumulates batch
   * 2. Subsequent calls MUST use the expected next_offset from RecalcState
   * 3. Scores are ONLY committed to agentscores when recalculation completes
   * 4. Recalculations expire after 1 hour to prevent stale state
   *
   * @param agent - The agent whose scores to recalculate
   * @param offset - Must be 0 for first call, or match next_offset for continuation
   * @param limit - Maximum feedbacks to process (max 100 per call)
   */
  @action("recalc")
  recalculate(agent: Name, offset: u64, limit: u64): void {
    // SECURITY: Only agent or contract owner can trigger recalculation
    const config = this.configSingleton.get();
    check(
      hasAuth(agent) || hasAuth(config.owner),
      "Only agent or contract owner can trigger recalculation"
    );

    // Enforce maximum limit to prevent CPU exhaustion
    const MAX_LIMIT: u64 = 100;
    check(limit > 0 && limit <= MAX_LIMIT, "Limit must be 1-100");

    const now = currentTimeSec();
    const RECALC_EXPIRY: u64 = 3600; // 1 hour to complete recalculation

    // Get or validate recalc state
    let recalcState = this.recalcStateTable.get(agent.N);

    if (offset == 0) {
      // Starting new recalculation - create or reset state
      if (recalcState == null) {
        recalcState = new RecalcState(
          agent,
          0, 0, 0,  // totals start at 0
          0,        // next_offset (will be set after processing)
          now,
          now + RECALC_EXPIRY
        );
        this.recalcStateTable.store(recalcState, this.receiver);
      } else {
        // Reset existing state for new recalculation
        recalcState.total_score = 0;
        recalcState.total_weight = 0;
        recalcState.feedback_count = 0;
        recalcState.next_offset = 0;
        recalcState.started_at = now;
        recalcState.expires_at = now + RECALC_EXPIRY;
        this.recalcStateTable.update(recalcState, this.receiver);
      }
    } else {
      // Continuing existing recalculation - validate state
      check(recalcState != null, "No recalculation in progress. Start with offset=0");
      check(now < recalcState!.expires_at, "Recalculation expired. Start over with offset=0");
      check(offset == recalcState!.next_offset,
        "Invalid offset. Expected: " + recalcState!.next_offset.toString() + ", got: " + offset.toString());
    }

    // Process feedbacks
    let fb = this.feedbackTable.getBySecondaryU64(agent.N, 0);

    // Skip to offset
    let skipped: u64 = 0;
    while (fb != null && skipped < offset) {
      const currentFb = fb!;
      fb = this.feedbackTable.nextBySecondaryU64(currentFb, 0);
      if (fb != null && fb!.agent != agent) { fb = null; }
      skipped++;
    }

    let batchScore: u64 = 0;
    let batchWeight: u64 = 0;
    let batchCount: u64 = 0;
    let processed: u64 = 0;
    let hasMore: boolean = false;

    while (fb != null && processed < limit) {
      const currentFb = fb!;
      // Skip disputed but unresolved feedback
      if (currentFb.disputed && !currentFb.resolved) {
        fb = this.feedbackTable.nextBySecondaryU64(currentFb, 0);
        if (fb != null && fb!.agent != agent) { fb = null; }
        processed++;
        continue;
      }
      // Skip upheld disputes (removed from scoring)
      if (currentFb.disputed && currentFb.resolved) {
        const dispute = this.disputesTable.getBySecondaryU64(currentFb.id, 0);
        if (dispute != null && dispute.status == 1) {
          fb = this.feedbackTable.nextBySecondaryU64(currentFb, 0);
          if (fb != null && fb!.agent != agent) { fb = null; }
          processed++;
          continue;
        }
      }

      // Calculate time-based decay factor
      const ageSeconds = now > currentFb.timestamp ? now - currentFb.timestamp : 0;
      const decayPeriods = ageSeconds / config.decay_period;
      let decayFactor: u64 = 100;
      if (decayPeriods > 0) {
        const reduction = decayPeriods * 5;
        if (reduction >= (100 - config.decay_floor)) {
          decayFactor = config.decay_floor;
        } else {
          decayFactor = 100 - reduction;
        }
      }

      const baseWeight: u64 = <u64>(1 + currentFb.reviewer_kyc_level);
      const decayedWeight: u64 = (baseWeight * decayFactor) / 100;
      batchScore += <u64>currentFb.score * decayedWeight;
      batchWeight += decayedWeight * 5;
      batchCount++;
      processed++;

      fb = this.feedbackTable.nextBySecondaryU64(currentFb, 0);
      if (fb != null && fb!.agent != agent) { fb = null; }
    }

    // Check if there are more feedbacks
    if (fb != null) {
      hasMore = true;
    }

    // Accumulate batch into recalc state with overflow protection
    check(
      recalcState!.total_score <= U64.MAX_VALUE - batchScore,
      "Score accumulation would overflow"
    );
    check(
      recalcState!.total_weight <= U64.MAX_VALUE - batchWeight,
      "Weight accumulation would overflow"
    );

    recalcState!.total_score += batchScore;
    recalcState!.total_weight += batchWeight;
    recalcState!.feedback_count += batchCount;
    recalcState!.next_offset = offset + processed;

    if (hasMore) {
      // More batches needed - save state and inform caller
      this.recalcStateTable.update(recalcState!, this.receiver);
      print(`Batch processed. Next call: recalc(${agent.toString()}, ${recalcState!.next_offset}, ${limit})`);
    } else {
      // RECALCULATION COMPLETE - commit to agentscores
      let agentScore = this.agentScoresTable.get(agent.N);

      if (agentScore == null) {
        agentScore = new AgentScore(agent, 0, 0, 0, 0, 0);
      }

      agentScore.total_score = recalcState!.total_score;
      agentScore.total_weight = recalcState!.total_weight;
      agentScore.feedback_count = recalcState!.feedback_count;

      // Calculate average
      if (agentScore.total_weight > 0) {
        check(agentScore.total_score <= U64.MAX_VALUE / 10000, "Score calculation would overflow");
        agentScore.avg_score = (agentScore.total_score * 10000) / agentScore.total_weight;
      } else {
        agentScore.avg_score = 0;
      }
      agentScore.last_updated = now;

      // Store or update agent score
      if (this.agentScoresTable.get(agent.N) == null) {
        this.agentScoresTable.store(agentScore, this.receiver);
      } else {
        this.agentScoresTable.update(agentScore, this.receiver);
      }

      // Clean up recalc state
      this.recalcStateTable.remove(recalcState!);

      print(`Recalculation COMPLETE for ${agent.toString()}. Total feedbacks: ${agentScore.feedback_count}, avg_score: ${agentScore.avg_score}`);
    }
  }

  /**
   * Cancel an in-progress recalculation.
   * Useful if recalc was started but cannot be completed.
   */
  @action("cancelrecalc")
  cancelRecalculation(agent: Name): void {
    const config = this.configSingleton.get();
    check(
      hasAuth(agent) || hasAuth(config.owner),
      "Only agent or contract owner can cancel recalculation"
    );

    const recalcState = this.recalcStateTable.get(agent.N);
    check(recalcState != null, "No recalculation in progress for this agent");

    this.recalcStateTable.remove(recalcState!);
    print(`Recalculation cancelled for ${agent.toString()}`);
  }

  /**
   * H1 FIX: Clean up expired recalculation states.
   * Anyone can call this to free up RAM from abandoned recalculations.
   */
  @action("cleanrecalc")
  cleanExpiredRecalcStates(max_clean: u64): void {
    const now = currentTimeSec();
    let cleaned: u64 = 0;

    let recalcState = this.recalcStateTable.first();
    while (recalcState != null && cleaned < max_clean) {
      const current = recalcState!;
      recalcState = this.recalcStateTable.next(current);

      if (now >= current.expires_at) {
        this.recalcStateTable.remove(current);
        cleaned++;
        print(`Cleaned expired recalc state for ${current.agent.toString()}`);
      }
    }

    print(`Cleaned ${cleaned} expired recalculation states`);
  }

  // ============== CONTEXT-SPECIFIC FEEDBACK ==============
  // Addresses ERC-8004 concern about single-metric reputation

  @action("submitctx")
  submitWithContext(
    reviewer: Name,
    agent: Name,
    context: string,
    score: u8,
    tags: string,
    job_hash: string,
    evidence_uri: string,
    amount_paid: u64
  ): void {
    requireAuth(reviewer);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(reviewer != agent, "Cannot review yourself");
    check(score >= config.min_score && score <= config.max_score, "Score out of range");
    check(context.length > 0 && context.length <= 32, "Context must be 1-32 characters");

    // Standardized context validation (prevents fragmentation like "ai" vs "AI" vs "a.i.")
    const validContexts = ["ai", "compute", "storage", "oracle", "payment", "messaging", "data", "automation", "analytics", "security"];
    let isValidContext = false;
    for (let i = 0; i < validContexts.length; i++) {
      if (validContexts[i] == context) {
        isValidContext = true;
        break;
      }
    }
    check(isValidContext, "Invalid context. Valid: ai, compute, storage, oracle, payment, messaging, data, automation, analytics, security");
    check(tags.length <= 256, "Tags too long");
    check(job_hash.length <= 128, "Job hash too long");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    // SECURITY: Verify agent exists in agentcore registry (uses config.core_contract)
    this.requireAgentRef(agent);

    // C1 FIX: Block feedback during active recalculation to prevent race condition
    // where new feedback is added but then overwritten when recalc completes
    this.requireNoActiveRecalc(agent);

    // M3 FIX: Rate limiting to prevent spam/griefing
    this.checkAndUpdateRateLimit(reviewer, agent);

    // Get reviewer's KYC level
    const kycLevel = this.getKycLevel(reviewer);

    // Create feedback record (using tags to store context as well)
    const feedback = new Feedback(
      this.feedbackTable.availablePrimaryKey,
      agent,
      reviewer,
      kycLevel,
      score,
      context + ":" + tags, // Prepend context to tags
      job_hash,
      evidence_uri,
      amount_paid,
      currentTimeSec(),
      false,
      false
    );

    this.feedbackTable.store(feedback, this.receiver);

    // Update global agent score
    this.updateAgentScore(agent, score, kycLevel, true);

    // Update context-specific score
    this.updateContextScore(agent, context, score, kycLevel, true);

    // Update directional trust (reviewer -> agent)
    this.updateDirectionalTrust(reviewer, agent, score);

    print(`Context feedback submitted for ${agent.toString()} in ${context} with score ${score}`);
  }

  @action("settrust")
  setDirectionalTrust(
    truster: Name,
    trustee: Name,
    trust_delta: i64
  ): void {
    requireAuth(truster);
    check(truster != trustee, "Cannot set trust for yourself");
    check(trust_delta >= -100 && trust_delta <= 100, "Trust delta must be -100 to 100");

    // Find or create directional trust record
    let existingTrust = this.directionalTrustTable.getBySecondaryU64(truster.N, 0);
    let trust: DirectionalTrust | null = null;

    while (existingTrust != null) {
      if (existingTrust.trustee == trustee) {
        trust = existingTrust;
        break;
      }
      existingTrust = this.directionalTrustTable.nextBySecondaryU64(existingTrust, 0);
      if (existingTrust != null && existingTrust.truster != truster) break;
    }

    if (trust == null) {
      trust = new DirectionalTrust(
        this.directionalTrustTable.availablePrimaryKey,
        truster,
        trustee,
        trust_delta,
        1,
        currentTimeSec()
      );
      this.directionalTrustTable.store(trust, this.receiver);
    } else {
      trust.trust_score += trust_delta;
      // Cap at -1000 to 1000
      if (trust.trust_score > 1000) trust.trust_score = 1000;
      if (trust.trust_score < -1000) trust.trust_score = -1000;
      trust.interactions += 1;
      trust.last_interaction = currentTimeSec();
      this.directionalTrustTable.update(trust, this.receiver);
    }
  }

  // ============== EXTERNAL REPUTATION PROVIDERS ==============
  // Addresses ERC-8004 concern about modular reputation systems

  @action("addprovider")
  addReputationProvider(
    name: string,
    contract: Name,
    api_endpoint: string,
    weight: u64
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(name.length > 0 && name.length <= 64, "Name must be 1-64 characters");
    check(api_endpoint.length <= 256, "API endpoint too long");
    check(weight > 0 && weight <= 1000, "Weight must be 1-1000");

    const provider = new ReputationProvider(
      this.reputationProvidersTable.availablePrimaryKey,
      name,
      contract,
      api_endpoint,
      weight,
      true,
      currentTimeSec()
    );

    this.reputationProvidersTable.store(provider, this.receiver);
    print(`Reputation provider added: ${name}`);
  }

  @action("setprovider")
  setProviderStatus(provider_id: u64, active: boolean, weight: u64): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const provider = this.reputationProvidersTable.requireGet(provider_id, "Provider not found");
    provider.active = active;
    provider.weight = weight;

    this.reputationProvidersTable.update(provider, this.receiver);
  }

  @action("submitext")
  submitExternalScore(
    submitter: Name,
    agent: Name,
    provider_id: u64,
    score: u64,
    raw_score: string,
    proof_uri: string
  ): void {
    // Only provider contract or owner can submit
    // SECURITY FIX: Removed hasAuth(submitter) which allowed anyone to submit fake scores
    const config = this.configSingleton.get();
    const provider = this.reputationProvidersTable.requireGet(provider_id, "Provider not found");

    const isProviderContract = provider.contract != EMPTY_NAME && hasAuth(provider.contract);
    const isOwner = hasAuth(config.owner);
    check(
      isProviderContract || isOwner,
      "Not authorized: must be provider contract or owner"
    );
    check(provider.active, "Provider is not active");
    check(score <= 10000, "Score must be 0-10000");

    // Find or create external score
    let existingScore = this.externalScoresTable.getBySecondaryU64(agent.N, 0);
    let extScore: ExternalScore | null = null;

    while (existingScore != null) {
      if (existingScore.provider_id == provider_id) {
        extScore = existingScore;
        break;
      }
      existingScore = this.externalScoresTable.nextBySecondaryU64(existingScore, 0);
      if (existingScore != null && existingScore.agent != agent) break;
    }

    if (extScore == null) {
      extScore = new ExternalScore(
        this.externalScoresTable.availablePrimaryKey,
        agent,
        provider_id,
        score,
        raw_score,
        proof_uri,
        currentTimeSec()
      );
      this.externalScoresTable.store(extScore, this.receiver);
    } else {
      extScore.score = score;
      extScore.raw_score = raw_score;
      extScore.proof_uri = proof_uri;
      extScore.updated_at = currentTimeSec();
      this.externalScoresTable.update(extScore, this.receiver);
    }

    print(`External score submitted for ${agent.toString()} from provider ${provider_id}`);
  }

  // ============== PAYMENT PROOF LINKING ==============
  // Addresses ERC-8004 discussion about payment proof correlation

  @action("submitwpay")
  submitWithPaymentProof(
    reviewer: Name,
    agent: Name,
    score: u8,
    tags: string,
    job_hash: string,
    evidence_uri: string,
    payment_tx_id: string,
    payment_amount: u64,
    payment_symbol: string
  ): void {
    requireAuth(reviewer);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(reviewer != agent, "Cannot review yourself");
    check(score >= config.min_score && score <= config.max_score, "Score out of range");
    check(payment_tx_id.length > 0 && payment_tx_id.length <= 64, "Invalid transaction ID");

    // SECURITY: Verify agent exists in agentcore registry (uses config.core_contract)
    this.requireAgentRef(agent);

    // C1 FIX: Block feedback during active recalculation to prevent race condition
    // where new feedback is added but then overwritten when recalc completes
    this.requireNoActiveRecalc(agent);

    // M3 FIX: Rate limiting to prevent spam/griefing
    this.checkAndUpdateRateLimit(reviewer, agent);

    // Get reviewer's KYC level
    const kycLevel = this.getKycLevel(reviewer);

    // Create feedback record
    const feedbackId = this.feedbackTable.availablePrimaryKey;
    const feedback = new Feedback(
      feedbackId,
      agent,
      reviewer,
      kycLevel,
      score,
      tags,
      job_hash,
      evidence_uri,
      payment_amount,
      currentTimeSec(),
      false,
      false
    );

    this.feedbackTable.store(feedback, this.receiver);

    // Create payment proof record
    const paymentProof = new PaymentProof(
      this.paymentProofsTable.availablePrimaryKey,
      feedbackId,
      reviewer,
      agent,
      payment_amount,
      payment_symbol,
      payment_tx_id,
      0, // Block num to be verified
      false,
      0
    );

    this.paymentProofsTable.store(paymentProof, this.receiver);

    // Update agent score
    this.updateAgentScore(agent, score, kycLevel, true);

    // Update directional trust
    this.updateDirectionalTrust(reviewer, agent, score);

    print(`Feedback with payment proof submitted for ${agent.toString()}`);
  }

  @action("verifypay")
  verifyPaymentProof(
    verifier: Name,
    proof_id: u64,
    block_num: u64,
    verified: boolean
  ): void {
    const config = this.configSingleton.get();
    // Only owner can verify payments
    // SECURITY FIX: Previously allowed any account to verify by passing their own name
    requireAuth(config.owner);
    check(verifier == config.owner, "Verifier must be contract owner");

    const proof = this.paymentProofsTable.requireGet(proof_id, "Payment proof not found");
    check(!proof.verified, "Already verified");

    proof.block_num = block_num;
    proof.verified = verified;
    proof.verified_at = currentTimeSec();

    this.paymentProofsTable.update(proof, this.receiver);

    // If verification failed, mark associated feedback
    if (!verified) {
      const feedback = this.feedbackTable.get(proof.feedback_id);
      if (feedback != null) {
        feedback.disputed = true;
        this.feedbackTable.update(feedback, this.receiver);
      }
    }

    print(`Payment proof ${proof_id} verification: ${verified ? "passed" : "failed"}`);
  }

  // ============== AGGREGATE TRUST SCORE ==============
  // Combines all trust signals for an agent

  @action("calcaggtrust")
  calculateAggregateTrust(agent: Name): void {
    // This action calculates and stores a comprehensive trust score
    // combining: native reputation, external scores, stake, KYC, longevity

    // Get native score
    const nativeScore = this.agentScoresTable.get(agent.N);
    let nativeAvg: u64 = 0;
    if (nativeScore != null) {
      nativeAvg = nativeScore.avg_score;
    }

    // Get external scores and calculate weighted average
    let extScoreItem = this.externalScoresTable.getBySecondaryU64(agent.N, 0);
    let extTotal: u64 = 0;
    let extWeight: u64 = 0;

    while (extScoreItem != null) {
      const provider = this.reputationProvidersTable.get(extScoreItem.provider_id);
      if (provider != null && provider.active) {
        extTotal += extScoreItem.score * provider.weight;
        extWeight += provider.weight;
      }
      extScoreItem = this.externalScoresTable.nextBySecondaryU64(extScoreItem, 0);
      if (extScoreItem != null && extScoreItem.agent != agent) break;
    }

    const extAvg: u64 = extWeight > 0 ? extTotal / extWeight : 0;

    // Combined score: 60% native, 40% external (if external exists)
    let combinedScore: u64;
    if (extWeight > 0) {
      combinedScore = (nativeAvg * 60 + extAvg * 40) / 100;
    } else {
      combinedScore = nativeAvg;
    }

    // Update or create agent score with combined value
    let agentScore = this.agentScoresTable.get(agent.N);
    if (agentScore == null) {
      agentScore = new AgentScore(agent, 0, 0, 0, combinedScore, currentTimeSec());
      this.agentScoresTable.store(agentScore, this.receiver);
    } else {
      agentScore.avg_score = combinedScore;
      agentScore.last_updated = currentTimeSec();
      this.agentScoresTable.update(agentScore, this.receiver);
    }

    print(`Aggregate trust calculated for ${agent.toString()}: ${combinedScore}`);
  }

  // ============== CONTEXT HELPERS ==============

  private updateContextScore(agent: Name, context: string, score: u8, kycLevel: u8, add: boolean): void {
    // Find existing context score
    let existingScore = this.contextScoresTable.getBySecondaryU64(agent.N, 0);
    let ctxScore: ContextScore | null = null;

    while (existingScore != null) {
      if (existingScore.context == context) {
        ctxScore = existingScore;
        break;
      }
      existingScore = this.contextScoresTable.nextBySecondaryU64(existingScore, 0);
      if (existingScore != null && existingScore.agent != agent) break;
    }

    const weight: u64 = <u64>(1 + kycLevel);
    const weightedScore: u64 = <u64>score * weight;
    const normalizedWeight: u64 = weight * 5;

    if (ctxScore == null) {
      ctxScore = new ContextScore(
        this.contextScoresTable.availablePrimaryKey,
        agent,
        context,
        add ? weightedScore : 0,
        add ? normalizedWeight : 0,
        add ? 1 : 0,
        0,
        currentTimeSec()
      );
      ctxScore.avg_score = ctxScore.total_weight > 0 ? (ctxScore.total_score * 10000) / ctxScore.total_weight : 0;
      this.contextScoresTable.store(ctxScore, this.receiver);
    } else {
      if (add) {
        // N1 FIX: Overflow protection for context score accumulation
        check(
          ctxScore.total_score <= U64.MAX_VALUE - weightedScore,
          "Context score accumulation would overflow"
        );
        check(
          ctxScore.total_weight <= U64.MAX_VALUE - normalizedWeight,
          "Context weight accumulation would overflow"
        );
        ctxScore.total_score += weightedScore;
        ctxScore.total_weight += normalizedWeight;
        ctxScore.feedback_count += 1;
      } else {
        if (ctxScore.total_score >= weightedScore) ctxScore.total_score -= weightedScore;
        else ctxScore.total_score = 0;
        if (ctxScore.total_weight >= normalizedWeight) ctxScore.total_weight -= normalizedWeight;
        else ctxScore.total_weight = 0;
        if (ctxScore.feedback_count > 0) ctxScore.feedback_count -= 1;
      }
      // N2 FIX: Overflow protection for avg_score calculation
      if (ctxScore.total_weight > 0) {
        if (ctxScore.total_score > U64.MAX_VALUE / 10000) {
          ctxScore.avg_score = (ctxScore.total_score / ctxScore.total_weight) * 10000;
        } else {
          ctxScore.avg_score = (ctxScore.total_score * 10000) / ctxScore.total_weight;
        }
      } else {
        ctxScore.avg_score = 0;
      }
      ctxScore.last_updated = currentTimeSec();
      this.contextScoresTable.update(ctxScore, this.receiver);
    }
  }

  private updateDirectionalTrust(truster: Name, trustee: Name, score: u8): void {
    // Convert 1-5 score to trust delta: 1=-2, 2=-1, 3=0, 4=1, 5=2
    const trustDelta: i64 = <i64>score - 3;

    let existingTrust = this.directionalTrustTable.getBySecondaryU64(truster.N, 0);
    let trust: DirectionalTrust | null = null;

    while (existingTrust != null) {
      if (existingTrust.trustee == trustee) {
        trust = existingTrust;
        break;
      }
      existingTrust = this.directionalTrustTable.nextBySecondaryU64(existingTrust, 0);
      if (existingTrust != null && existingTrust.truster != truster) break;
    }

    if (trust == null) {
      trust = new DirectionalTrust(
        this.directionalTrustTable.availablePrimaryKey,
        truster,
        trustee,
        trustDelta,
        1,
        currentTimeSec()
      );
      this.directionalTrustTable.store(trust, this.receiver);
    } else {
      trust.trust_score += trustDelta;
      if (trust.trust_score > 1000) trust.trust_score = 1000;
      if (trust.trust_score < -1000) trust.trust_score = -1000;
      trust.interactions += 1;
      trust.last_interaction = currentTimeSec();
      this.directionalTrustTable.update(trust, this.receiver);
    }
  }

  // ============== HELPERS ==============

  private getKycLevel(account: Name): u8 {
    const userInfo = this.userInfoTable.get(account.N);

    if (userInfo == null) return 0;

    // KYC array contains levels for different types
    // We use the highest level achieved
    if (userInfo.kyc.length == 0) return 0;

    let maxLevel: u8 = 0;
    for (let i = 0; i < userInfo.kyc.length; i++) {
      if (userInfo.kyc[i] > maxLevel) {
        maxLevel = userInfo.kyc[i];
      }
    }

    // Cap at level 3
    return maxLevel > 3 ? 3 : maxLevel;
  }

  private updateAgentScore(agent: Name, score: u8, kycLevel: u8, add: boolean): void {
    let agentScore = this.agentScoresTable.get(agent.N);

    if (agentScore == null) {
      agentScore = new AgentScore(agent, 0, 0, 0, 0, 0);
    }

    const weight: u64 = <u64>(1 + kycLevel);
    const weightedScore: u64 = <u64>score * weight;
    const normalizedWeight: u64 = weight * 5;

    if (add) {
      // C1/C3 FIX: Overflow protection for score accumulation
      check(
        agentScore.total_score <= U64.MAX_VALUE - weightedScore,
        "Score accumulation would overflow"
      );
      check(
        agentScore.total_weight <= U64.MAX_VALUE - normalizedWeight,
        "Weight accumulation would overflow"
      );
      check(agentScore.feedback_count < U64.MAX_VALUE, "Feedback count would overflow");
      agentScore.total_score += weightedScore;
      agentScore.total_weight += normalizedWeight;
      agentScore.feedback_count += 1;
    } else {
      // Subtract (for dispute resolution)
      if (agentScore.total_score >= weightedScore) {
        agentScore.total_score -= weightedScore;
      } else {
        agentScore.total_score = 0;
      }
      if (agentScore.total_weight >= normalizedWeight) {
        agentScore.total_weight -= normalizedWeight;
      } else {
        agentScore.total_weight = 0;
      }
      if (agentScore.feedback_count > 0) {
        agentScore.feedback_count -= 1;
      }
    }

    // Calculate average score (multiplied by 100 for precision)
    // C1 FIX: Overflow protection for avg_score calculation
    if (agentScore.total_weight > 0) {
      // Check if multiplication would overflow
      if (agentScore.total_score > U64.MAX_VALUE / 10000) {
        // Use alternative calculation to avoid overflow: (score / weight) * 10000
        // This is less precise but won't overflow
        agentScore.avg_score = (agentScore.total_score / agentScore.total_weight) * 10000;
      } else {
        agentScore.avg_score = (agentScore.total_score * 10000) / agentScore.total_weight;
      }
    } else {
      agentScore.avg_score = 0;
    }

    agentScore.last_updated = currentTimeSec();

    if (this.agentScoresTable.get(agent.N) == null) {
      this.agentScoresTable.store(agentScore, this.receiver);
    } else {
      this.agentScoresTable.update(agentScore, this.receiver);
    }
  }
}
