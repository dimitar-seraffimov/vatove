import { describe, expect, it } from "vitest";

import { createSyncRunSchema, ingestionEventV1Schema } from "./index.js";

describe("contracts", () => {
  it("accepts an ordered date range", () => {
    expect(
      createSyncRunSchema.parse({ oldest: "2026-06-01", newest: "2026-06-30" }),
    ).toEqual({ oldest: "2026-06-01", newest: "2026-06-30" });
  });

  it("rejects a reversed date range", () => {
    expect(() =>
      createSyncRunSchema.parse({ oldest: "2026-07-02", newest: "2026-07-01" }),
    ).toThrow();
  });

  it("forbids unknown event fields such as credentials", () => {
    const event = ingestionEventV1Schema.strict();
    expect(() =>
      event.parse({
        schemaVersion: 1,
        eventId: "265db62f-11b8-41e7-9c34-b0493cd0d693",
        type: "activity.sync.requested",
        source: "intervals",
        syncRunId: "2bd82e54-d39b-4c5f-9d68-3a9f7df8f5f5",
        requestedAt: "2026-07-20T10:00:00.000Z",
        range: { oldest: "2026-06-20", newest: "2026-07-20" },
        apiKey: "must-not-leak",
      }),
    ).toThrow();
  });
});

