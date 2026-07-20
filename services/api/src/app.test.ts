import type {
  ActivityDetail,
  ActivityPage,
  ActivityRouteCollection,
  SyncRun,
} from "@vatove/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { ReadinessChecker } from "./health.js";
import type { Logger } from "./logger.js";
import type { ActivitiesStore, SyncRunsStore } from "./repositories.js";

const syncRun: SyncRun = {
  id: "0a02e7b4-5b09-45bb-aafb-9a4597d3a0bb",
  status: "queued",
  oldest: "2026-05-22",
  newest: "2026-07-20",
  discoveredCount: 0,
  processedCount: 0,
  failedCount: 0,
  error: null,
  createdAt: "2026-07-20T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function testApp(options: { ready?: boolean; activity?: ActivityDetail | null } = {}) {
  const syncRuns: SyncRunsStore = {
    create: vi.fn(async () => syncRun),
    findById: vi.fn(async () => syncRun),
  };
  const activities: ActivitiesStore = {
    list: vi.fn(async (): Promise<ActivityPage> => ({ items: [], nextCursor: null })),
    listRoutes: vi.fn(
      async (): Promise<ActivityRouteCollection> => ({ type: "FeatureCollection", features: [] }),
    ),
    findById: vi.fn(async () => options.activity ?? null),
  };
  const readiness: ReadinessChecker = {
    isReady: vi.fn(async () => options.ready ?? true),
  };
  return {
    app: createApp({
      syncRuns,
      activities,
      readiness,
      logger: silentLogger,
      appTimezone: "Europe/London",
      clock: () => new Date("2026-07-20T12:00:00.000Z"),
    }),
    syncRuns,
    activities,
  };
}

describe("REST API", () => {
  it("creates a full queued sync run with the default range", async () => {
    const { app, syncRuns } = testApp();
    const response = await request(app).post("/api/v1/sync-runs").expect(202);

    expect(response.body).toEqual(syncRun);
    expect(syncRuns.create).toHaveBeenCalledWith({
      oldest: "2026-05-22",
      newest: "2026-07-20",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns an RFC problem for an impossible calendar date", async () => {
    const { app } = testApp();
    const response = await request(app)
      .post("/api/v1/sync-runs")
      .send({ oldest: "2026-02-29", newest: "2026-03-01" })
      .expect(400);

    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(response.body).toMatchObject({ title: "Invalid date range", status: 400 });
  });

  it("reports dependency failures through readiness only", async () => {
    const { app } = testApp({ ready: false });
    await request(app).get("/api/v1/health/live").expect(200, { status: "ok" });
    await request(app)
      .get("/api/v1/health/ready")
      .expect(503, { status: "unavailable" });
  });

  it("applies the documented pagination default", async () => {
    const { app, activities } = testApp();
    await request(app).get("/api/v1/activities?cursor=abc").expect(200);
    expect(activities.list).toHaveBeenCalledWith(
      30,
      "abc",
      { oldest: "2026-05-22", newest: "2026-07-20" },
      "Europe/London",
    );
  });

  it("passes an explicit local-date window to the activity store", async () => {
    const { app, activities } = testApp();
    await request(app)
      .get("/api/v1/activities?oldest=2026-06-01&newest=2026-06-30&limit=50")
      .expect(200);
    expect(activities.list).toHaveBeenCalledWith(
      50,
      undefined,
      { oldest: "2026-06-01", newest: "2026-06-30" },
      "Europe/London",
    );
  });

  it("rejects an incomplete activity date window", async () => {
    const { app, activities } = testApp();
    const response = await request(app)
      .get("/api/v1/activities?oldest=2026-06-01")
      .expect(400);
    expect(response.body).toMatchObject({ title: "Invalid date range", status: 400 });
    expect(activities.list).not.toHaveBeenCalled();
  });

  it("returns all simplified routes for the default activity window", async () => {
    const { app, activities } = testApp();
    const response = await request(app).get("/api/v1/activity-routes").expect(200);
    expect(response.headers["content-type"]).toMatch(/^application\/geo\+json/);
    expect(response.body).toEqual({ type: "FeatureCollection", features: [] });
    expect(activities.listRoutes).toHaveBeenCalledWith(
      { oldest: "2026-05-22", newest: "2026-07-20" },
      "Europe/London",
    );
  });

  it("does not pass malformed identifiers to PostgreSQL", async () => {
    const { app, activities } = testApp();
    await request(app).get("/api/v1/activities/not-a-uuid").expect(404);
    expect(activities.findById).not.toHaveBeenCalled();
  });
});
