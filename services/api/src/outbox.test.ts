import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { MessagePublisher } from "./kafka.js";
import type { Logger } from "./logger.js";
import { OutboxDispatcher } from "./outbox.js";

const event = {
  schemaVersion: 1,
  eventId: "31169557-4a63-43e8-8762-6b42efdec01b",
  type: "activity.sync.requested",
  source: "intervals",
  syncRunId: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
  requestedAt: "2026-07-20T12:00:00.000Z",
  range: { oldest: "2026-06-21", newest: "2026-07-20" },
};

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("outbox dispatcher", () => {
  it("publishes a locked event and only then marks it delivered", async () => {
    const statements: string[] = [];
    let selected = false;
    const client = {
      query: async (text: string) => {
        statements.push(text);
        if (text.includes("SELECT id, topic, payload") && !selected) {
          selected = true;
          return {
            rows: [
              {
                id: event.eventId,
                topic: "incoming_activities.v1",
                payload: event,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const publisher: MessagePublisher = {
      connect: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
    };
    const dispatcher = new OutboxDispatcher(pool, publisher, silentLogger, 500, 10);

    await expect(dispatcher.drain()).resolves.toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      "incoming_activities.v1",
      event.eventId,
      JSON.stringify(event),
    );
    expect(statements.some((text) => text.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(statements.some((text) => text.includes("SET published_at = now()"))).toBe(true);
  });
});
