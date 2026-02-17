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
  print,
  EMPTY_NAME,
  Singleton,
  InlineAction,
  ActionData,
  PermissionLevel
} from "proton-tsc";

// ============== CONSTANTS ==============

const SECONDS_PER_MONTH: u64 = 30 * 24 * 60 * 60; // 30 days
const GRACE_PERIOD: u64 = 3 * 24 * 60 * 60;        // 3 days
const DATA_RETENTION: u64 = 30 * 24 * 60 * 60;     // 30 days after pause

// Subscription states
const SUB_ACTIVE: u8 = 0;
const SUB_GRACE: u8 = 1;
const SUB_PAUSED: u8 = 2;
const SUB_CANCELLED: u8 = 3;

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

// ============== TABLES ==============

@table("subs")
export class Subscription extends Table {
  constructor(
    public agent: Name = EMPTY_NAME,         // Agent account (PK)
    public owner: Name = EMPTY_NAME,         // Human who pays
    public plan: string = "",                // "hosted" or "selfhosted"
    public token_contract: Name = EMPTY_NAME, // Token contract (xmd.token or xtokens)
    public token_symbol: string = "",        // "XMD" or "XUSDC"
    public paid_until: u64 = 0,              // Subscription valid until
    public state: u8 = 0,                    // 0=active, 1=grace, 2=paused, 3=cancelled
    public cf_worker_name: string = "",      // Cloudflare worker identifier
    public total_paid: u64 = 0,              // Total amount paid over lifetime
    public created_at: u64 = 0,
    public updated_at: u64 = 0
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.agent.N;
  }

  // Note: secondary indexes (byOwner, byExpiry) removed to avoid @proton/vert
  // simulator bugs with db_idx64_update in notification handlers.
  // Off-chain queries can filter by owner/expiry client-side since the table is small.
}

@table("prices")
export class Price extends Table {
  constructor(
    public id: u64 = 0,                     // Primary key
    public token_contract: Name = EMPTY_NAME, // Token contract
    public token_symbol: string = "",        // Token symbol string
    public amount: u64 = 0,                  // Monthly price in raw units
    public active: boolean = true            // Whether this price is active
  ) {
    super();
  }

  @primary
  get primary(): u64 {
    return this.id;
  }
}

@table("config", singleton)
export class DeployConfig extends Table {
  constructor(
    public owner: Name = EMPTY_NAME,
    public core_contract: Name = EMPTY_NAME, // agentcore contract
    public paused: boolean = false,
    public total_subs: u64 = 0,
    public active_subs: u64 = 0,
    public next_price_id: u64 = 1
  ) {
    super();
  }
}

// ============== CONTRACT ==============

@contract
export class AgentDeployContract extends Contract {

  private subsTable: TableStore<Subscription> = new TableStore<Subscription>(this.receiver);
  private pricesTable: TableStore<Price> = new TableStore<Price>(this.receiver);
  private configSingleton: Singleton<DeployConfig> = new Singleton<DeployConfig>(this.receiver);

  // Token contracts
  private readonly XMD_CONTRACT: Name = Name.fromString("xmd.token");
  private readonly XTOKENS_CONTRACT: Name = Name.fromString("xtokens");

  // ============== ADMIN ACTIONS ==============

  @action("init")
  init(owner: Name, core_contract: Name): void {
    requireAuth(this.receiver);

    const existingConfig = this.configSingleton.get();
    check(existingConfig.owner == EMPTY_NAME, "Contract already initialized");

    check(isAccount(owner), "Owner account does not exist");
    check(isAccount(core_contract), "Core contract account does not exist");

    const config = new DeployConfig(owner, core_contract, false, 0, 0, 1);
    this.configSingleton.set(config, this.receiver);
  }

  @action("setconfig")
  setConfig(core_contract: Name, paused: boolean): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(isAccount(core_contract), "Core contract account does not exist");

    config.core_contract = core_contract;
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

  @action("setprice")
  setPrice(token_contract: Name, token_symbol: string, amount: u64, active: boolean): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    check(
      token_contract == this.XMD_CONTRACT || token_contract == this.XTOKENS_CONTRACT,
      "Only xmd.token (XMD) and xtokens (XUSDC) accepted"
    );
    check(token_symbol.length > 0 && token_symbol.length <= 7, "Invalid symbol");
    check(amount > 0, "Price must be positive");

    // Find existing price for this token or create new
    let found = false;
    const cursor = this.pricesTable.first();
    let price = cursor;
    while (price != null) {
      if (price.token_contract == token_contract && price.token_symbol == token_symbol) {
        price.amount = amount;
        price.active = active;
        this.pricesTable.update(price, this.receiver);
        found = true;
        break;
      }
      price = this.pricesTable.next(price);
    }

    if (!found) {
      const config2 = this.configSingleton.get();
      const nextId = config2.next_price_id;
      config2.next_price_id = nextId + 1;
      this.configSingleton.set(config2, this.receiver);

      const newPrice = new Price(nextId, token_contract, token_symbol, amount, active);
      this.pricesTable.store(newPrice, this.receiver);
    }
  }

  // ============== SUBSCRIPTION LIFECYCLE ==============

  @action("subscribe")
  subscribe(owner: Name, agent: Name, plan: string): void {
    requireAuth(owner);

    const config = this.configSingleton.get();
    check(!config.paused, "Contract is paused");
    check(plan == "hosted" || plan == "selfhosted", "Plan must be 'hosted' or 'selfhosted'");

    // Agent must not already have an active subscription
    const existing = this.subsTable.get(agent.N);
    check(
      existing == null || existing.state == SUB_CANCELLED,
      "Agent already has an active subscription"
    );

    // If re-subscribing a cancelled one, remove it first
    if (existing != null && existing.state == SUB_CANCELLED) {
      this.subsTable.remove(existing);
    }

    // Create subscription in unfunded state (paid_until = 0, state = paused)
    // Will be activated when payment arrives
    const sub = new Subscription(
      agent,
      owner,
      plan,
      EMPTY_NAME,        // Set on first payment
      "",                // Set on first payment
      0,                 // paid_until = 0 (not yet paid)
      SUB_PAUSED,        // Starts paused until funded
      "",                // cf_worker_name set by backend
      0,                 // total_paid
      currentTimeSec(),  // created_at
      currentTimeSec()   // updated_at
    );

    this.subsTable.store(sub, this.receiver);

    config.total_subs += 1;
    this.configSingleton.set(config, this.receiver);

    print(`Subscription created for agent ${agent.toString()} by ${owner.toString()}`);
  }

  @action("setworker")
  setWorker(agent: Name, cf_worker_name: string): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    check(cf_worker_name.length > 0 && cf_worker_name.length <= 128, "Worker name must be 1-128 chars");

    sub.cf_worker_name = cf_worker_name;
    sub.updated_at = currentTimeSec();
    this.subsTable.update(sub, this.receiver);
  }

  @action("pause")
  pause(agent: Name): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    check(sub.state != SUB_CANCELLED, "Subscription is cancelled");
    check(sub.state != SUB_PAUSED, "Already paused");

    sub.state = SUB_PAUSED;
    sub.updated_at = currentTimeSec();
    this.subsTable.update(sub, this.receiver);

    config.active_subs = config.active_subs > 0 ? config.active_subs - 1 : 0;
    this.configSingleton.set(config, this.receiver);

    print(`Subscription paused for ${agent.toString()}`);
  }

  @action("resume")
  resume(agent: Name): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    check(sub.state == SUB_PAUSED, "Subscription must be paused to resume");
    check(sub.paid_until > currentTimeSec(), "Subscription expired — renew first");

    sub.state = SUB_ACTIVE;
    sub.updated_at = currentTimeSec();
    this.subsTable.update(sub, this.receiver);

    config.active_subs += 1;
    this.configSingleton.set(config, this.receiver);

    print(`Subscription resumed for ${agent.toString()}`);
  }

  @action("cancel")
  cancel(owner: Name, agent: Name): void {
    requireAuth(owner);

    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    check(sub.owner == owner, "Only subscription owner can cancel");
    check(sub.state != SUB_CANCELLED, "Already cancelled");

    const config = this.configSingleton.get();
    if (sub.state == SUB_ACTIVE) {
      config.active_subs = config.active_subs > 0 ? config.active_subs - 1 : 0;
    }

    sub.state = SUB_CANCELLED;
    sub.updated_at = currentTimeSec();
    this.subsTable.update(sub, this.receiver);

    this.configSingleton.set(config, this.receiver);

    print(`Subscription cancelled for ${agent.toString()}`);
  }

  @action("cleanup")
  cleanup(agent: Name): void {
    const config = this.configSingleton.get();
    requireAuth(config.owner);

    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    check(
      sub.state == SUB_CANCELLED || sub.state == SUB_PAUSED,
      "Can only clean up cancelled or paused subscriptions"
    );

    // Only allow cleanup of paused subs if expired beyond data retention
    if (sub.state == SUB_PAUSED) {
      check(
        sub.paid_until + DATA_RETENTION < currentTimeSec(),
        "Data retention period not expired"
      );
    }

    this.subsTable.remove(sub);

    print(`Subscription cleaned up for ${agent.toString()}`);
  }

  // ============== TOKEN HANDLING ==============

  @action("transfer", notify)
  onTransfer(from: Name, to: Name, quantity: Asset, memo: string): void {
    if (to != this.receiver) return;
    if (from == this.receiver) return;

    // Must be from an accepted token contract
    check(
      this.firstReceiver == this.XMD_CONTRACT || this.firstReceiver == this.XTOKENS_CONTRACT,
      "Only XMD (xmd.token) and XUSDC (xtokens) accepted"
    );

    // Parse memo: "sub:{agent_account}"
    check(memo.startsWith("sub:"), "Invalid memo. Use 'sub:{agent_account}'");

    const agentStr = memo.substring(4);
    check(agentStr.length > 0 && agentStr.length <= 13, "Invalid agent account in memo");
    const agentName = Name.fromString(agentStr);

    const sub = this.subsTable.requireGet(agentName.N, "No subscription for this agent. Call subscribe first");
    check(sub.owner == from, "Only subscription owner can pay");
    check(sub.state != SUB_CANCELLED, "Subscription is cancelled");

    // Get symbol string from the quantity
    const symStr = quantity.symbol.getSymbolString();

    // Find matching price
    let matchedPrice: Price | null = null;
    let price = this.pricesTable.first();
    while (price != null) {
      if (
        price.token_contract == this.firstReceiver &&
        price.token_symbol == symStr &&
        price.active
      ) {
        matchedPrice = price;
        break;
      }
      price = this.pricesTable.next(price);
    }

    check(matchedPrice != null, "No active price configured for this token");
    check(<u64>quantity.amount >= matchedPrice!.amount, "Insufficient payment amount");

    const config = this.configSingleton.get();

    // Extend subscription
    const now = currentTimeSec();
    if (sub.paid_until < now) {
      // Expired or new — start from now
      sub.paid_until = now + SECONDS_PER_MONTH;
    } else {
      // Still active — extend from current end
      sub.paid_until += SECONDS_PER_MONTH;
    }

    // Track token info on first payment
    if (sub.token_contract == EMPTY_NAME) {
      sub.token_contract = this.firstReceiver;
      sub.token_symbol = symStr;
    }

    // Overflow check
    check(sub.total_paid <= U64.MAX_VALUE - <u64>quantity.amount, "Total paid would overflow");
    sub.total_paid += <u64>quantity.amount;

    // Activate if paused
    if (sub.state == SUB_PAUSED || sub.state == SUB_GRACE) {
      sub.state = SUB_ACTIVE;
      config.active_subs += 1;
    }

    sub.updated_at = now;
    this.subsTable.update(sub, this.receiver);
    this.configSingleton.set(config, this.receiver);

    // Refund overpayment
    const excess = <u64>quantity.amount - matchedPrice!.amount;
    if (excess > 0) {
      const TRANSFER_ACTION = new InlineAction<Transfer>("transfer");
      const action = TRANSFER_ACTION.act(this.firstReceiver, new PermissionLevel(this.receiver));
      const actionParams = new Transfer(
        this.receiver,
        from,
        new Asset(excess, quantity.symbol),
        `Overpayment refund for ${agentStr}`
      );
      action.send(actionParams);
    }

    print(`Subscription renewed for ${agentStr}. Paid until: ${sub.paid_until}`);
  }

  // ============== VIEW HELPERS ==============

  @action("checkexpiry")
  checkExpiry(agent: Name): void {
    // Anyone can call this to trigger state transitions
    const sub = this.subsTable.requireGet(agent.N, "Subscription not found");
    const now = currentTimeSec();
    const config = this.configSingleton.get();

    if (sub.state == SUB_ACTIVE && sub.paid_until < now) {
      if (now - sub.paid_until < GRACE_PERIOD) {
        sub.state = SUB_GRACE;
        print(`Subscription ${agent.toString()} entered grace period`);
      } else {
        sub.state = SUB_PAUSED;
        config.active_subs = config.active_subs > 0 ? config.active_subs - 1 : 0;
        print(`Subscription ${agent.toString()} paused — payment overdue`);
      }
      sub.updated_at = now;
      this.subsTable.update(sub, this.receiver);
      this.configSingleton.set(config, this.receiver);
    } else if (sub.state == SUB_GRACE && now - sub.paid_until >= GRACE_PERIOD) {
      sub.state = SUB_PAUSED;
      config.active_subs = config.active_subs > 0 ? config.active_subs - 1 : 0;
      sub.updated_at = now;
      this.subsTable.update(sub, this.receiver);
      this.configSingleton.set(config, this.receiver);
      print(`Subscription ${agent.toString()} paused — grace period expired`);
    }
  }
}
