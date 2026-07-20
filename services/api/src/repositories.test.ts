import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  PostgresSyncRunsStore,
  decodeActivityCursor,
  encodeActivityCursor,
  sanitizeWorkerError,
} from "./repositories.js";

describe("activity cursors", () => {
  it("round trips a versioned opaque cursor", () => {
    const activity = {
      id: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
      startAt: "2026-07-20T12:00:00.000Z",
    };
    expect(decodeActivityCursor(encodeActivityCursor(activity))).toEqual({ v: 1, ...activity });
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeActivityCursor("not-json")).toThrow("pagination cursor is invalid");
  });
});

describe("sync run transactional outbox", () => {
  it("commits the run and credential-free versioned event together", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes("INSERT INTO sync_runs")) {
          return {
            rows: [
              {
                id: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
                status: "queued",
                oldest: "2026-06-21",
                newest: "2026-07-20",
                discovered_count: 0,
                processed_count: 0,
                failed_count: 0,
                error: null,
                created_at: new Date("2026-07-20T12:00:00.000Z"),
                started_at: null,
                completed_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const ids = [
      "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
      "31169557-4a63-43e8-8762-6b42efdec01b",
    ];
    const store = new PostgresSyncRunsStore(
      pool,
      "incoming_activities.v1",
      () => new Date("2026-07-20T12:00:00.000Z"),
      () => ids.shift()!,
    );

    await store.create({ oldest: "2026-06-21", newest: "2026-07-20" });

    expect(queries.map(({ text }) => text.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "BEGIN",
      "INSERT INTO sync_runs",
      "INSERT INTO outbox_events",
      "COMMIT",
    ]);
    const outboxInsert = queries.find(({ text }) => text.includes("INSERT INTO outbox_events"));
    const payload = JSON.parse(String(outboxInsert?.values?.[2])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      schemaVersion: 1,
      type: "activity.sync.requested",
      source: "intervals",
      syncRunId: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
    });
    expect(JSON.stringify(payload)).not.toMatch(/api.?key|authorization/i);
  });
});

describe("worker error sanitization", () => {
  it("redacts credentials before returning status", () => {
    expect(
      sanitizeWorkerError(
        "GET https://API_KEY:secret@example.test/a?access_token=sensitive Bearer abc.def",
      ),
    ).toBe("GET https://[redacted]@example.test/a?access_token=[redacted] Bearer [redacted]");
  });
});
