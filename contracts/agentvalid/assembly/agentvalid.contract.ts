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
  hasAuth,
  isAccount,
  print,
  EMPTY_NAME,
  Singleton,
  InlineAction,
  ActionData,
  PermissionLevel
} from "proton-tsc";

// ============== TABLES ==============

@table("validators")
export class Validator extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public stake: u64 = 0,
    public method: string = "",
    public specializations: string = "",
    public total_validations: u64 = 0,
    public incorrect_validations: u64 = 0, // Track wrong validations instead
    public accuracy_score: u64 = 10000, // 0-10000 = 0-100.00% (starts at 100%)
    public pending_challenges: u64 = 0, // Count of funded pending challenges
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

@table("validations")
export class Validation extends Table {
  constructor(
    public id: u64 = 0,
    public validator: Name = EMPTY_NAME,
    public agent: Name = EMPTY_NAME,
    public job_hash: string = "",
    public result: u8 = 0, // 0=fail, 1=pass, 2=partial
    public confidence: u8 = 0, // 0-100
    public evidence_uri: string = "",
    public challenged: boolean = false,
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

  @secondary
  get byValidator(): u64 {
    return this.validator.N;
  }

  set byValidator(value: u64) {
    this.validator = Name.fromU64(value);
  }

  @secondary
  get byJobHash(): u64 {
    return hashString(this.job_hash);
  }

  set byJobHash(value: u64) {
    // Hash-derived field, setter is a no-op
  }
}

@table("challenges")
export class Challenge extends Table {
  constructor(
    public id: u64 = 0,
    public validation_id: u64 = 0,
    public challenger: Name = EMPTY_NAME,
    public reason: string = "",
    public evidence_uri: string = "",
    public stake: u64 = 0,
    public status: u8 = 0, // 0=pending, 1=upheld, 2=rejected, 3=cancelled
    public resolver: Name = EMPTY_NAME,
    public resolution_notes: string = "",
    public created_at: u64 = 0,
    public resolved_at: u64 = 0,
    public funding_deadline: u64 = 0, // Must fund within 24 hours
    public funded_at: u64 = 0 // H2 FIX: Timestamp when challenge was funded (for dispute period)
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }

  @secondary
  get byValidation(): u64 {
    return this.validation_id;
  }

  set byValidation(value: u64) {
    this.validation_id = value;
  }
}

@table("unstakes")
export class Unstake extends Table {
  constructor(
    public id: u64 = 0,
    public validator: Name = EMPTY_NAME,
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
  get byValidator(): u64 {
    return this.validator.N;
  }

  set byValidator(value: u64) {
    this.validator = Name.fromU64(value);
  }
}

@table("config", singleton)
export class Config extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public core_contract: Name = EMPTY_NAME,
    public min_stake: u64 = 50000000, // 500.0000 XPR default (raw units, 4 decimals)
    public challenge_stake: u64 = 10000000, // 100.0000 XPR
    public unstake_delay: u64 = 604800, // 7 days
    public challenge_window: u64 = 259200, // 3 days
    public slash_percent: u64 = 1000, // 10.00%
    public dispute_period: u64 = 172800, // H2 FIX: 48 hours minimum before challenge can be resolved
    public funded_challenge_timeout: u64 = 604800, // 7 days for funded challenges to be resolved before expiry
    public paused: boolean = false,
    public validation_fee: u64 = 0
  ) {
    super();
  }
}

// External table reference for agent verification
// Note: Schema must match agentcore::agents table exactly
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

@table("deposits")
export class Deposit extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public amount: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// SECURITY (audit round 2, XPRA-VALID-SLASH-2026-01): tracks the timestamp of each
// validator's most recent validation so unstake() can keep the stake at risk through
// the full window in which that validation could still be challenged and the
// challenge funded. Additive companion table — no existing table/action changes.
@table("valactivity")
export class ValActivity extends Table {
  constructor(
    public account: Name = EMPTY_NAME,
    public last_validation_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.account.N;
  }
}

// SECURITY (#91, Sept 2026): challenge() is free until funded, and unfunded rows were
// only ever flagged, never removed, so one account could fill agentvalid's RAM. Each
// challenger may now hold MAX_OPEN_UNFUNDED unfunded challenges at a time, and
// cancelchal / expireunfund delete the row. Both tables are new (additive).
@table("openchals")
export class OpenChalCount extends Table {
  constructor(
    public challenger: Name = EMPTY_NAME,
    public count: u64 = 0                   // Unfunded, pending challenges held
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.challenger.N;
  }
}

// Monotonic challenge ids. availablePrimaryKey is MAX(id) + 1, so deleting the newest
// row would hand its id (and its "challenge:ID" memo) to the next challenge.
@table("chalseq", singleton)
export class ChalSeq extends Table {
  constructor(
    public next_id: u64 = 0                 // Next challenge id to hand out
  ) {
    super();
  }
}

// ============== CONTRACT ==============

@contract
export class AgentValidContract extends Contract {
  private validatorsTable: TableStore<Validator> = new TableStore<Validator>(this.receiver);
  private validationsTable: TableStore<Validation> = new TableStore<Validation>(this.receiver);
  private challengesTable: TableStore<Challenge> = new TableStore<Challenge>(this.receiver);
  private unstakesTable: TableStore<Unstake> = new TableStore<Unstake>(this.receiver);
  private depositsTable: TableStore<Deposit> = new TableStore<Deposit>(this.receiver);
  private valActivityTable: TableStore<ValActivity> = new TableStore<ValActivity>(this.receiver);
  private configSingleton: Singleton<Config> = new Singleton<Config>(this.receiver);
  private openChalsTable: TableStore<OpenChalCount> = new TableStore<OpenChalCount>(this.receiver);
  private chalSeqSingleton: Singleton<ChalSeq> = new Singleton<ChalSeq>(this.receiver);
  private readonly MAX_OPEN_UNFUNDED: u64 = 3;

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

  // Max time a challenge may be funded after creation (mirrors the funding_deadline
  // set in challenge(): created_at + 86400). Used by the unstake time-lock.
  private readonly FUNDING_WINDOW: u64 = 86400;

  private readonly XPR_SYMBOL: Symbol = new Symbol("XPR", 4);
  private readonly TOKEN_CONTRACT: Name = Name.fromString("eosio.token");

  // ============== INITIALIZATION ==============

  @action("init")
  init(owner: Name, core_contract: Name, min_stake: u64): void {
    requireAuth(this.receiver);

    // H1 FIX: Prevent re-initialization if already initialized
    const existingConfig = this.configSingleton.get();
    check(
      existingConfig.owner == EMPTY_NAME,
      "Contract already initialized. Use setconfig to modify settings."
    );

    const config = new Config(
      owner,
      core_contract,
      min_stake,
      10000000, // challenge_stake
      604800, // unstake_delay
      259200, // challenge_window
      1000, // slash_percent
      172800, // dispute_period (48 hours)
      604800, // funded_challenge_timeout (7 days)
      false,
      0 // validation_fee
    );
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(
    core_contract: Name,
    min_stake: u64,
    challenge_stake: u64,
    unstake_delay: u64,
    challenge_window: u64,
    slash_percent: u64,
    dispute_period: u64,
    funded_challenge_timeout: u64,
    paused: boolean,
    validation_fee: u64
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    // L2 FIX: Validate all config parameters
    check(slash_percent <= 10000, "Slash percent cannot exceed 100%");
    check(min_stake > 0, "Minimum stake must be positive");
    check(challenge_stake > 0, "Challenge stake must be positive");
    check(unstake_delay >= 86400, "Unstake delay must be at least 1 day (86400 seconds)");
    check(challenge_window >= 3600, "Challenge window must be at least 1 hour (3600 seconds)");
    // H2 FIX: Validate dispute period is at least 24 hours to give validators time to respond
    check(dispute_period >= 86400, "Dispute period must be at least 24 hours (86400 seconds)");
    check(funded_challenge_timeout >= 86400, "Funded challenge timeout must be at least 1 day (86400 seconds)");
    // M3 FIX: Validate core contract is a real account
    if (core_contract != EMPTY_NAME) {
      check(isAccount(core_contract), "Core contract must be a valid account");
    }

    config.core_contract = core_contract;
    config.min_stake = min_stake;
    config.challenge_stake = challenge_stake;
    config.unstake_delay = unstake_delay;
    config.challenge_window = challenge_window;
    config.slash_percent = slash_percent;
    config.dispute_period = dispute_period;
    config.funded_challenge_timeout = funded_challenge_timeout;
    config.paused = paused;
    config.validation_fee = validation_fee;

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

  // ============== VALIDATOR REGISTRATION ==============

  @action("regval")
  registerValidator(
    account: Name,
    method: string,
    specializations: string
  ): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(isAccount(account), "Account does not exist");
    check(this.validatorsTable.get(account.N) == null, "Validator already registered");

    check(method.length > 0 && method.length <= 256, "Method must be 1-256 characters");
    check(specializations.length <= 512, "Specializations too long");

    const validator = new Validator(
      account,
      0, // stake starts at 0
      method,
      specializations,
      0, // total_validations
      0, // correct_validations
      10000, // Start at 100% accuracy (no validations yet)
      0, // pending_challenges
      currentTimeSec(),
      true
    );

    this.validatorsTable.store(validator, this.receiver);
  }

  @action("updateval")
  updateValidator(
    account: Name,
    method: string,
    specializations: string
  ): void {
    requireAuth(account);

    const validator = this.validatorsTable.requireGet(account.N, "Validator not found");

    check(method.length > 0 && method.length <= 256, "Method must be 1-256 characters");
    check(specializations.length <= 512, "Specializations too long");

    validator.method = method;
    validator.specializations = specializations;

    this.validatorsTable.update(validator, this.receiver);
  }

  @action("setvalstat")
  setValidatorStatus(account: Name, active: boolean): void {
    requireAuth(account);

    const validator = this.validatorsTable.requireGet(account.N, "Validator not found");
    validator.active = active;

    this.validatorsTable.update(validator, this.receiver);
  }

  // ============== STAKING ==============

  @action("unstake")
  unstake(account: Name, amount: u64): void {
    requireAuth(account);

    const config = this.configSingleton.get();
    const validator = this.validatorsTable.requireGet(account.N, "Validator not found");

    check(amount > 0, "Amount must be positive");
    check(validator.stake >= amount, "Insufficient stake");

    // Check for pending FUNDED challenges against this validator.
    // NOTE: this is reactive — it only fires once a challenge has been funded. On its
    // own it does NOT stop a validator from posting a dishonest validation and
    // unstaking to zero in the same window before any challenge exists (see the
    // time-lock below), which is why slashing could be evaded (XPRA-VALID-SLASH-2026-01).
    check(
      !this.hasPendingChallenges(account),
      "Cannot unstake while you have pending challenges. Wait for challenge resolution."
    );

    // SECURITY (XPRA-VALID-SLASH-2026-01): keep the stake at risk through the window
    // in which the validator's most recent validation could still be challenged AND
    // that challenge funded. A challenge is creatable within `challenge_window` of the
    // validation and fundable within FUNDING_WINDOW (24h) of its creation; once funded
    // the pending-challenge guard above takes over. So block ALL unstaking until
    // challenge_window + FUNDING_WINDOW has elapsed since the last validation. Without
    // this, an atomic validate()+unstake() moved the whole stake to the (non-slashable)
    // unstakes table before any challenge, so an upheld challenge slashed 0.
    const activity = this.valActivityTable.get(account.N);
    if (activity != null) {
      const riskEnd = activity.last_validation_at + config.challenge_window + this.FUNDING_WINDOW;
      check(
        currentTimeSec() > riskEnd,
        "Cannot unstake yet: stake stays at risk until the challenge window of your most recent validation has passed."
      );
    }

    // Also check that remaining stake meets minimum if validator stays active
    const remainingStake = validator.stake - amount;
    if (validator.active && remainingStake > 0) {
      check(
        remainingStake >= config.min_stake,
        "Remaining stake would be below minimum. Unstake all or keep >= min_stake"
      );
    }

    // Reduce stake
    validator.stake -= amount;
    this.validatorsTable.update(validator, this.receiver);

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

  /**
   * FINDING 3 FIX: Check if a validator has any pending FUNDED challenges
   * This prevents validators from draining stake before challenge resolution
   *
   * CRITICAL GRIEFING FIX: Only blocks on FUNDED pending challenges (stake > 0).
   * Previously blocking on unfunded challenges allowed free griefing attacks where
   * attackers could lock validator stakes indefinitely by creating unfunded challenges.
   *
   * Now the flow is:
   * 1. Challenge created (stake=0) - does NOT block unstaking
   * 2. Challenge funded (stake>0) - blocks unstaking until resolved
   * 3. Unfunded challenges expire after 24 hours via expireunfund
   *
   * Validators have 24 hours to see a challenge before it can be funded.
   */
  private hasPendingChallenges(validator: Name): boolean {
    const validatorRecord = this.validatorsTable.get(validator.N);
    if (validatorRecord == null) return false;
    return validatorRecord.pending_challenges > 0;
  }

  @action("withdraw")
  withdraw(account: Name, unstake_id: u64): void {
    requireAuth(account);

    const unstakeRequest = this.unstakesTable.requireGet(unstake_id, "Unstake request not found");

    check(unstakeRequest.validator == account, "Not your unstake request");
    check(currentTimeSec() >= unstakeRequest.available_at, "Unstake period not complete");

    // SECURITY (XPRA-VALID-SLASH-2026-01): defense in depth. The unstake time-lock
    // already prevents queuing stake while it is at risk, but never release queued
    // stake while a funded challenge against this validator is still pending.
    check(
      !this.hasPendingChallenges(account),
      "Cannot withdraw while you have a funded pending challenge. Wait for resolution."
    );

    // Transfer tokens back
    const quantity = new Asset(unstakeRequest.amount, this.XPR_SYMBOL);
    this.sendTokens(account, quantity, "Validator unstake withdrawal");

    // Remove unstake request
    this.unstakesTable.remove(unstakeRequest);
  }

  // ============== VALIDATION ==============

  @action("validate")
  validate(
    validator: Name,
    agent: Name,
    job_hash: string,
    result: u8,
    confidence: u8,
    evidence_uri: string
  ): void {
    requireAuth(validator);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    if (config.validation_fee > 0) {
      const deposit = this.depositsTable.get(validator.N);
      check(deposit != null, "Validation fee not paid. Send XPR with memo 'valfee:" + validator.toString() + "'");
      check(deposit!.amount >= config.validation_fee,
        "Insufficient validation fee. Required: " + (config.validation_fee / 10000).toString() + " XPR");
      const excess = deposit!.amount - config.validation_fee;
      if (excess > 0) {
        this.sendTokens(validator, new Asset(<i64>excess, this.XPR_SYMBOL), "Validation fee excess refund");
      }
      this.depositsTable.remove(deposit!);
    }

    const validatorRecord = this.validatorsTable.requireGet(validator.N, "Validator not found");
    check(validatorRecord.active, "Validator is not active");
    check(validatorRecord.stake >= config.min_stake, "Insufficient validator stake");

    // SECURITY: Verify agent exists in agentcore registry (uses config.core_contract)
    this.requireAgentRef(agent);

    // SECURITY: Prevent self-validation - validators cannot validate their own work
    check(validator != agent, "Validators cannot validate their own work");

    check(result <= 2, "Invalid result (0=fail, 1=pass, 2=partial)");
    check(confidence <= 100, "Confidence must be 0-100");
    check(job_hash.length > 0 && job_hash.length <= 128, "Job hash must be 1-128 characters");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    const validation = new Validation(
      this.validationsTable.availablePrimaryKey,
      validator,
      agent,
      job_hash,
      result,
      confidence,
      evidence_uri,
      false,
      currentTimeSec()
    );

    this.validationsTable.store(validation, this.receiver);

    // Update validator stats
    validatorRecord.total_validations += 1;
    this.validatorsTable.update(validatorRecord, this.receiver);

    // SECURITY (XPRA-VALID-SLASH-2026-01): record the time of this validation so
    // unstake() keeps the stake slashable until this validation can no longer be
    // challenged and funded.
    const nowValidation = currentTimeSec();
    const existingActivity = this.valActivityTable.get(validator.N);
    if (existingActivity == null) {
      this.valActivityTable.store(new ValActivity(validator, nowValidation), this.receiver);
    } else {
      existingActivity.last_validation_at = nowValidation;
      this.valActivityTable.update(existingActivity, this.receiver);
    }

    print(
      `Validation submitted for ${agent.toString()} by ${validator.toString()}: result=${result}, confidence=${confidence}`
    );
  }

  @action("challenge")
  challenge(
    challenger: Name,
    validation_id: u64,
    reason: string,
    evidence_uri: string
  ): void {
    requireAuth(challenger);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");

    const validation = this.validationsTable.requireGet(validation_id, "Validation not found");
    check(!validation.challenged, "Validation already challenged");
    check(challenger != validation.validator, "Validator cannot challenge own validation");

    // C3 FIX: Rewrite to avoid timestamp overflow
    // C5 FIX: Also check for underflow (timestamp in future)
    const nowTime = currentTimeSec();
    check(validation.timestamp <= nowTime, "Invalid validation timestamp - in future");
    const timeSinceValidation = nowTime - validation.timestamp;
    check(timeSinceValidation <= config.challenge_window, "Challenge window expired");

    check(reason.length > 0 && reason.length <= 512, "Reason must be 1-512 characters");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    // CRITICAL GRIEFING FIX: Do NOT mark validation as challenged yet.
    // The validation.challenged flag is only set when the challenge is FUNDED.
    // This prevents free griefing attacks where unfunded challenges block validator unstaking.
    // The validation will be marked as challenged in the onTransfer handler when funded.

    // Create challenge record (stake is handled via transfer within 24 hours)
    // C4 FIX: Check for timestamp overflow before calculating deadline
    const currentTime = currentTimeSec();
    check(currentTime < U64.MAX_VALUE - 86400, "Timestamp overflow in funding deadline");
    const fundingDeadline = currentTime + 86400; // 24 hours to fund
    this.incOpenChals(challenger);
    const challengeRecord = new Challenge(
      this.nextChallengeId(),
      validation_id,
      challenger,
      reason,
      evidence_uri,
      0, // Stake amount set via transfer - challenge not active until funded
      0, // pending
      EMPTY_NAME,
      "",
      currentTimeSec(),
      0,
      fundingDeadline
    );

    this.challengesTable.store(challengeRecord, this.receiver);

    // pending_challenges is incremented only when a challenge is FUNDED (see the
    // challenge: branch in onTransfer), never on creation. Creation is free and
    // permissionless, so counting unfunded challenges here let anyone lock a
    // validator's unstaking for free — the griefing this contract's own design
    // (the challenged-flag comment in onTransfer) set out to prevent.

    print(`Challenge created (ID: ${challengeRecord.id}). Fund within 24 hours with memo 'challenge:${challengeRecord.id}' to activate.`);
  }

  private incOpenChals(challenger: Name): void {
    const row = this.openChalsTable.get(challenger.N);
    const count: u64 = row == null ? 0 : row.count;
    check(
      count < this.MAX_OPEN_UNFUNDED,
      "Too many unfunded challenges open (max " + this.MAX_OPEN_UNFUNDED.toString() + "). Fund or cancel one first."
    );
    if (row == null) {
      this.openChalsTable.store(new OpenChalCount(challenger, 1), this.receiver);
    } else {
      row.count = count + 1;
      this.openChalsTable.update(row, this.receiver);
    }
  }

  private decOpenChals(challenger: Name): void {
    // Challenges created before this counter existed were never counted: never underflow.
    const row = this.openChalsTable.get(challenger.N);
    if (row == null) return;
    if (row.count <= 1) {
      this.openChalsTable.remove(row);
    } else {
      row.count -= 1;
      this.openChalsTable.update(row, this.receiver);
    }
  }

  private nextChallengeId(): u64 {
    const seq = this.chalSeqSingleton.getOrNull();
    const fromTable = this.challengesTable.availablePrimaryKey;
    let next: u64 = seq == null ? fromTable : seq!.next_id;
    if (next < fromTable) {
      next = fromTable;
    }
    this.chalSeqSingleton.set(new ChalSeq(next + 1), this.receiver);
    return next;
  }

  @action("cancelchal")
  cancelChallenge(challenger: Name, challenge_id: u64): void {
    requireAuth(challenger);

    const challengeRecord = this.challengesTable.requireGet(challenge_id, "Challenge not found");
    check(challengeRecord.challenger == challenger, "Not your challenge");
    check(challengeRecord.status == 0, "Challenge already resolved");
    check(challengeRecord.stake == 0, "Cannot cancel funded challenge");

    // Must wait for funding deadline to pass OR be within first hour (grace period)
    const gracePeriodEnd = challengeRecord.created_at + 3600; // 1 hour grace period
    check(
      currentTimeSec() <= gracePeriodEnd || currentTimeSec() > challengeRecord.funding_deadline,
      "Cannot cancel: past grace period but before funding deadline"
    );

    // cancelchal only handles unfunded challenges (stake == 0 checked above), which
    // never incremented pending_challenges and never set validation.challenged, so
    // there is nothing to reverse here.

    // An unfunded challenge carries no state anything reads, so the row is removed
    // rather than flagged (#91).
    this.decOpenChals(challengeRecord.challenger);
    this.challengesTable.remove(challengeRecord);

    print(`Challenge ${challenge_id} cancelled`);
  }

  @action("expireunfund")
  expireUnfundedChallenge(challenge_id: u64): void {
    // Anyone can call this to clean up expired unfunded challenges
    const challengeRecord = this.challengesTable.requireGet(challenge_id, "Challenge not found");
    check(challengeRecord.status == 0, "Challenge already resolved");
    check(challengeRecord.stake == 0, "Challenge is funded");
    check(currentTimeSec() > challengeRecord.funding_deadline, "Funding deadline not reached");

    // expireunfund only handles UNFUNDED challenges (stake == 0 checked above), which
    // never incremented pending_challenges and never set validation.challenged.
    // SECURITY (audit round 2): we must NOT touch validation.challenged here. Two
    // unfunded challenges can exist for one validation; if challenge A is funded
    // (setting challenged = true) and unfunded sibling B then expires, clearing the
    // flag here would unlock the validation while A is still funded and pending —
    // letting a second challenge be funded and the validator be slashed twice for a
    // single validation. The flag is owned solely by funding (set) and
    // resolve/expirefunded (clear). Leave it alone.

    // Remove the row rather than flag it (#91): nothing reads an expired unfunded challenge.
    this.decOpenChals(challengeRecord.challenger);
    this.challengesTable.remove(challengeRecord);

    print(`Unfunded challenge ${challenge_id} expired`);
  }

  @action("expirefunded")
  expireFundedChallenge(challenge_id: u64): void {
    // Anyone can call this to clean up expired funded challenges
    const config = this.configSingleton.get();
    const challengeRecord = this.challengesTable.requireGet(challenge_id, "Challenge not found");
    check(challengeRecord.status == 0, "Challenge already resolved");
    check(challengeRecord.stake > 0, "Challenge is not funded");
    check(challengeRecord.funded_at > 0, "Challenge has no funding timestamp");
    check(
      currentTimeSec() > challengeRecord.funded_at + config.funded_challenge_timeout,
      "Funded challenge timeout not reached"
    );

    // This challenge is funded (stake > 0 checked above), so it incremented
    // pending_challenges when funded. Reverse that here, keyed on the funded state
    // rather than the challenged flag, so the counter can never leak if the flag was
    // already cleared by some other path.
    const validation = this.validationsTable.get(challengeRecord.validation_id);
    if (validation != null) {
      if (validation.challenged) {
        validation.challenged = false;
        this.validationsTable.update(validation, this.receiver);
      }
      const validator = this.validatorsTable.get(validation.validator.N);
      if (validator != null && validator.pending_challenges > 0) {
        validator.pending_challenges -= 1;
        this.validatorsTable.update(validator, this.receiver);
      }
    }

    // Return stake to challenger
    const stakeReturn = new Asset(challengeRecord.stake, this.XPR_SYMBOL);
    this.sendTokens(challengeRecord.challenger, stakeReturn, "Funded challenge expired - stake returned");

    // Mark challenge as cancelled (expired)
    challengeRecord.status = 3; // cancelled/expired
    challengeRecord.resolution_notes = "Expired: funded challenge not resolved within timeout";
    challengeRecord.resolved_at = currentTimeSec();
    this.challengesTable.update(challengeRecord, this.receiver);

    print(`Funded challenge ${challenge_id} expired, stake returned to challenger`);
  }

  @action("resolve")
  resolve(
    resolver: Name,
    challenge_id: u64,
    upheld: boolean,
    resolution_notes: string
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    // M1 FIX: Validate resolver is a real account
    check(isAccount(resolver), "Resolver must be a valid account");
    // L1 FIX: Validate resolution notes
    check(
      resolution_notes.length > 0 && resolution_notes.length <= 1024,
      "Resolution notes must be 1-1024 characters with clear reasoning"
    );

    const challengeRecord = this.challengesTable.requireGet(challenge_id, "Challenge not found");
    check(challengeRecord.status == 0, "Challenge already resolved");

    // CRITICAL: Require stake before resolution to prevent free challenge griefing
    // AUDIT FIX: Check stake > 0 instead of >= config.challenge_stake.
    // The challenge_stake config may have been increased after funding, which would
    // make previously-funded challenges unresolvable (funds permanently trapped).
    // The stake was validated against config.challenge_stake at funding time in onTransfer.
    check(
      challengeRecord.stake > 0,
      "Challenge must be funded. Send XPR with memo 'challenge:ID'"
    );

    // H2 FIX: Enforce minimum dispute period after funding before challenge can be resolved
    // This gives validators time to respond with evidence before resolution
    check(
      challengeRecord.funded_at > 0,
      "Challenge funding timestamp not set"
    );
    const timeSinceFunding = currentTimeSec() - challengeRecord.funded_at;
    check(
      timeSinceFunding >= config.dispute_period,
      "Dispute period not elapsed. Challenge can be resolved after " +
        config.dispute_period.toString() +
        " seconds from funding. Time remaining: " +
        (config.dispute_period - timeSinceFunding).toString() +
        " seconds"
    );

    const validation = this.validationsTable.requireGet(
      challengeRecord.validation_id,
      "Validation not found"
    );

    // Update challenge
    challengeRecord.status = upheld ? 1 : 2;
    challengeRecord.resolver = resolver;
    challengeRecord.resolution_notes = resolution_notes;
    challengeRecord.resolved_at = currentTimeSec();
    this.challengesTable.update(challengeRecord, this.receiver);

    // AUDIT FIX: Reset validation.challenged after resolution
    // This allows the validation to be challenged again within the remaining window
    // and prevents "immunization" attacks (filing a weak challenge that gets rejected
    // to permanently protect a validation from legitimate challenges)
    validation.challenged = false;
    this.validationsTable.update(validation, this.receiver);

    const validator = this.validatorsTable.requireGet(validation.validator.N, "Validator not found");

    // Decrement pending_challenges counter
    if (validator.pending_challenges > 0) {
      validator.pending_challenges -= 1;
    }

    // Track reward amount for sending after state update
    let rewardAmount: u64 = 0;
    let rewardRecipient: Name = EMPTY_NAME;

    if (upheld) {
      // Challenge upheld - validator was wrong
      validator.incorrect_validations += 1;

      // Slash validator
      const slashAmount = (validator.stake * config.slash_percent) / 10000;
      let actualSlash: u64 = 0;
      if (slashAmount > 0 && validator.stake >= slashAmount) {
        validator.stake -= slashAmount;
        actualSlash = slashAmount;
      }

      // AUDIT FIX: Always return challenger's stake when upheld, plus any slash reward.
      // Previously, if validator had 0 stake (already slashed), the challenger's funds
      // were permanently trapped because the entire reward block was inside the if.
      // C2 FIX: Overflow check before reward calculation
      check(
        challengeRecord.stake <= U64.MAX_VALUE - actualSlash,
        "Reward calculation would overflow"
      );
      rewardAmount = challengeRecord.stake + actualSlash;
      rewardRecipient = challengeRecord.challenger;
    } else {
      // Challenge rejected - validator was correct
      // C1 FIX: Overflow check before adding stake
      check(
        validator.stake <= U64.MAX_VALUE - challengeRecord.stake,
        "Validator stake would overflow"
      );
      // Forfeit challenger stake to validator
      validator.stake += challengeRecord.stake;
    }

    // Update accuracy: (total - incorrect) / total
    // H6 FIX: Only calculate meaningful accuracy after minimum sample size
    const MIN_VALIDATIONS_FOR_ACCURACY: u64 = 5;
    if (validator.total_validations >= MIN_VALIDATIONS_FOR_ACCURACY) {
      // AUDIT FIX: Guard against underflow if incorrect_validations somehow exceeds total
      if (validator.incorrect_validations >= validator.total_validations) {
        validator.accuracy_score = 0;
      } else {
        const correct = validator.total_validations - validator.incorrect_validations;
        validator.accuracy_score = (correct * 10000) / validator.total_validations;
      }
    }
    // H2 FIX: Don't change accuracy if not enough data - keep at initial 10000 (100%)
    // This stays within 0-10000 range and indicates "not yet challenged"

    // H1 FIX: Update state BEFORE external calls to prevent reentrancy
    this.validatorsTable.update(validator, this.receiver);

    // Send reward AFTER state update
    if (rewardAmount > 0 && rewardRecipient != EMPTY_NAME) {
      const reward = new Asset(rewardAmount, this.XPR_SYMBOL);
      this.sendTokens(rewardRecipient, reward, "Challenge upheld - reward");
    }
  }

  @action("slash")
  slash(validator: Name, amount: u64, reason: string): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const validatorRecord = this.validatorsTable.requireGet(validator.N, "Validator not found");

    check(amount > 0, "Amount must be positive");
    check(validatorRecord.stake >= amount, "Amount exceeds validator stake");
    check(reason.length > 0 && reason.length <= 256, "Reason must be 1-256 characters");

    const remainingStake = validatorRecord.stake - amount;
    // CRITICAL: Prevent leaving validator in invalid state (stake > 0 but < min_stake)
    // Remaining stake must be either 0 (fully slashed) or >= min_stake (still valid)
    check(
      remainingStake == 0 || remainingStake >= config.min_stake,
      "Slashing would leave validator in invalid state. Slash to 0 or leave >= min_stake"
    );

    validatorRecord.stake = remainingStake;

    // If fully slashed, deactivate validator
    if (remainingStake == 0) {
      validatorRecord.active = false;
    }

    this.validatorsTable.update(validatorRecord, this.receiver);

    print(`Slashed ${amount} from validator ${validator.toString()}: ${reason}`);
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

    // Parse memo
    if (memo.startsWith("valfee:")) {
      const accountName = memo.slice(7);
      check(accountName.length > 0 && accountName.length <= 12, "Invalid account name in memo");
      const depositAccount = Name.fromString(accountName);
      check(from == depositAccount, "Payer must match account in memo");
      check(quantity.amount > 0, "Transfer amount must be positive");

      const existingDeposit = this.depositsTable.get(depositAccount.N);
      const transferAmount: u64 = <u64>quantity.amount;
      if (existingDeposit != null) {
        check(existingDeposit.amount <= U64.MAX_VALUE - transferAmount, "Deposit would overflow");
        existingDeposit.amount += transferAmount;
        this.depositsTable.update(existingDeposit, this.receiver);
      } else {
        const deposit = new Deposit(depositAccount, transferAmount);
        this.depositsTable.store(deposit, this.receiver);
      }

      print(`Validation fee deposit received: ${quantity.toString()} from ${from.toString()}`);
      return;
    }

    if (memo == "stake" || memo.startsWith("stake:")) {
      // Validator stake
      const validator = this.validatorsTable.get(from.N);
      check(validator != null, "Validator not registered. Register first.");

      // H3 FIX: Cap maximum validator stake to prevent economic imbalance
      const MAX_VALIDATOR_STAKE: u64 = 100000000000; // 10,000,000 XPR (10M)
      const newStake = validator!.stake + <u64>quantity.amount;
      check(newStake <= MAX_VALIDATOR_STAKE, "Validator stake would exceed maximum (10M XPR)");

      validator!.stake = newStake;
      this.validatorsTable.update(validator!, this.receiver);

      print(`Staked ${quantity.toString()} for validator ${from.toString()}`);
    } else if (memo.startsWith("challenge:")) {
      // Challenge stake
      const config = this.configSingleton.get();
      check(<u64>quantity.amount >= config.challenge_stake, "Insufficient challenge stake");

      // H2 FIX: Validate memo format before parsing
      const challengeIdStr = memo.substring(10);
      check(challengeIdStr.length > 0 && challengeIdStr.length <= 20, "Invalid challenge ID format");
      // Validate it contains only digits
      for (let i = 0; i < challengeIdStr.length; i++) {
        const c = challengeIdStr.charCodeAt(i);
        check(c >= 48 && c <= 57, "Challenge ID must be numeric");
      }
      const challengeId = U64.parseInt(challengeIdStr);

      const challengeRecord = this.challengesTable.requireGet(challengeId, "Challenge not found");
      check(challengeRecord.challenger == from, "Not your challenge");
      check(challengeRecord.stake == 0, "Challenge already staked");

      // P1 FIX: Ensure challenge is still pending (not canceled/resolved)
      // Status: 0=pending, 1=upheld, 2=rejected, 3=cancelled
      check(challengeRecord.status == 0, "Challenge is not pending - cannot fund canceled or resolved challenges");

      // FINDING 2 FIX: Check funding deadline hasn't passed
      check(
        currentTimeSec() <= challengeRecord.funding_deadline,
        "Challenge funding deadline has passed. Use expireunfund to clean up."
      );

      // H3 FIX: Refund excess stake above required amount
      const excess = quantity.amount - config.challenge_stake;
      if (excess > 0) {
        this.sendTokens(from, new Asset(excess, this.XPR_SYMBOL), "Challenge stake excess refund");
      }

      // Store only required stake amount and record funding timestamp
      challengeRecord.stake = config.challenge_stake;
      challengeRecord.funded_at = currentTimeSec(); // H2 FIX: Record when challenge was funded for dispute period
      this.challengesTable.update(challengeRecord, this.receiver);
      this.decOpenChals(from); // funded: no longer counts against the unfunded cap

      // CRITICAL GRIEFING FIX: NOW mark the validation as challenged
      // This only happens when the challenge is actually funded, preventing
      // free griefing attacks where unfunded challenges block validator unstaking.
      const validation = this.validationsTable.get(challengeRecord.validation_id);
      check(validation != null, "Validation not found for challenge");
      // AUDIT FIX: Prevent multiple funded challenges against the same validation.
      // Multiple unfunded challenges can be created (race window), but only the first
      // to be funded is accepted. This prevents duplicate slashing/accuracy penalties.
      check(!validation!.challenged, "Validation already has a funded challenge");
      validation!.challenged = true;
      this.validationsTable.update(validation!, this.receiver);

      // Increment pending_challenges here, on funding — in lockstep with the
      // challenged flag above. It gates unstaking, so a funded challenge (which can
      // actually slash) blocks the validator from escaping, while free unfunded
      // challenges do not. Decremented in resolve and expirefunded.
      const challengedValidator = this.validatorsTable.get(validation!.validator.N);
      if (challengedValidator != null) {
        check(challengedValidator.pending_challenges < U64.MAX_VALUE, "pending_challenges overflow");
        challengedValidator.pending_challenges += 1;
        this.validatorsTable.update(challengedValidator, this.receiver);
      }

      print(`Challenge ${challengeId} funded. Validation ${challengeRecord.validation_id} is now challenged.`);
    } else {
      // FINDING 2 FIX: Reject unrecognized memos to prevent loss of funds
      check(false, "Invalid memo. Use 'stake' for validator staking or 'challenge:ID' for challenge funding");
    }
  }

  // ============== CLEANUP ==============

  @action("cleanvals")
  cleanValidations(agent: Name, max_age: u64, max_delete: u64): void {
    // SECURITY FIX: cleanup is owner-only. It was permissionless, and combined with
    // an unbounded max_age (u64 wrap on `now - max_age`) anyone could erase any row.
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(max_age >= 7776000, "Max age must be at least 90 days (7776000 seconds)");
    check(max_age <= 315360000, "Max age must be at most 10 years (315360000 seconds)");
    check(max_delete >= 1 && max_delete <= 100, "Max delete must be 1-100");

    const now = currentTimeSec();
    check(now > max_age, "Max age exceeds chain time");
    const cutoff = now - max_age;
    let deleted: u64 = 0;

    let val = this.validationsTable.getBySecondaryU64(agent.N, 0);
    while (val != null && deleted < max_delete) {
      const current = val;
      val = this.validationsTable.nextBySecondaryU64(current, 0);
      if (val != null && val.agent != agent) val = null;

      if (current.timestamp < cutoff && !current.challenged) {
        this.validationsTable.remove(current);
        deleted++;
      }
    }

    print(`Cleaned ${deleted} old validations for ${agent.toString()}`);
  }

  @action("cleanchals")
  cleanChallenges(max_age: u64, max_delete: u64): void {
    // SECURITY FIX: cleanup is owner-only. It was permissionless, and combined with
    // an unbounded max_age (u64 wrap on `now - max_age`) anyone could erase any row.
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(max_age >= 7776000, "Max age must be at least 90 days (7776000 seconds)");
    check(max_age <= 315360000, "Max age must be at most 10 years (315360000 seconds)");
    check(max_delete >= 1 && max_delete <= 100, "Max delete must be 1-100");

    const now = currentTimeSec();
    check(now > max_age, "Max age exceeds chain time");
    const cutoff = now - max_age;
    let deleted: u64 = 0;

    let challenge = this.challengesTable.first();
    while (challenge != null && deleted < max_delete) {
      const current = challenge;
      challenge = this.challengesTable.next(current);

      if (current.status != 0 && current.resolved_at > 0 && current.resolved_at < cutoff) {
        this.challengesTable.remove(current);
        deleted++;
      }
    }

    print(`Cleaned ${deleted} resolved challenges`);
  }

  // ============== HELPERS ==============

  private sendTokens(to: Name, quantity: Asset, memo: string): void {
    const TRANSFER = new InlineAction<Transfer>("transfer");
    const action = TRANSFER.act(this.TOKEN_CONTRACT, new PermissionLevel(this.receiver));
    const actionParams = new Transfer(this.receiver, to, quantity, memo);
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
