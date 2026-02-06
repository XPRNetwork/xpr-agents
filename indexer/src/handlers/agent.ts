import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';
import { WebhookDispatcher } from '../webhooks/dispatcher';

export function handleAgentAction(db: Database.Database, action: StreamAction, dispatcher?: WebhookDispatcher): void {
  const { name, data } = action.act;

  switch (name) {
    case 'register':
      handleRegister(db, data, action.timestamp);
      dispatcher?.dispatch(
        'agent.registered',
        [data.account],
        data,
        `New agent registered: ${data.account} ("${data.name}")`,
        action.block_num
      );
      break;
    case 'update':
      handleUpdate(db, data);
      break;
    case 'setstatus':
      handleSetStatus(db, data);
      dispatcher?.dispatch(
        'agent.status_changed',
        [data.account],
        data,
        `Agent ${data.account} ${data.active ? 'activated' : 'deactivated'}`,
        action.block_num
      );
      break;
    case 'incjobs':
      handleIncJobs(db, data);
      break;
    case 'regplugin':
      handleRegPlugin(db, data);
      break;
    case 'addplugin':
      handleAddPlugin(db, data);
      break;
    case 'rmplugin':
      handleRemovePlugin(db, data);
      break;
    case 'toggleplug':
      handleTogglePlugin(db, data);
      break;
    case 'verifyplugin':
      handleVerifyPlugin(db, data);
      break;
    // P2 FIX: Add ownership action handlers
    case 'approveclaim':
      handleApproveClaim(db, data);
      break;
    case 'claim':
      handleClaim(db, data);
      dispatcher?.dispatch(
        'agent.claimed',
        [data.agent],
        data,
        `Agent ${data.agent} claimed`,
        action.block_num
      );
      break;
    case 'cancelclaim':
      handleCancelClaim(db, data);
      break;
    case 'transfer':
      handleTransferOwnership(db, data);
      dispatcher?.dispatch(
        'agent.transferred',
        [data.agent, data.new_owner],
        data,
        `Agent ${data.agent} ownership transferred to ${data.new_owner}`,
        action.block_num
      );
      break;
    case 'release':
      handleRelease(db, data);
      dispatcher?.dispatch(
        'agent.released',
        [data.agent],
        data,
        `Agent ${data.agent} released from ownership`,
        action.block_num
      );
      break;
    case 'verifyclaim':
      handleVerifyClaim(db, data, action);
      break;
    case 'pluginres':
      handlePluginResult(db, data, action.timestamp);
      break;
    case 'cleanresults':
      // On-chain cleanup only - indexer can keep historical results
      break;
    default:
      // Log unknown action
      console.log(`Unknown agentcore action: ${name}`);
  }

  // Log event
  logEvent(db, action);

  // Update stats
  updateStats(db);
}

function handleRegister(db: Database.Database, data: any, timestamp: string): void {
  // P2 FIX: Include ownership fields in registration (all null/0 for new agents)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agents (account, owner, pending_owner, name, description, endpoint, protocol, capabilities, stake, total_jobs, registered_at, active, claim_deposit, deposit_payer)
    VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 0, 0, ?, 1, 0, NULL)
  `);

  const registeredAt = Math.floor(new Date(timestamp).getTime() / 1000);

  stmt.run(
    data.account,
    data.name,
    data.description || '',
    data.endpoint || '',
    data.protocol || '',
    data.capabilities || '[]',
    registeredAt
  );

  console.log(`Agent registered: ${data.account}`);
}

function handleUpdate(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET name = ?, description = ?, endpoint = ?, protocol = ?, capabilities = ?, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(
    data.name,
    data.description || '',
    data.endpoint || '',
    data.protocol || '',
    data.capabilities || '[]',
    data.account
  );

  console.log(`Agent updated: ${data.account}`);
}

function handleSetStatus(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET active = ?, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.active ? 1 : 0, data.account);

  console.log(`Agent status changed: ${data.account} -> ${data.active ? 'active' : 'inactive'}`);
}

function handleIncJobs(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET total_jobs = total_jobs + 1, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.account);

  console.log(`Agent jobs incremented: ${data.account}`);
}

function handleRegPlugin(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    INSERT INTO plugins (id, name, version, contract, action, schema, category, author, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  // Generate ID based on existing count
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM plugins');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  stmt.run(
    id,
    data.name,
    data.version,
    data.contract,
    data.action,
    data.schema || '{}',
    data.category,
    data.author
  );

  console.log(`Plugin registered: ${data.name}`);
}

// Plugin lifecycle handlers

function handleAddPlugin(db: Database.Database, data: any): void {
  // Contract: addplugin(agent, plugin_id, pluginConfig)
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM agent_plugins');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO agent_plugins (id, agent, plugin_id, config, enabled)
    VALUES (?, ?, ?, ?, 1)
  `);
  stmt.run(id, data.agent, data.plugin_id, data.pluginConfig || '{}');
  console.log(`Plugin ${data.plugin_id} added to agent ${data.agent}`);
}

function handleRemovePlugin(db: Database.Database, data: any): void {
  // Contract: rmplugin(agent, agentplugin_id)
  const stmt = db.prepare('DELETE FROM agent_plugins WHERE id = ?');
  stmt.run(data.agentplugin_id);
  console.log(`Agent plugin ${data.agentplugin_id} removed`);
}

function handleTogglePlugin(db: Database.Database, data: any): void {
  // Contract: toggleplug(agent, agentplugin_id, enabled)
  const stmt = db.prepare('UPDATE agent_plugins SET enabled = ? WHERE id = ?');
  stmt.run(data.enabled ? 1 : 0, data.agentplugin_id);
  console.log(`Agent plugin ${data.agentplugin_id} ${data.enabled ? 'enabled' : 'disabled'}`);
}

function handleVerifyPlugin(db: Database.Database, data: any): void {
  // Contract: verifyplugin(plugin_id, verified)
  const stmt = db.prepare('UPDATE plugins SET verified = ? WHERE id = ?');
  stmt.run(data.verified ? 1 : 0, data.plugin_id);
  console.log(`Plugin ${data.plugin_id} ${data.verified ? 'verified' : 'unverified'}`);
}

function handlePluginResult(db: Database.Database, data: any, timestamp: string): void {
  const countStmt = db.prepare('SELECT MAX(id) as max_id FROM plugin_results');
  const result = countStmt.get() as { max_id: number | null };
  const id = (result.max_id || 0) + 1;

  const ts = Math.floor(new Date(timestamp).getTime() / 1000);

  const stmt = db.prepare(`
    INSERT INTO plugin_results (id, agent, plugin_id, job_id, status, result_data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.agent, data.plugin_id, data.job_id || 0, data.status, data.result_data || '', ts);
  console.log(`Plugin result stored: agent=${data.agent} plugin=${data.plugin_id} status=${data.status}`);
}

// P2 FIX: Ownership action handlers

function handleApproveClaim(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET pending_owner = ?, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.new_owner, data.agent);

  console.log(`Agent ${data.agent} approved claim by ${data.new_owner}`);
}

function handleClaim(db: Database.Database, data: any): void {
  // When claim completes, pending_owner becomes owner
  // First get the pending_owner to set as new owner
  const getStmt = db.prepare('SELECT pending_owner, claim_deposit, deposit_payer FROM agents WHERE account = ?');
  const agent = getStmt.get(data.agent) as { pending_owner: string; claim_deposit: number; deposit_payer: string } | undefined;

  if (agent && agent.pending_owner) {
    const stmt = db.prepare(`
      UPDATE agents
      SET owner = ?, pending_owner = NULL, updated_at = strftime('%s', 'now')
      WHERE account = ?
    `);

    stmt.run(agent.pending_owner, data.agent);

    console.log(`Agent ${data.agent} claimed by ${agent.pending_owner}`);
  }
}

function handleCancelClaim(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET pending_owner = NULL, claim_deposit = 0, deposit_payer = NULL, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.agent);

  console.log(`Agent ${data.agent} claim cancelled`);
}

function handleTransferOwnership(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET owner = ?, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.new_owner, data.agent);

  console.log(`Agent ${data.agent} ownership transferred to ${data.new_owner}`);
}

function handleRelease(db: Database.Database, data: any): void {
  const stmt = db.prepare(`
    UPDATE agents
    SET owner = NULL, claim_deposit = 0, deposit_payer = NULL, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(data.agent);

  console.log(`Agent ${data.agent} released`);
}

function handleVerifyClaim(db: Database.Database, data: any, action?: StreamAction): void {
  // P2 FIX: verifyclaim can remove ownership if KYC is invalid.
  // The on-chain action either:
  // 1. Does nothing (KYC valid) - ownership remains
  // 2. Clears ownership and refunds deposit (KYC invalid, deposit > 0)
  // 3. Clears ownership WITHOUT refund (KYC invalid, deposit == 0)
  //
  // Case 2: Detected by inline transfer
  // Case 3: No inline transfer, but ownership still removed - MUST check DB state

  if (action && action.inline_traces) {
    // Check if there was a refund (indicates ownership was removed with deposit)
    const hasRefund = action.inline_traces.some(
      (trace: any) => trace.act?.name === 'transfer' && trace.act?.account === 'eosio.token'
    );

    if (hasRefund) {
      // Case 2: Ownership removed with refund
      const stmt = db.prepare(`
        UPDATE agents
        SET owner = NULL, claim_deposit = 0, deposit_payer = NULL, updated_at = strftime('%s', 'now')
        WHERE account = ?
      `);
      stmt.run(data.agent);
      console.log(`Agent ${data.agent} ownership removed by verifyclaim (KYC invalid, deposit refunded)`);
      return;
    }

    // Case 3: No refund detected
    // If claim_deposit > 0 and no refund, KYC was valid - ownership remains (correct)
    // If claim_deposit == 0, we CANNOT distinguish:
    //   - KYC valid → no refund, ownership remains
    //   - KYC invalid → no refund (nothing to refund), ownership cleared
    //
    // Conservative approach: do NOT make destructive changes without proof.
    // Leave ownership unchanged and log for chain sync verification.
    const getStmt = db.prepare('SELECT claim_deposit, owner FROM agents WHERE account = ?');
    const agent = getStmt.get(data.agent) as { claim_deposit: number; owner: string | null } | undefined;

    if (agent && agent.claim_deposit === 0 && agent.owner) {
      // Cannot determine outcome - leave unchanged, mark for sync
      console.log(`Agent ${data.agent} verifyclaim: claim_deposit=0, cannot determine KYC outcome. Requires chain sync to verify ownership state.`);
      return;
    }

    // Has deposit but no refund - KYC was valid, ownership remains
    console.log(`Agent ${data.agent} verifyclaim: KYC valid, ownership unchanged`);
    return;
  }

  // No trace data available - cannot determine outcome, mark for sync
  console.log(`Agent ${data.agent} verifyclaim called - no trace data, requires chain sync to verify`);
}

// P2 FIX: Handle token transfers to agentcore for claim deposits
export function handleAgentCoreTransfer(db: Database.Database, action: StreamAction): void {
  const { from, to, quantity, memo } = action.act.data;

  // Only process claim deposits (memo format: "claim:agentname:ownername")
  if (!memo || !memo.startsWith('claim:')) {
    return;
  }

  const parts = memo.slice(6).split(':'); // Remove "claim:" prefix
  if (parts.length !== 2) {
    console.log(`Invalid claim memo format: ${memo}`);
    return;
  }

  const agentName = parts[0];
  const ownerName = parts[1];

  // Parse amount (format: "1.0000 XPR")
  const amountStr = quantity.split(' ')[0];
  let depositAmount = Math.round(parseFloat(amountStr) * 10000); // Convert to smallest units

  // P2 FIX: Check for inline refund transfers (contract refunds excess above claim_fee)
  // Subtract any refund from the deposit amount to keep DB in sync
  if (action.inline_traces) {
    for (const trace of action.inline_traces) {
      // Look for refund transfers back to the sender
      if (
        trace.act?.name === 'transfer' &&
        trace.act?.account === 'eosio.token' &&
        trace.act?.data?.to === from &&
        trace.act?.data?.memo?.includes('refund')
      ) {
        const refundStr = trace.act.data.quantity?.split(' ')[0];
        if (refundStr) {
          const refundAmount = Math.round(parseFloat(refundStr) * 10000);
          depositAmount -= refundAmount;
          console.log(`Claim deposit refund detected: ${refundStr} XPR returned to ${from}`);
        }
      }
    }
  }

  // Don't update if net deposit is 0 or negative (shouldn't happen, but be safe)
  if (depositAmount <= 0) {
    console.log(`Claim deposit for ${agentName} resulted in net 0 after refund`);
    return;
  }

  // Update agent's claim_deposit and deposit_payer
  const stmt = db.prepare(`
    UPDATE agents
    SET claim_deposit = claim_deposit + ?, deposit_payer = ?, updated_at = strftime('%s', 'now')
    WHERE account = ?
  `);

  stmt.run(depositAmount, from, agentName);

  console.log(`Claim deposit received: ${depositAmount / 10000} XPR (net) for agent ${agentName} from ${from}`);
}

function logEvent(db: Database.Database, action: StreamAction): void {
  const stmt = db.prepare(`
    INSERT INTO events (block_num, transaction_id, action_name, contract, data, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const timestamp = Math.floor(new Date(action.timestamp).getTime() / 1000);

  stmt.run(
    action.block_num,
    action.trx_id,
    action.act.name,
    action.act.account,
    JSON.stringify(action.act.data),
    timestamp
  );
}
