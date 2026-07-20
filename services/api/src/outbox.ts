import { ingestionEventV1Schema } from "@vatove/contracts";
import type { Pool, QueryResultRow } from "pg";

import type { MessagePublisher } from "./kafka.js";
import type { Logger } from "./logger.js";
import { errorContext } from "./logger.js";

interface OutboxRow extends QueryResultRow {
  id: string;
  topic: string;
  payload: unknown;
}

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly publisher: MessagePublisher,
    private readonly log: Logger,
    private readonly pollIntervalMs: number,
    private readonly batchSize: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.scheduleDrain(), this.pollIntervalMs);
    this.timer.unref();
    this.scheduleDrain();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async drain(): Promise<number> {
    let published = 0;
    while (published < this.batchSize && (await this.dispatchOne())) published += 1;
    return published;
  }

  private scheduleDrain(): void {
    if (this.inFlight) return;
    this.inFlight = this.drain()
      .then((published) => {
        if (published > 0) this.log.info("Published transactional outbox events", { published });
      })
      .catch((error: unknown) => {
        this.log.error("Transactional outbox drain failed", errorContext(error));
      })
      .finally(() => {
        this.inFlight = undefined;
      });
  }

  private async dispatchOne(): Promise<boolean> {
    const client = await this.pool.connect();
    let selected: OutboxRow | undefined;
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `
          SELECT id, topic, payload
          FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      selected = result.rows[0];
      if (!selected) {
        await client.query("COMMIT");
        return false;
      }

      const payload = ingestionEventV1Schema.strict().parse(parsePayload(selected.payload));
      await this.publisher.publish(selected.topic, selected.id, JSON.stringify(payload));
      await client.query(
        `
          UPDATE outbox_events
          SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = $1::uuid
        `,
        [selected.id],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (selected) {
        await client
          .query(
            `
              UPDATE outbox_events
              SET attempts = attempts + 1, last_error = $2
              WHERE id = $1::uuid AND published_at IS NULL
            `,
            [selected.id, safeErrorMessage(error)],
          )
          .catch((updateError: unknown) => {
            this.log.error("Could not record outbox publish failure", {
              outboxEventId: selected?.id,
              ...errorContext(updateError),
            });
          });
      }
      this.log.warn("Could not publish outbox event", {
        outboxEventId: selected?.id,
        ...errorContext(error),
      });
      return false;
    } finally {
      client.release();
    }
  }
}

function parsePayload(payload: unknown): unknown {
  return typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;
}

function safeErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/\bBasic\s+[A-Za-z0-9+/=._-]+/gi, "Basic [redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .slice(0, 1_000);
}
