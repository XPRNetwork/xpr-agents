import { Router, Request, Response } from 'express';
import Database from 'better-sqlite3';

export function createRoutes(db: Database.Database): Router {
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

  // Get single job
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parseInt(id));

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

  return router;
}
