import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { DependencyHealth } from "./health.js";
import { ServiceReadinessChecker } from "./health.js";

function dependencies() {
  const query = vi.fn();
  const check = vi.fn();
  return {
    query,
    check,
    readiness: new ServiceReadinessChecker(
      { query } as unknown as Pool,
      { check } as DependencyHealth,
    ),
  };
}

describe("ServiceReadinessChecker", () => {
  it("is ready when PostGIS, the current schema, and Kafka are available", async () => {
    const { query, check, readiness } = dependencies();
    query.mockResolvedValue({
      rows: [{ alembicRevision: "20260720_0002", hasRequiredColumns: true }],
    });
    check.mockResolvedValue(undefined);

    await expect(readiness.isReady()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("postgis_version()"));
    expect(check).toHaveBeenCalledOnce();
  });

  it("is unavailable when the database schema is stale", async () => {
    const { query, check, readiness } = dependencies();
    query.mockResolvedValue({
      rows: [{ alembicRevision: "20260720_0001", hasRequiredColumns: false }],
    });
    check.mockResolvedValue(undefined);

    await expect(readiness.isReady()).resolves.toBe(false);
  });

  it("is unavailable when the revision is stamped but required columns are missing", async () => {
    const { query, check, readiness } = dependencies();
    query.mockResolvedValue({
      rows: [{ alembicRevision: "20260720_0002", hasRequiredColumns: false }],
    });
    check.mockResolvedValue(undefined);

    await expect(readiness.isReady()).resolves.toBe(false);
  });

  it("is unavailable when the database check is rejected", async () => {
    const { query, check, readiness } = dependencies();
    query.mockRejectedValue(new Error("database unavailable"));
    check.mockResolvedValue(undefined);

    await expect(readiness.isReady()).resolves.toBe(false);
  });

  it("is unavailable when the Kafka check is rejected", async () => {
    const { query, check, readiness } = dependencies();
    query.mockResolvedValue({
      rows: [{ alembicRevision: "20260720_0002", hasRequiredColumns: true }],
    });
    check.mockRejectedValue(new Error("Kafka unavailable"));

    await expect(readiness.isReady()).resolves.toBe(false);
  });
});
