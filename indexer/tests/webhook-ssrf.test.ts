import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/schema';
import { WebhookDispatcher } from '../src/webhooks/dispatcher';

/**
 * Integration cover for the dispatch-time SSRF guard: unlike handlers.test.ts,
 * this file does NOT mock net-guard, so the dispatcher runs the real
 * isPublicHttpUrl check. A subscription pointing at a private/loopback address
 * (e.g. after DNS rebinding) must never be fetched — that would leak the
 * subscriber's Bearer token to an internal host.
 */
function insertSub(db: Database.Database, url: string): void {
  db.prepare(
    'INSERT INTO webhook_subscriptions (url, token, event_filter, account_filter, enabled) VALUES (?, ?, ?, ?, 1)'
  ).run(url, 'secret-token', '["*"]', null);
}

describe('WebhookDispatcher SSRF guard (real net-guard)', () => {
  let db: Database.Database;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = initDatabase(':memory:');
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it('never fetches a loopback URL', async () => {
    insertSub(db, 'http://127.0.0.1:8080/hook');
    const d = new WebhookDispatcher(db);
    d.dispatch('agent.registered', ['alice'], {}, 'msg');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never fetches the cloud metadata endpoint', async () => {
    insertSub(db, 'http://169.254.169.254/latest/meta-data/');
    const d = new WebhookDispatcher(db);
    d.dispatch('agent.registered', ['alice'], {}, 'msg');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never fetches a private LAN URL', async () => {
    insertSub(db, 'http://192.168.1.10/hook');
    const d = new WebhookDispatcher(db);
    d.dispatch('agent.registered', ['alice'], {}, 'msg');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does fetch a public host', async () => {
    // A public IP literal, so the guard's isPublicHttpUrl needs no DNS lookup
    // and the test stays offline-safe in CI.
    insertSub(db, 'https://1.1.1.1/hook');
    const d = new WebhookDispatcher(db);
    d.dispatch('agent.registered', ['alice'], {}, 'msg');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('manual');
  });
});
