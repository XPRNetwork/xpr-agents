import Database from 'better-sqlite3';
import { StreamAction } from '../stream';
import { updateStats } from '../db/schema';

export function handleAgentAction(db: Database.Database, action: StreamAction): void {
  const { name, data } = action.act;

  switch (name) {
    case 'register':
      handleRegister(db, data, action.timestamp);
      break;
    case 'update':
      handleUpdate(db, data);
      break;
    case 'setstatus':
      handleSetStatus(db, data);
      break;
    case 'incjobs':
      handleIncJobs(db, data);
      break;
    case 'regplugin':
      handleRegPlugin(db, data);
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
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agents (account, name, description, endpoint, protocol, capabilities, stake, total_jobs, registered_at, active)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1)
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
