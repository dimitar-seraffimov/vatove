import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  PostgresActivitiesStore,
  PostgresSyncRunsStore,
  decodeActivityCursor,
  encodeActivityCursor,
  sanitizeWorkerError,
} from "./repositories.js";

describe("activity queries", () => {
  it("applies the local-date range to paginated activity queries", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;
    const store = new PostgresActivitiesStore(pool);

    await store.list(
      30,
      undefined,
      { oldest: "2026-05-22", newest: "2026-07-20" },
      "Europe/London",
    );

    expect(calls[0]?.values).toEqual([
      "2026-05-22",
      "2026-07-20",
      "Europe/London",
      null,
      null,
      31,
    ]);
    expect(calls[0]?.text).toContain("AT TIME ZONE $3");
  });

  it("returns five-metre simplified routes as a GeoJSON feature collection", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return {
          rows: [
            {
              id: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
              route_geometry: {
                type: "LineString",
                coordinates: [
                  [-0.1, 51.5],
                  [-0.2, 51.6],
                ],
              },
            },
          ],
        };
      },
    } as unknown as Pool;
    const store = new PostgresActivitiesStore(pool);

    const routes = await store.listRoutes(
      { oldest: "2026-05-22", newest: "2026-07-20" },
      "Europe/London",
    );

    expect(routes).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-0.1, 51.5],
              [-0.2, 51.6],
            ],
          },
          properties: { activityId: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb" },
        },
      ],
    });
    expect(calls[0]?.text).toContain("ST_SimplifyPreserveTopology");
    expect(calls[0]?.text).toContain(", 5)");
    expect(calls[0]?.values).toEqual(["2026-05-22", "2026-07-20", "Europe/London"]);
  });

  it("normalizes legacy zones without duration data in activity details", async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
            source: "intervals",
            source_activity_id: "i123",
            name: "Morning Ride",
            sport: "Ride",
            start_at: "2026-07-20T08:00:00.000Z",
            moving_time_seconds: 3600,
            distance_meters: "25000",
            has_route: true,
            has_heart_rate: true,
            has_elevation: true,
            average_heart_rate_bpm: 145,
            max_heart_rate_bpm: 178,
            route_geometry: {
              type: "LineString",
              coordinates: [
                [-0.1, 51.5],
                [-0.2, 51.6],
              ],
            },
            samples: [],
            heart_rate_zones: [
              { index: 0, label: "Z1", color: "#fff", minBpm: null, maxBpm: 120 },
            ],
          },
        ],
      }),
    } as unknown as Pool;
    const store = new PostgresActivitiesStore(pool);

    const detail = await store.findById("0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb");

    expect(detail).toMatchObject({
      averageHeartRateBpm: 145,
      maxHeartRateBpm: 178,
      heartRateZones: [
        {
          index: 0,
          label: "Z1",
          color: "#fff",
          minBpm: null,
          maxBpm: 120,
          durationSeconds: null,
        },
      ],
    });
  });
});

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
