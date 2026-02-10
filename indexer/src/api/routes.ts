import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { WebhookDispatcher } from '../webhooks/dispatcher';

export function createRoutes(db: Database.Database, dispatcher?: WebhookDispatcher): Router {
  const router = Router();

  // ============== AGENTS ==============

  // List agents
  router.get('/agents', (req: Request, res: Response) => {
    const { limit = '100', offset = '0', active_only = 'true', sort = 'trust_score' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;
    const activeOnly = active_only === 'true';

    let query = `
      SELECT a.*, s.avg_score, s.feedback_count
      FROM agents a
      LEFT JOIN agent_scores s ON a.account = s.agent
    `;

    if (activeOnly) {
      query += ' WHERE a.active = 1';
    }

    const sortColumn = sort === 'stake' ? 'a.stake' : sort === 'jobs' ? 'a.total_jobs' : 's.avg_score';
    query += ` ORDER BY ${sortColumn} DESC LIMIT ? OFFSET ?`;

    const stmt = db.prepare(query);
    const agents = stmt.all(limitNum, offsetNum);

    res.json({ agents, total: agents.length });
  });

  // Get single agent
  router.get('/agents/:account', (req: Request, res: Response) => {
    const { account } = req.params;

    const agent = db.prepare(`
      SELECT a.*, s.total_score, s.total_weight, s.avg_score, s.feedback_count
      FROM agents a
      LEFT JOIN agent_scores s ON a.account = s.agent
      WHERE a.account = ?
    `).get(account);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(agent);
  });

  // Get agent feedback
  router.get('/agents/:account/feedback', (req: Request, res: Response) => {
    const { account } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offsetNum = parseInt(offset as string) || 0;

    const feedback = db.prepare(`
      SELECT * FROM feedback
      WHERE agent = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(account, limitNum, offsetNum);

    res.json({ feedback });
  });

  // Get agent validations
  router.get('/agents/:account/validations', (req: Request, res: Response) => {
    const { account } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offsetNum = parseInt(offset as string) || 0;

    const validations = db.prepare(`
      SELECT * FROM validations
      WHERE agent = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(account, limitNum, offsetNum);

    res.json({ validations });
  });

  // Get agent plugins
  router.get('/agents/:account/plugins', (req: Request, res: Response) => {
    const { account } = req.params;

    const plugins = db.prepare(`
      SELECT ap.id, ap.plugin_id, ap.config, ap.enabled,
             p.name, p.version, p.contract, p.action, p.category, p.author, p.verified
      FROM agent_plugins ap
      JOIN plugins p ON ap.plugin_id = p.id
      WHERE ap.agent = ?
      ORDER BY ap.id ASC
    `).all(account);

    res.json({ plugins });
  });

  // ============== VALIDATORS ==============

  // List validators
  router.get('/validators', (req: Request, res: Response) => {
    const { limit = '100', offset = '0', active_only = 'true' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;
    const activeOnly = active_only === 'true';

    let query = 'SELECT * FROM validators';
    if (activeOnly) {
      query += ' WHERE active = 1';
    }
    query += ' ORDER BY accuracy_score DESC, total_validations DESC LIMIT ? OFFSET ?';

    const validators = db.prepare(query).all(limitNum, offsetNum);

    res.json({ validators });
  });

  // Get single validator
  router.get('/validators/:account', (req: Request, res: Response) => {
    const { account } = req.params;

    const validator = db.prepare('SELECT * FROM validators WHERE account = ?').get(account);

    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }

    return res.json(validator);
  });

  // Get validation challenges
  router.get('/validations/:id/challenges', (req: Request, res: Response) => {
    const { id } = req.params;

    const challenges = db.prepare(
      'SELECT * FROM validation_challenges WHERE validation_id = ? ORDER BY created_at DESC'
    ).all(parseInt(id));

    res.json({ challenges });
  });

  // ============== PLUGINS ==============

  // List plugins
  router.get('/plugins', (req: Request, res: Response) => {
    const { category, verified_only = 'false' } = req.query;

    let query = 'SELECT * FROM plugins WHERE 1=1';
    const params: any[] = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (verified_only === 'true') {
      query += ' AND verified = 1';
    }

    query += ' ORDER BY verified DESC, id ASC';

    const plugins = db.prepare(query).all(...params);

    res.json({ plugins });
  });

  // ============== JOBS ==============

  // List jobs
  router.get('/jobs', (req: Request, res: Response) => {
    const { limit = '100', offset = '0', state, client, agent } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;

    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params: any[] = [];

    if (state !== undefined) {
      query += ' AND state = ?';
      params.push(parseInt(state as string));
    }

    if (client) {
      query += ' AND client = ?';
      params.push(client);
    }

    if (agent) {
      query += ' AND agent = ?';
      params.push(agent);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);

    const jobs = db.prepare(query).all(...params);
    res.json({ jobs });
  });

  // List open jobs (no agent assigned, available for bidding)
  router.get('/jobs/open', (req: Request, res: Response) => {
    const { limit = '100', offset = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;

    const jobs = db.prepare(`
      SELECT * FROM jobs
      WHERE (agent = '' OR agent IS NULL) AND state IN (0, 1)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limitNum, offsetNum);

    res.json({ jobs });
  });

  // Get single job
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    const job = db.prepare(
      'SELECT j.*, je.evidence_uri FROM jobs j LEFT JOIN job_evidence je ON j.id = je.job_id WHERE j.id = ?'
    ).get(parseInt(id));

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json(job);
  });

  // Get job milestones
  router.get('/jobs/:id/milestones', (req: Request, res: Response) => {
    const { id } = req.params;

    const milestones = db.prepare(
      'SELECT * FROM milestones WHERE job_id = ? ORDER BY milestone_order ASC'
    ).all(parseInt(id));

    res.json({ milestones });
  });

  // Get job disputes
  router.get('/jobs/:id/disputes', (req: Request, res: Response) => {
    const { id } = req.params;

    const disputes = db.prepare(
      'SELECT * FROM escrow_disputes WHERE job_id = ? ORDER BY created_at DESC'
    ).all(parseInt(id));

    res.json({ disputes });
  });

  // ============== BIDS ==============

  // List bids for a job
  router.get('/jobs/:id/bids', (req: Request, res: Response) => {
    const { id } = req.params;

    const bids = db.prepare(
      'SELECT * FROM bids WHERE job_id = ? ORDER BY amount ASC, created_at ASC'
    ).all(parseInt(id));

    res.json({ bids });
  });

  // List bids by an agent
  router.get('/agents/:account/bids', (req: Request, res: Response) => {
    const { account } = req.params;

    const bids = db.prepare(`
      SELECT b.*, j.title as job_title, j.description as job_description, j.amount as job_amount, j.state as job_state
      FROM bids b
      JOIN jobs j ON b.job_id = j.id
      WHERE b.agent = ?
      ORDER BY b.created_at DESC
    `).all(account);

    res.json({ bids });
  });

  // ============== ARBITRATORS ==============

  // List arbitrators
  router.get('/arbitrators', (req: Request, res: Response) => {
    const { limit = '100', offset = '0', active_only = 'true' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;
    const activeOnly = active_only === 'true';

    let query = 'SELECT * FROM arbitrators';
    if (activeOnly) {
      query += ' WHERE active = 1';
    }
    query += ' ORDER BY successful_cases DESC LIMIT ? OFFSET ?';

    const arbitrators = db.prepare(query).all(limitNum, offsetNum);
    res.json({ arbitrators });
  });

  // Get single arbitrator
  router.get('/arbitrators/:account', (req: Request, res: Response) => {
    const { account } = req.params;

    const arbitrator = db.prepare('SELECT * FROM arbitrators WHERE account = ?').get(account);

    if (!arbitrator) {
      return res.status(404).json({ error: 'Arbitrator not found' });
    }

    return res.json(arbitrator);
  });

  // ============== STATS ==============

  // Get global stats
  router.get('/stats', (req: Request, res: Response) => {
    const stats = db.prepare('SELECT key, value FROM stats').all() as Array<{ key: string; value: number }>;

    const statsObj: Record<string, number> = {};
    for (const stat of stats) {
      statsObj[stat.key] = stat.value;
    }

    res.json(statsObj);
  });

  // ============== EVENTS ==============

  // Get recent events
  router.get('/events', (req: Request, res: Response) => {
    const { contract, action, limit = '50' } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 50, 200);

    let query = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];

    if (contract) {
      query += ' AND contract = ?';
      params.push(contract);
    }

    if (action) {
      query += ' AND action_name = ?';
      params.push(action);
    }

    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limitNum);

    const events = db.prepare(query).all(...params);

    res.json({ events });
  });

  // ============== SEARCH ==============

  // Search agents
  router.get('/search', (req: Request, res: Response) => {
    const { q, limit = '20' } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const searchTerm = `%${q}%`;

    const agents = db.prepare(`
      SELECT a.*, s.avg_score
      FROM agents a
      LEFT JOIN agent_scores s ON a.account = s.agent
      WHERE a.account LIKE ? OR a.name LIKE ? OR a.description LIKE ?
      ORDER BY s.avg_score DESC
      LIMIT ?
    `).all(searchTerm, searchTerm, searchTerm, limitNum);

    return res.json({ agents });
  });

  // ============== ADMIN ==============

  const adminToken = process.env.ADMIN_API_TOKEN;

  function requireAdminAuth(req: Request, res: Response): boolean {
    if (!adminToken) {
      res.status(503).json({ error: 'Admin API not configured (ADMIN_API_TOKEN not set)' });
      return false;
    }
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${adminToken}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // KYC sync stub
  router.post('/admin/sync-kyc', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return;

    // TODO: Implement actual KYC sync from eosio.proton::usersinfo table
    // This would query the chain for current KYC levels and update
    // feedback scores that were indexed without proper KYC weight
    res.json({ status: 'not_implemented' });
  });

  // ============== WEBHOOKS ==============

  const webhookAdminToken = process.env.WEBHOOK_ADMIN_TOKEN;

  function requireWebhookAuth(req: Request, res: Response): boolean {
    if (!webhookAdminToken) {
      res.status(503).json({ error: 'Webhooks not configured (WEBHOOK_ADMIN_TOKEN not set)' });
      return false;
    }
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${webhookAdminToken}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  /**
   * Validate webhook URL to prevent SSRF attacks.
   * Blocks private IPs, localhost, metadata endpoints, and non-HTTPS schemes.
   */
  function isValidWebhookUrl(urlStr: string): { valid: boolean; error?: string } {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }

    // Only allow http and https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http and https URLs are allowed' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return { valid: false, error: 'Localhost URLs are not allowed' };
    }

    // Block private IP ranges (IPv4)
    const privatePatterns = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
      /^192\.168\./,             // 192.168.0.0/16
      /^169\.254\./,             // Link-local
    ];
    if (privatePatterns.some(p => p.test(hostname))) {
      return { valid: false, error: 'Private IP addresses are not allowed' };
    }

    // Block IPv6-mapped IPv4 (::ffff:x.x.x.x) and private IPv6 ranges
    if (hostname.startsWith('::ffff:') || hostname.startsWith('fd') || hostname.startsWith('fc')) {
      return { valid: false, error: 'Private IPv6 addresses are not allowed' };
    }

    // Block AWS/GCP/Azure metadata endpoints
    const metadataHosts = ['metadata.google.internal', 'metadata.google.com', '169.254.169.254'];
    if (metadataHosts.includes(hostname)) {
      return { valid: false, error: 'Cloud metadata endpoints are not allowed' };
    }

    return { valid: true };
  }

  // Register webhook subscription
  router.post('/webhooks', (req: Request, res: Response) => {
    if (!requireWebhookAuth(req, res)) return;

    const { url, token, event_filter, account_filter } = req.body;

    if (!url || !token || !event_filter) {
      return res.status(400).json({ error: 'url, token, and event_filter are required' });
    }

    if (!Array.isArray(event_filter) || event_filter.length === 0) {
      return res.status(400).json({ error: 'event_filter must be a non-empty array of event types' });
    }

    // SSRF protection: validate webhook URL
    const urlCheck = isValidWebhookUrl(url);
    if (!urlCheck.valid) {
      return res.status(400).json({ error: `Invalid webhook URL: ${urlCheck.error}` });
    }

    // Subscription limit: max 100 active subscriptions
    const subCount = (db.prepare('SELECT COUNT(*) as cnt FROM webhook_subscriptions').get() as { cnt: number }).cnt;
    if (subCount >= 100) {
      return res.status(429).json({ error: 'Webhook subscription limit reached (max 100)' });
    }

    const stmt = db.prepare(`
      INSERT INTO webhook_subscriptions (url, token, event_filter, account_filter, enabled)
      VALUES (?, ?, ?, ?, 1)
    `);
    const result = stmt.run(url, token, JSON.stringify(event_filter), account_filter || null);

    // Reload in-memory cache so the new subscription takes effect immediately
    dispatcher?.reload();

    return res.status(201).json({
      id: result.lastInsertRowid,
      url,
      event_filter,
      account_filter: account_filter || null,
      enabled: true,
    });
  });

  // List webhook subscriptions
  router.get('/webhooks', (req: Request, res: Response) => {
    if (!requireWebhookAuth(req, res)) return;

    const subscriptions = db.prepare(
      'SELECT id, url, event_filter, account_filter, enabled, failure_count, created_at FROM webhook_subscriptions ORDER BY id ASC'
    ).all();

    return res.json({ subscriptions });
  });

  // Delete webhook subscription
  router.delete('/webhooks/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    if (!requireWebhookAuth(req, res)) return;

    const result = db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(parseInt(id));

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Reload in-memory cache so the deletion takes effect immediately
    dispatcher?.reload();

    return res.json({ deleted: true, id: parseInt(id) });
  });

  return router;
}
