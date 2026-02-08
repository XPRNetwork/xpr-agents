import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/schema';
import { handleAgentAction, handleAgentCoreTransfer } from '../src/handlers/agent';
import { handleFeedbackAction } from '../src/handlers/feedback';
import { handleValidationAction } from '../src/handlers/validation';
import { handleEscrowAction } from '../src/handlers/escrow';
import { StreamAction } from '../src/stream';

/* ------------------------------------------------------------------ */
/*  Test Helpers                                                        */
/* ------------------------------------------------------------------ */

function createAction(account: string, name: string, data: Record<string, any>, overrides: Partial<StreamAction> = {}): StreamAction {
  return {
    block_num: 100,
    timestamp: '2024-01-15T12:00:00.000Z',
    trx_id: 'abc123',
    act: {
      account,
      name,
      authorization: [{ actor: data.account || 'test', permission: 'active' }],
      data,
    },
    ...overrides,
  };
}

let db: Database.Database;

beforeEach(() => {
  db = initDatabase(':memory:');
});

/* ------------------------------------------------------------------ */
/*  Schema & Init Tests                                                */
/* ------------------------------------------------------------------ */

describe('Database Schema', () => {
  it('should create all required tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('agents');
    expect(tableNames).toContain('agent_scores');
    expect(tableNames).toContain('feedback');
    expect(tableNames).toContain('feedback_disputes');
    expect(tableNames).toContain('validators');
    expect(tableNames).toContain('validations');
    expect(tableNames).toContain('validation_challenges');
    expect(tableNames).toContain('plugins');
    expect(tableNames).toContain('events');
    expect(tableNames).toContain('stats');
    expect(tableNames).toContain('jobs');
    expect(tableNames).toContain('milestones');
    expect(tableNames).toContain('escrow_disputes');
    expect(tableNames).toContain('arbitrators');
    expect(tableNames).toContain('webhook_subscriptions');
    expect(tableNames).toContain('webhook_deliveries');
    expect(tableNames).toContain('stream_cursor');
  });

  it('should initialize stats rows', () => {
    const stats = db.prepare('SELECT key, value FROM stats').all() as { key: string; value: number }[];
    const statKeys = stats.map(s => s.key);

    expect(statKeys).toContain('total_agents');
    expect(statKeys).toContain('active_agents');
    expect(statKeys).toContain('total_validators');
    expect(statKeys).toContain('total_feedback');
    expect(statKeys).toContain('total_validations');
    expect(statKeys).toContain('total_jobs');
  });

  it('should initialize stream cursor', () => {
    const cursor = db.prepare('SELECT last_block_num FROM stream_cursor WHERE id = 1').get() as { last_block_num: number };
    expect(cursor.last_block_num).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Agent Handler Tests                                                */
/* ------------------------------------------------------------------ */

describe('Agent Handlers', () => {
  it('should handle register action', () => {
    const action = createAction('agentcore', 'register', {
      account: 'alice',
      name: 'Alice Agent',
      description: 'An AI agent',
      endpoint: 'https://api.alice.com',
      protocol: 'https',
      capabilities: '["chat","code"]',
    });

    handleAgentAction(db, action);

    const agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('alice') as any;
    expect(agent).toBeTruthy();
    expect(agent.name).toBe('Alice Agent');
    expect(agent.endpoint).toBe('https://api.alice.com');
    expect(agent.active).toBe(1);
  });

  it('should handle update action', () => {
    // Register first
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    // Update
    handleAgentAction(db, createAction('agentcore', 'update', {
      account: 'alice', name: 'Alice v2', description: 'Updated', endpoint: 'https://new.com', protocol: 'grpc', capabilities: '["chat"]',
    }));

    const agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('alice') as any;
    expect(agent.name).toBe('Alice v2');
    expect(agent.endpoint).toBe('https://new.com');
  });

  it('should handle setstatus action', () => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    handleAgentAction(db, createAction('agentcore', 'setstatus', {
      account: 'alice', active: false,
    }));

    const agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('alice') as any;
    expect(agent.active).toBe(0);
  });

  it('should handle incjobs action', () => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    handleAgentAction(db, createAction('agentcore', 'incjobs', { account: 'alice' }));

    const agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('alice') as any;
    expect(agent.total_jobs).toBe(1);
  });

  it('should log events for all actions', () => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    const events = db.prepare('SELECT * FROM events WHERE contract = ?').all('agentcore');
    expect(events.length).toBe(1);
  });

  it('should update stats after action', () => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    const stat = db.prepare("SELECT value FROM stats WHERE key = 'total_agents'").get() as { value: number };
    expect(stat.value).toBe(1);
  });

  it('should handle ownership actions (approveclaim, claim, release)', () => {
    // Register agent
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'botaccount', name: 'Bot', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));

    // Approve claim
    handleAgentAction(db, createAction('agentcore', 'approveclaim', {
      agent: 'botaccount', new_owner: 'alice',
    }));

    let agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.pending_owner).toBe('alice');

    // Claim
    handleAgentAction(db, createAction('agentcore', 'claim', { agent: 'botaccount' }));

    agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.owner).toBe('alice');
    expect(agent.pending_owner).toBeNull();

    // Release
    handleAgentAction(db, createAction('agentcore', 'release', { agent: 'botaccount' }));

    agent = db.prepare('SELECT * FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.owner).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Agent Core Transfer Handler Tests                                  */
/* ------------------------------------------------------------------ */

describe('Agent Core Transfer', () => {
  beforeEach(() => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'botaccount', name: 'Bot', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));
  });

  it('should handle claim deposit', () => {
    const action = createAction('eosio.token', 'transfer', {
      from: 'alice',
      to: 'agentcore',
      quantity: '1.0000 XPR',
      memo: 'claim:botaccount:alice',
    });
    // Wrap the data to match handleAgentCoreTransfer's expected shape
    action.act.data = { from: 'alice', to: 'agentcore', quantity: '1.0000 XPR', memo: 'claim:botaccount:alice' };

    handleAgentCoreTransfer(db, action);

    const agent = db.prepare('SELECT claim_deposit, deposit_payer FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.claim_deposit).toBe(10000); // 1.0000 XPR
    expect(agent.deposit_payer).toBe('alice');
  });

  it('should ignore non-claim memos', () => {
    const action = createAction('eosio.token', 'transfer', {
      from: 'alice', to: 'agentcore', quantity: '1.0000 XPR', memo: 'stake',
    });
    action.act.data = { from: 'alice', to: 'agentcore', quantity: '1.0000 XPR', memo: 'stake' };

    handleAgentCoreTransfer(db, action);

    const agent = db.prepare('SELECT claim_deposit FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.claim_deposit).toBe(0);
  });

  it('should handle invalid claim memo format', () => {
    const action = createAction('eosio.token', 'transfer', {
      from: 'alice', to: 'agentcore', quantity: '1.0000 XPR', memo: 'claim:botaccount',
    });
    action.act.data = { from: 'alice', to: 'agentcore', quantity: '1.0000 XPR', memo: 'claim:botaccount' };

    // Should not throw
    handleAgentCoreTransfer(db, action);

    const agent = db.prepare('SELECT claim_deposit FROM agents WHERE account = ?').get('botaccount') as any;
    expect(agent.claim_deposit).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Feedback Handler Tests                                             */
/* ------------------------------------------------------------------ */

describe('Feedback Handlers', () => {
  beforeEach(() => {
    // Register agent first (foreign key)
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));
  });

  it('should handle submit action', () => {
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 4, tags: 'quality', job_hash: 'hash1', evidence_uri: 'ipfs://ev1', amount_paid: 0,
    }));

    const feedback = db.prepare('SELECT * FROM feedback WHERE agent = ?').all('alice') as any[];
    expect(feedback.length).toBe(1);
    expect(feedback[0].score).toBe(4);
    expect(feedback[0].reviewer).toBe('bob');
  });

  it('should update agent score on submit', () => {
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 5, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));

    const score = db.prepare('SELECT * FROM agent_scores WHERE agent = ?').get('alice') as any;
    expect(score).toBeTruthy();
    expect(score.feedback_count).toBe(1);
    // KYC level 0: weight=1, score*weight=5*1=5, weight*5=5, avg=(5*10000)/5=10000
    expect(score.avg_score).toBe(10000);
  });

  it('should handle dispute action', () => {
    // Submit feedback first
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 4, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));

    // Dispute it
    handleFeedbackAction(db, createAction('agentfeed', 'dispute', {
      disputer: 'alice', feedback_id: 1, reason: 'Inaccurate', evidence_uri: 'ipfs://proof',
    }));

    const feedback = db.prepare('SELECT * FROM feedback WHERE id = 1').get() as any;
    expect(feedback.disputed).toBe(1);

    const dispute = db.prepare('SELECT * FROM feedback_disputes WHERE feedback_id = 1').get() as any;
    expect(dispute).toBeTruthy();
    expect(dispute.status).toBe(0); // pending
  });

  it('should handle resolve action', () => {
    // Submit + dispute
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 4, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));
    handleFeedbackAction(db, createAction('agentfeed', 'dispute', {
      disputer: 'alice', feedback_id: 1, reason: 'Inaccurate', evidence_uri: '',
    }));

    // Resolve - upheld
    handleFeedbackAction(db, createAction('agentfeed', 'resolve', {
      resolver: 'owner', dispute_id: 1, upheld: true, resolution_notes: 'Verified',
    }));

    const feedback = db.prepare('SELECT * FROM feedback WHERE id = 1').get() as any;
    expect(feedback.resolved).toBe(1);

    const dispute = db.prepare('SELECT * FROM feedback_disputes WHERE id = 1').get() as any;
    expect(dispute.status).toBe(1); // upheld

    // Score should exclude upheld dispute
    const score = db.prepare('SELECT * FROM agent_scores WHERE agent = ?').get('alice') as any;
    expect(score.feedback_count).toBe(0);
  });

  it('should handle reinstate action', () => {
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 4, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));
    handleFeedbackAction(db, createAction('agentfeed', 'dispute', {
      disputer: 'bob', feedback_id: 1, reason: 'Mistake', evidence_uri: '',
    }));

    // Reinstate
    handleFeedbackAction(db, createAction('agentfeed', 'reinstate', { feedback_id: 1 }));

    const feedback = db.prepare('SELECT * FROM feedback WHERE id = 1').get() as any;
    expect(feedback.disputed).toBe(0);
  });

  it('should calculate correct avg_score for multiple feedbacks', () => {
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'bob', agent: 'alice', score: 5, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));
    handleFeedbackAction(db, createAction('agentfeed', 'submit', {
      reviewer: 'carol', agent: 'alice', score: 3, tags: '', job_hash: '', evidence_uri: '', amount_paid: 0,
    }));

    const score = db.prepare('SELECT * FROM agent_scores WHERE agent = ?').get('alice') as any;
    // Both KYC=0: weight=1 each
    // total_score = 5*1 + 3*1 = 8, total_weight = 1*5 + 1*5 = 10
    // avg = (8 * 10000) / 10 = 8000
    expect(score.avg_score).toBe(8000);
    expect(score.feedback_count).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Validation Handler Tests                                           */
/* ------------------------------------------------------------------ */

describe('Validation Handlers', () => {
  beforeEach(() => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));
  });

  it('should handle regval action', () => {
    handleValidationAction(db, createAction('agentvalid', 'regval', {
      account: 'validator1', method: 'automated', specializations: '["ai"]',
    }));

    const validator = db.prepare('SELECT * FROM validators WHERE account = ?').get('validator1') as any;
    expect(validator).toBeTruthy();
    expect(validator.method).toBe('automated');
    expect(validator.active).toBe(1);
    expect(validator.accuracy_score).toBe(10000);
  });

  it('should handle validate action', () => {
    // Register validator
    handleValidationAction(db, createAction('agentvalid', 'regval', {
      account: 'validator1', method: 'auto', specializations: '[]',
    }));

    // Submit validation
    handleValidationAction(db, createAction('agentvalid', 'validate', {
      validator: 'validator1', agent: 'alice', job_hash: 'hash1', result: 1, confidence: 95, evidence_uri: 'ipfs://ev',
    }));

    const validation = db.prepare('SELECT * FROM validations WHERE agent = ?').all('alice') as any[];
    expect(validation.length).toBe(1);
    expect(validation[0].result).toBe(1);
    expect(validation[0].confidence).toBe(95);
  });

  it('should handle challenge action', () => {
    // Register validator + validate
    handleValidationAction(db, createAction('agentvalid', 'regval', {
      account: 'validator1', method: 'auto', specializations: '[]',
    }));
    handleValidationAction(db, createAction('agentvalid', 'validate', {
      validator: 'validator1', agent: 'alice', job_hash: 'hash1', result: 1, confidence: 95, evidence_uri: '',
    }));

    // Challenge
    handleValidationAction(db, createAction('agentvalid', 'challenge', {
      challenger: 'bob', validation_id: 1, reason: 'Incorrect', evidence_uri: 'ipfs://proof',
    }));

    const challenge = db.prepare('SELECT * FROM validation_challenges WHERE validation_id = 1').get() as any;
    expect(challenge).toBeTruthy();
    expect(challenge.challenger).toBe('bob');
    expect(challenge.status).toBe(0); // pending
  });
});

/* ------------------------------------------------------------------ */
/*  Escrow Handler Tests                                               */
/* ------------------------------------------------------------------ */

describe('Escrow Handlers', () => {
  beforeEach(() => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }));
  });

  it('should handle createjob action', () => {
    handleEscrowAction(db, createAction('agentescrow', 'createjob', {
      client: 'bob',
      agent: 'alice',
      title: 'Data Analysis',
      description: 'Analyze dataset',
      deliverables: '["report"]',
      amount: 50000,
      deadline: 1700100000,
      arbitrator: '',
    }));

    const job = db.prepare('SELECT * FROM jobs WHERE agent = ?').get('alice') as any;
    expect(job).toBeTruthy();
    expect(job.title).toBe('Data Analysis');
    expect(job.client).toBe('bob');
    expect(job.state).toBe(0); // CREATED
  });

  it('should handle acceptjob action', () => {
    handleEscrowAction(db, createAction('agentescrow', 'createjob', {
      client: 'bob', agent: 'alice', title: 'Job', description: '', deliverables: '', amount: 50000, deadline: 0, arbitrator: '',
    }));

    handleEscrowAction(db, createAction('agentescrow', 'acceptjob', { job_id: 1, agent: 'alice' }));

    const job = db.prepare('SELECT * FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(2); // ACCEPTED
  });

  it('should handle full job lifecycle', () => {
    // Create
    handleEscrowAction(db, createAction('agentescrow', 'createjob', {
      client: 'bob', agent: 'alice', title: 'Job', description: '', deliverables: '', amount: 50000, deadline: 0, arbitrator: '',
    }));

    // Accept
    handleEscrowAction(db, createAction('agentescrow', 'acceptjob', { job_id: 1, agent: 'alice' }));

    // Start
    handleEscrowAction(db, createAction('agentescrow', 'startjob', { job_id: 1 }));
    let job = db.prepare('SELECT state FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(3); // ACTIVE

    // Deliver
    handleEscrowAction(db, createAction('agentescrow', 'deliver', { job_id: 1, evidence_uri: 'ipfs://result' }));
    job = db.prepare('SELECT state FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(4); // DELIVERED

    // Approve
    handleEscrowAction(db, createAction('agentescrow', 'approve', { job_id: 1 }));
    job = db.prepare('SELECT state FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(6); // COMPLETED
  });

  it('should handle dispute and arbitrate', () => {
    // Create and start job
    handleEscrowAction(db, createAction('agentescrow', 'createjob', {
      client: 'bob', agent: 'alice', title: 'Job', description: '', deliverables: '', amount: 50000, deadline: 0, arbitrator: 'arb1',
    }));
    handleEscrowAction(db, createAction('agentescrow', 'acceptjob', { job_id: 1, agent: 'alice' }));
    handleEscrowAction(db, createAction('agentescrow', 'startjob', { job_id: 1 }));

    // Dispute
    handleEscrowAction(db, createAction('agentescrow', 'dispute', {
      job_id: 1, raised_by: 'bob', reason: 'Not delivered', evidence_uri: '',
    }));

    let job = db.prepare('SELECT state FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(5); // DISPUTED

    const dispute = db.prepare('SELECT * FROM escrow_disputes WHERE job_id = 1').get() as any;
    expect(dispute).toBeTruthy();
    expect(dispute.raised_by).toBe('bob');

    // Arbitrate
    handleEscrowAction(db, createAction('agentescrow', 'arbitrate', {
      dispute_id: 1, arbitrator: 'arb1', client_percent: 70, resolution_notes: 'Partial delivery',
    }));

    job = db.prepare('SELECT state FROM jobs WHERE id = 1').get() as any;
    expect(job.state).toBe(8); // ARBITRATED
  });

  it('should update stats after job creation', () => {
    handleEscrowAction(db, createAction('agentescrow', 'createjob', {
      client: 'bob', agent: 'alice', title: 'Job', description: '', deliverables: '', amount: 50000, deadline: 0, arbitrator: '',
    }));

    const stat = db.prepare("SELECT value FROM stats WHERE key = 'total_jobs_escrow'").get() as { value: number };
    expect(stat.value).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Event Logging Tests                                                */
/* ------------------------------------------------------------------ */

describe('Event Logging', () => {
  it('should log events with correct metadata', () => {
    handleAgentAction(db, createAction('agentcore', 'register', {
      account: 'alice', name: 'Alice', description: '', endpoint: '', protocol: '', capabilities: '[]',
    }, { block_num: 12345, trx_id: 'tx_abc123' }));

    const event = db.prepare('SELECT * FROM events WHERE action_name = ?').get('register') as any;
    expect(event.block_num).toBe(12345);
    expect(event.transaction_id).toBe('tx_abc123');
    expect(event.contract).toBe('agentcore');

    const data = JSON.parse(event.data);
    expect(data.account).toBe('alice');
  });
});
