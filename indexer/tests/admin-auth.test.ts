import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'net';
import { initDatabase } from '../src/db/schema';
import { createRoutes } from '../src/api/routes';

/**
 * The admin/webhook bearer checks were moved to a constant-time comparison
 * (crypto.timingSafeEqual over sha256 digests) to stop the old `header !== token`
 * from leaking token length/prefix via timing. These assert the behaviour is
 * unchanged: right token in, wrong/short/missing token out.
 */
const TOKEN = 'super-secret-admin-token-value';

describe('admin bearer auth (constant-time)', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  let db: Database.Database;

  beforeAll(async () => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    process.env.WEBHOOK_ADMIN_TOKEN = TOKEN;
    db = initDatabase(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes(db));
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
    db?.close();
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.WEBHOOK_ADMIN_TOKEN;
  });

  async function prune(headers: Record<string, string>): Promise<number> {
    const res = await fetch(`${base}/api/admin/prune-temp-rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
    });
    return res.status;
  }

  it('accepts the exact bearer token', async () => {
    expect(await prune({ authorization: `Bearer ${TOKEN}` })).toBe(200);
  });

  it('rejects a missing Authorization header', async () => {
    expect(await prune({})).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect(await prune({ authorization: 'Bearer wrong-token' })).toBe(401);
  });

  it('rejects a correct-prefix-but-short token', async () => {
    expect(await prune({ authorization: `Bearer ${TOKEN.slice(0, -1)}` })).toBe(401);
  });

  it('rejects the raw token without the Bearer scheme', async () => {
    expect(await prune({ authorization: TOKEN })).toBe(401);
  });

  it('gates the webhook list behind the same check', async () => {
    const ok = await fetch(`${base}/api/webhooks`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const bad = await fetch(`${base}/api/webhooks`, { headers: { authorization: 'Bearer nope' } });
    expect(ok.status).toBe(200);
    expect(bad.status).toBe(401);
  });
});
