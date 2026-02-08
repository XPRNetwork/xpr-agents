// ============== Agent Types ==============

export interface Agent {
  account: string;
  owner: string | null;           // KYC'd human who sponsors this agent (null if unowned)
  pending_owner: string | null;   // Approved claimant awaiting completion (2-step claim)
  name: string;
  description: string;
  endpoint: string;
  protocol: string;
  capabilities: string[];
  total_jobs: number;
  registered_at: number;
  active: boolean;
  claim_deposit: number;          // Refundable deposit paid when claiming
  deposit_payer: string | null;   // Who paid the deposit (must match claimant)
  // Note: Agents stake via system staking (eosio::voters), not contract-managed staking
  // Use getSystemStake() from agentcore::getagentinfo to query stake
}

export interface AgentRaw {
  account: string;
  owner: string;
  pending_owner: string;
  name: string;
  description: string;
  endpoint: string;
  protocol: string;
  capabilities: string;
  total_jobs: string;
  registered_at: string;
  active: number;
  claim_deposit: string;
  deposit_payer: string;
}

export interface Plugin {
  id: number;
  name: string;
  version: string;
  contract: string;
  action: string;
  schema: object;
  category: PluginCategory;
  author: string;
  verified: boolean;
}

export interface PluginRaw {
  id: string;
  name: string;
  version: string;
  contract: string;
  action: string;
  schema: string;
  category: string;
  author: string;
  verified: number;
}

export interface AgentPlugin {
  id: number;
  agent: string;
  plugin_id: number;
  config: object;
  enabled: boolean;
}

export interface AgentPluginRaw {
  id: string;
  agent: string;
  plugin_id: string;
  config: string;
  enabled: number;
}

export interface Unstake {
  id: number;
  validator: string;  // HIGH FIX: Changed from 'agent' to match agentvalid::unstakes table
  amount: number;
  request_time: number;
  available_at: number;
}

export interface AgentCoreConfig {
  owner: string;
  min_stake: number;
  registration_fee: number;
  claim_fee: number;              // Fee to claim an agent (refundable on release)
  feed_contract: string;
  valid_contract: string;
  escrow_contract: string;
  paused: boolean;
}

export interface FeedbackConfig {
  owner: string;
  core_contract: string;
  min_score: number;
  max_score: number;
  dispute_window: number;
  decay_period: number;
  decay_floor: number;
  paused: boolean;
  feedback_fee: number;
}

export interface ValidationConfig {
  owner: string;
  core_contract: string;
  min_stake: number;
  challenge_stake: number;
  unstake_delay: number;
  challenge_window: number;
  slash_percent: number;
  dispute_period: number;
  funded_challenge_timeout: number;
  paused: boolean;
  validation_fee: number;
}

export type PluginCategory = 'compute' | 'storage' | 'oracle' | 'payment' | 'messaging' | 'ai';

// ============== Feedback Types ==============

export interface Feedback {
  id: number;
  agent: string;
  reviewer: string;
  reviewer_kyc_level: number;
  score: number;
  tags: string[];
  job_hash: string;
  evidence_uri: string;
  amount_paid: number;
  timestamp: number;
  disputed: boolean;
  resolved: boolean;
}

export interface FeedbackRaw {
  id: string;
  agent: string;
  reviewer: string;
  reviewer_kyc_level: number;
  score: number;
  tags: string;
  job_hash: string;
  evidence_uri: string;
  amount_paid: string;
  timestamp: string;
  disputed: number;
  resolved: number;
}

export interface AgentScore {
  agent: string;
  total_score: number;
  total_weight: number;
  feedback_count: number;
  avg_score: number;
  last_updated: number;
}

export interface AgentScoreRaw {
  agent: string;
  total_score: string;
  total_weight: string;
  feedback_count: string;
  avg_score: string;
  last_updated: string;
}

export interface Dispute {
  id: number;
  feedback_id: number;
  disputer: string;
  reason: string;
  evidence_uri: string;
  status: DisputeStatus;
  resolver: string;
  resolution_notes: string;
  created_at: number;
  resolved_at: number;
}

export type DisputeStatus = 'pending' | 'upheld' | 'rejected' | 'cancelled';

// ============== Validation Types ==============

export interface Validator {
  account: string;
  stake: number;
  method: string;
  specializations: string[];
  total_validations: number;
  incorrect_validations: number;
  accuracy_score: number;
  pending_challenges: number;
  registered_at: number;
  active: boolean;
}

export interface ValidatorRaw {
  account: string;
  stake: string;
  method: string;
  specializations: string;
  total_validations: string;
  incorrect_validations: string;
  accuracy_score: string;
  pending_challenges: string;
  registered_at: string;
  active: number;
}

export interface Validation {
  id: number;
  validator: string;
  agent: string;
  job_hash: string;
  result: ValidationResult;
  confidence: number;
  evidence_uri: string;
  challenged: boolean;
  timestamp: number;
}

export interface ValidationRaw {
  id: string;
  validator: string;
  agent: string;
  job_hash: string;
  result: number;
  confidence: number;
  evidence_uri: string;
  challenged: number;
  timestamp: string;
}

export type ValidationResult = 'fail' | 'pass' | 'partial';

export interface Challenge {
  id: number;
  validation_id: number;
  challenger: string;
  reason: string;
  evidence_uri: string;
  stake: number;
  status: DisputeStatus;
  resolver: string;
  resolution_notes: string;
  created_at: number;
  resolved_at: number;
  funding_deadline: number;
  funded_at: number;
}

// ============== Trust Score Types ==============

export interface TrustScore {
  agent: string;
  total: number;
  breakdown: TrustScoreBreakdown;
  rating: TrustRating;
}

export interface TrustScoreBreakdown {
  kyc: number;
  stake: number;
  reputation: number;
  longevity: number;
}

export type TrustRating = 'untrusted' | 'low' | 'medium' | 'high' | 'verified';

// ============== Pagination Types ==============

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

export interface PaginationOptions {
  limit?: number;
  cursor?: string;
}

// ============== List Options ==============

export interface ListOptions extends PaginationOptions {
  active_only?: boolean;
}

export interface AgentListOptions extends ListOptions {
  category?: PluginCategory;
  min_trust_score?: number;
  // Note: Agents use system staking, not contract-managed staking
  // Filter by system stake via separate query to eosio::voters table
}

export interface FeedbackListOptions extends ListOptions {
  agent?: string;
  reviewer?: string;
  min_score?: number;
  max_score?: number;
}

export interface ValidatorListOptions extends ListOptions {
  min_stake?: number;
  min_accuracy?: number;
  specialization?: string;
}

// ============== Transaction Types ==============

export interface TransactionResult {
  transaction_id: string;
  processed: {
    block_num: number;
    block_time: string;
  };
}

export interface RegisterAgentData {
  name: string;
  description: string;
  endpoint: string;
  protocol: string;
  capabilities: string[];
}

export interface UpdateAgentData {
  name?: string;
  description?: string;
  endpoint?: string;
  protocol?: string;
  capabilities?: string[];
}

export interface SubmitFeedbackData {
  agent: string;
  score: number;
  tags?: string[];
  job_hash?: string;
  evidence_uri?: string;
  amount_paid?: number;
}

export interface SubmitValidationData {
  agent: string;
  job_hash: string;
  result: ValidationResult;
  confidence: number;
  evidence_uri?: string;
}

// ============== Session Types ==============

export interface ProtonSession {
  auth: {
    actor: string;
    permission: string;
  };
  link: {
    transact: (args: TransactArgs) => Promise<TransactionResult>;
  };
}

export interface TransactArgs {
  actions: TransactAction[];
}

export interface TransactAction {
  account: string;
  name: string;
  authorization: Array<{
    actor: string;
    permission: string;
  }>;
  data: Record<string, unknown>;
}

// ============== RPC Types ==============

export interface JsonRpc {
  get_table_rows<T>(params: GetTableRowsParams): Promise<GetTableRowsResult<T>>;
}

export interface GetTableRowsParams {
  json: boolean;
  code: string;
  scope: string;
  table: string;
  lower_bound?: string;
  upper_bound?: string;
  limit?: number;
  key_type?: string;
  index_position?: number;
  reverse?: boolean;
}

export interface GetTableRowsResult<T> {
  rows: T[];
  more: boolean;
  next_key?: string;
}

// ============== A2A Protocol Types ==============

export type A2ATaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { name?: string; mimeType: string; uri?: string; bytes?: string } }
  | { type: 'data'; data: Record<string, unknown> };

export interface A2ATask {
  id: string;
  contextId?: string;
  status: { state: A2ATaskState; message?: A2AMessage; timestamp: string };
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index: number;
  lastChunk?: boolean;
}

export interface XprAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: { id: string; name: string; description: string; tags: string[] }[];
  'xpr:account': string;
  'xpr:protocol': string;
  'xpr:trustScore'?: number;
  'xpr:kycLevel'?: number;
  'xpr:registeredAt': number;
  'xpr:owner'?: string;
}

export interface A2AJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface A2AJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}
