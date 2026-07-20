import type { Pool } from "pg";

const REQUIRED_ALEMBIC_REVISION = "20260720_0002";

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
      this.checkDatabase(),
      this.kafka.check(),
    ]);
    return checks.every((result) => result.status === "fulfilled");
  }

  private async checkDatabase(): Promise<void> {
    const result = await this.pool.query<{
      alembicRevision: string;
      hasRequiredColumns: boolean;
    }>(`
      SELECT postgis_version(),
             version_num AS "alembicRevision",
             (
               SELECT count(*) = 2
               FROM information_schema.columns
               WHERE table_schema = current_schema()
                 AND table_name = 'activities'
                 AND column_name IN ('average_heart_rate_bpm', 'max_heart_rate_bpm')
             ) AS "hasRequiredColumns"
      FROM alembic_version
    `);
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.alembicRevision !== REQUIRED_ALEMBIC_REVISION ||
      result.rows[0]?.hasRequiredColumns !== true
    ) {
      throw new Error(`Database schema is not compatible with revision ${REQUIRED_ALEMBIC_REVISION}.`);
    }
  }
}
