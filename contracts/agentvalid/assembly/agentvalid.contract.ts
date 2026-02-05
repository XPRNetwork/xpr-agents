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
  Singleton
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
    public correct_validations: u64 = 0,
    public accuracy_score: u64 = 0, // 0-10000 = 0-100.00%
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

  @secondary
  get byValidator(): u64 {
    return this.validator.N;
  }

  @secondary
  get byJobHash(): u64 {
    return hashString(this.job_hash);
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
  get byValidation(): u64 {
    return this.validation_id;
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
}

@table("config", singleton)
export class Config extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public core_contract: Name = EMPTY_NAME,
    public min_stake: u64 = 50000000, // 500.0000 XPR default
    public challenge_stake: u64 = 10000000, // 100.0000 XPR
    public unstake_delay: u64 = 604800, // 7 days
    public challenge_window: u64 = 259200, // 3 days
    public slash_percent: u64 = 1000, // 10.00%
    public paused: boolean = false
  ) {
    super();
  }
}

// External table reference for agent verification
@table("agents", "agentcore")
export class AgentRef extends Table {
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

// ============== CONTRACT ==============

@contract
export class AgentValidContract extends Contract {
  private validatorsTable: TableStore<Validator> = new TableStore<Validator>(this.receiver);
  private validationsTable: TableStore<Validation> = new TableStore<Validation>(this.receiver);
  private challengesTable: TableStore<Challenge> = new TableStore<Challenge>(this.receiver);
  private unstakesTable: TableStore<Unstake> = new TableStore<Unstake>(this.receiver);
  private configSingleton: Singleton<Config> = new Singleton<Config>(this.receiver);

  // External table for agent verification
  private agentRefTable: TableStore<AgentRef> = new TableStore<AgentRef>(
    Name.fromString("agentcore"),
    Name.fromString("agentcore")
  );

  private readonly XPR_SYMBOL: Symbol = new Symbol("XPR", 4);
  private readonly TOKEN_CONTRACT: Name = Name.fromString("eosio.token");

  // ============== INITIALIZATION ==============

  @action("init")
  init(owner: Name, core_contract: Name, min_stake: u64): void {
    requireAuth(this.receiver);

    const config = new Config(
      owner,
      core_contract,
      min_stake,
      10000000, // challenge_stake
      604800, // unstake_delay
      259200, // challenge_window
      1000, // slash_percent
      false
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
    paused: boolean
  ): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(slash_percent <= 10000, "Slash percent cannot exceed 100%");

    config.core_contract = core_contract;
    config.min_stake = min_stake;
    config.challenge_stake = challenge_stake;
    config.unstake_delay = unstake_delay;
    config.challenge_window = challenge_window;
    config.slash_percent = slash_percent;
    config.paused = paused;

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

  @action("withdraw")
  withdraw(account: Name, unstake_id: u64): void {
    requireAuth(account);

    const unstakeRequest = this.unstakesTable.requireGet(unstake_id, "Unstake request not found");

    check(unstakeRequest.validator == account, "Not your unstake request");
    check(currentTimeSec() >= unstakeRequest.available_at, "Unstake period not complete");

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

    const validatorRecord = this.validatorsTable.requireGet(validator.N, "Validator not found");
    check(validatorRecord.active, "Validator is not active");
    check(validatorRecord.stake >= config.min_stake, "Insufficient validator stake");

    // SECURITY: Verify agent exists in agentcore registry
    const agentRef = this.agentRefTable.get(agent.N);
    check(agentRef != null, "Agent not registered in agentcore");

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

    // Check challenge window
    check(
      currentTimeSec() <= validation.timestamp + config.challenge_window,
      "Challenge window expired"
    );

    check(reason.length > 0 && reason.length <= 512, "Reason must be 1-512 characters");
    check(evidence_uri.length <= 256, "Evidence URI too long");

    // Mark validation as challenged
    validation.challenged = true;
    this.validationsTable.update(validation, this.receiver);

    // Create challenge record (stake is handled via transfer)
    const challengeRecord = new Challenge(
      this.challengesTable.availablePrimaryKey,
      validation_id,
      challenger,
      reason,
      evidence_uri,
      0, // Stake amount set via transfer
      0, // pending
      EMPTY_NAME,
      "",
      currentTimeSec(),
      0
    );

    this.challengesTable.store(challengeRecord, this.receiver);
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

    const challengeRecord = this.challengesTable.requireGet(challenge_id, "Challenge not found");
    check(challengeRecord.status == 0, "Challenge already resolved");

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

    const validator = this.validatorsTable.requireGet(validation.validator.N, "Validator not found");

    if (upheld) {
      // Challenge upheld - validator was wrong
      // Slash validator
      const slashAmount = (validator.stake * config.slash_percent) / 10000;
      if (slashAmount > 0 && validator.stake >= slashAmount) {
        validator.stake -= slashAmount;

        // Return challenger stake + reward from slash
        if (challengeRecord.stake > 0) {
          const reward = new Asset(challengeRecord.stake + slashAmount, this.XPR_SYMBOL);
          this.sendTokens(challengeRecord.challenger, reward, "Challenge upheld - reward");
        }
      }

      // Update accuracy
      if (validator.total_validations > 0) {
        validator.accuracy_score =
          (validator.correct_validations * 10000) / validator.total_validations;
      }
    } else {
      // Challenge rejected - validator was correct
      validator.correct_validations += 1;
      if (validator.total_validations > 0) {
        validator.accuracy_score =
          (validator.correct_validations * 10000) / validator.total_validations;
      }

      // Forfeit challenger stake to validator
      if (challengeRecord.stake > 0) {
        validator.stake += challengeRecord.stake;
      }
    }

    this.validatorsTable.update(validator, this.receiver);
  }

  @action("slash")
  slash(validator: Name, amount: u64, reason: string): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const validatorRecord = this.validatorsTable.requireGet(validator.N, "Validator not found");

    check(amount > 0, "Amount must be positive");
    check(validatorRecord.stake >= amount, "Amount exceeds validator stake");
    check(reason.length > 0 && reason.length <= 256, "Reason must be 1-256 characters");

    validatorRecord.stake -= amount;
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
    if (memo == "stake" || memo.startsWith("stake:")) {
      // Validator stake
      const validator = this.validatorsTable.get(from.N);
      check(validator != null, "Validator not registered. Register first.");

      validator!.stake += quantity.amount;
      this.validatorsTable.update(validator!, this.receiver);

      print(`Staked ${quantity.toString()} for validator ${from.toString()}`);
    } else if (memo.startsWith("challenge:")) {
      // Challenge stake
      const config = this.configSingleton.get();
      check(quantity.amount >= config.challenge_stake, "Insufficient challenge stake");

      // Extract challenge ID from memo
      const challengeIdStr = memo.substring(10);
      const challengeId = U64.parseInt(challengeIdStr);

      const challengeRecord = this.challengesTable.requireGet(challengeId, "Challenge not found");
      check(challengeRecord.challenger == from, "Not your challenge");
      check(challengeRecord.stake == 0, "Challenge already staked");

      challengeRecord.stake = quantity.amount;
      this.challengesTable.update(challengeRecord, this.receiver);
    }
  }

  // ============== HELPERS ==============

  private sendTokens(to: Name, quantity: Asset, memo: string): void {
    const transferAction = new InlineAction<TransferParams>("transfer");
    transferAction.act.authorization = [
      new PermissionLevel(this.receiver, Name.fromString("active"))
    ];
    transferAction.act.account = this.TOKEN_CONTRACT;
    transferAction.send(this.receiver, to, quantity, memo);
  }
}

// Helper class for inline transfers
@packer
class TransferParams {
  constructor(
    public from: Name = EMPTY_NAME,
    public to: Name = EMPTY_NAME,
    public quantity: Asset = new Asset(),
    public memo: string = ""
  ) {}
}

// Helper for inline action
class InlineAction<T> {
  act: Action;

  constructor(name: string) {
    this.act = new Action();
    this.act.name = Name.fromString(name);
    this.act.authorization = [];
  }

  send(from: Name, to: Name, quantity: Asset, memo: string): void {
    // Implementation handled by proton-tsc
  }
}

class Action {
  account: Name = EMPTY_NAME;
  name: Name = EMPTY_NAME;
  authorization: PermissionLevel[] = [];
  data: u8[] = [];
}

class PermissionLevel {
  constructor(
    public actor: Name = EMPTY_NAME,
    public permission: Name = EMPTY_NAME
  ) {}
}
