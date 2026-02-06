import Database from 'better-sqlite3';

interface WebhookSubscription {
  id: number;
  url: string;
  token: string;
  event_filter: string;
  account_filter: string | null;
  enabled: number;
  failure_count: number;
}

interface WebhookPayload {
  event_type: string;
  timestamp: number;
  block_num: number;
  data: Record<string, unknown>;
  message: string;
}

const MAX_FAILURES = 50;
const RETRY_DELAYS = [1000, 5000, 15000];

export class WebhookDispatcher {
  private db: Database.Database;
  private subscriptions: WebhookSubscription[] = [];

  constructor(db: Database.Database) {
    this.db = db;
    this.reload();
  }

  /**
   * Reload subscriptions from database into memory cache.
   */
  reload(): void {
    this.subscriptions = this.db.prepare(
      'SELECT * FROM webhook_subscriptions WHERE enabled = 1'
    ).all() as WebhookSubscription[];
  }

  /**
   * Dispatch an event to matching webhook subscribers.
   * Async fire-and-forget with retries.
   */
  dispatch(
    eventType: string,
    accountsInvolved: string[],
    data: Record<string, unknown>,
    message: string,
    blockNum: number = 0
  ): void {
    const timestamp = Math.floor(Date.now() / 1000);

    for (const sub of this.subscriptions) {
      if (!this.matches(sub, eventType, accountsInvolved)) continue;

      const payload: WebhookPayload = {
        event_type: eventType,
        timestamp,
        block_num: blockNum,
        data,
        message,
      };

      // Fire-and-forget delivery with retries
      this.deliver(sub, payload).catch((err) => {
        console.error(`[webhook] Delivery failed for sub ${sub.id}:`, err);
      });
    }
  }

  private matches(
    sub: WebhookSubscription,
    eventType: string,
    accountsInvolved: string[]
  ): boolean {
    // Check event filter
    let filters: string[];
    try {
      filters = JSON.parse(sub.event_filter);
    } catch {
      return false;
    }

    // Match event type: exact match or wildcard prefix (e.g., "job.*")
    const eventMatches = filters.some((f) => {
      if (f === '*') return true;
      if (f.endsWith('.*')) {
        return eventType.startsWith(f.slice(0, -1));
      }
      return f === eventType;
    });

    if (!eventMatches) return false;

    // Check account filter
    if (sub.account_filter) {
      return accountsInvolved.includes(sub.account_filter);
    }

    return true;
  }

  private async deliver(sub: WebhookSubscription, payload: WebhookPayload): Promise<void> {
    let lastStatusCode = 0;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sub.token}`,
            'X-Webhook-Event': payload.event_type,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        lastStatusCode = response.status;

        // Log delivery
        this.logDelivery(sub.id, payload.event_type, JSON.stringify(payload), response.status);

        if (response.ok) {
          // Reset failure count on success
          if (sub.failure_count > 0) {
            this.db.prepare('UPDATE webhook_subscriptions SET failure_count = 0 WHERE id = ?').run(sub.id);
            sub.failure_count = 0;
          }
          return;
        }

        // 4xx errors (except 429) are not retryable
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.incrementFailure(sub);
          return;
        }
      } catch {
        // Network error - retryable
      }

      // Wait before retry
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }

    // All retries exhausted
    this.logDelivery(sub.id, payload.event_type, JSON.stringify(payload), lastStatusCode);
    this.incrementFailure(sub);
  }

  private incrementFailure(sub: WebhookSubscription): void {
    sub.failure_count++;

    if (sub.failure_count >= MAX_FAILURES) {
      // Auto-disable
      this.db.prepare(
        'UPDATE webhook_subscriptions SET failure_count = ?, enabled = 0 WHERE id = ?'
      ).run(sub.failure_count, sub.id);
      // Remove from cache
      this.subscriptions = this.subscriptions.filter((s) => s.id !== sub.id);
      console.log(`[webhook] Subscription ${sub.id} disabled after ${MAX_FAILURES} failures`);
    } else {
      this.db.prepare(
        'UPDATE webhook_subscriptions SET failure_count = ? WHERE id = ?'
      ).run(sub.failure_count, sub.id);
    }
  }

  private logDelivery(
    subscriptionId: number,
    eventType: string,
    payload: string,
    statusCode: number
  ): void {
    try {
      this.db.prepare(
        'INSERT INTO webhook_deliveries (subscription_id, event_type, payload, status_code) VALUES (?, ?, ?, ?)'
      ).run(subscriptionId, eventType, payload, statusCode);
    } catch {
      // Non-critical - don't let logging failures break dispatch
    }
  }
}
