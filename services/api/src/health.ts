import type { Pool } from "pg";

export interface DependencyHealth {
  check(): Promise<void>;
}

export interface ReadinessChecker {
  isReady(): Promise<boolean>;
}

export class ServiceReadinessChecker implements ReadinessChecker {
  constructor(
    private readonly pool: Pool,
    private readonly kafka: DependencyHealth,
  ) {}

  async isReady(): Promise<boolean> {
    const checks = await Promise.allSettled([
      this.pool.query("SELECT postgis_version()"),
      this.kafka.check(),
    ]);
    return checks.every((result) => result.status === "fulfilled");
  }
}
