// Main SDK exports
export { AgentRegistry } from './AgentRegistry';
export { FeedbackRegistry } from './FeedbackRegistry';
export { ValidationRegistry } from './ValidationRegistry';
export { EscrowRegistry } from './EscrowRegistry';

// Escrow types (exported separately since they're defined in the registry file)
export type {
  Job,
  JobState,
  Milestone,
  MilestoneState,
  EscrowDispute,
  DisputeResolution,
  Arbitrator,
  CreateJobData,
  AddMilestoneData,
  JobListOptions,
} from './EscrowRegistry';

// Type exports
export * from './types';

// Utility exports
export {
  calculateTrustScore,
  getTrustRating,
  formatXpr,
  parseXpr,
  formatTimestamp,
  isValidAccountName,
  isValidUrl,
  getKycWeight,
} from './utils';

// Default contract names
export const CONTRACTS = {
  AGENT_CORE: 'agentcore',
  AGENT_FEED: 'agentfeed',
  AGENT_VALID: 'agentvalid',
  AGENT_ESCROW: 'agentescrow',
} as const;

// Network endpoints
export const NETWORKS = {
  MAINNET: {
    rpc: 'https://proton.eosusa.io',
    hyperion: 'https://proton.eosusa.io',
    chainId: '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0',
  },
  TESTNET: {
    rpc: 'https://tn1.protonnz.com',
    hyperion: 'https://proton-testnet.eosusa.io',
    chainId: '71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd',
  },
} as const;
