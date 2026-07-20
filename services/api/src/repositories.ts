import { randomUUID } from "node:crypto";

import {
  ingestionEventV1Schema,
  type ActivityDetail,
  type ActivityPage,
  type ActivityRouteCollection,
  type ActivitySample,
  type ActivitySummary,
  type GeoJsonLineStringFeature,
  type HeartRateZone,
  type IngestionEventV1,
  type SyncRun,
  type SyncRunStatus,
} from "@vatove/contracts";
import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import type { SyncDateRange } from "./dates.js";
import { HttpProblem } from "./problems.js";

interface SyncRunRow extends QueryResultRow {
  id: string;
  status: SyncRunStatus;
  oldest: string;
  newest: string;
  discovered_count: number;
  processed_count: number;
  failed_count: number;
  error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface ActivityRow extends QueryResultRow {
  id: string;
  source: "intervals";
  source_activity_id: string;
  name: string;
  sport: string;
  start_at: Date | string;
  moving_time_seconds: number | null;
  distance_meters: number | string | null;
  has_route: boolean;
  has_heart_rate: boolean;
  has_elevation: boolean;
}

interface ActivityDetailRow extends ActivityRow {
  average_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  route_geometry: { type: "LineString"; coordinates: [number, number][] } | string | null;
  samples: ActivitySample[] | string | null;
  heart_rate_zones: HeartRateZone[] | string | null;
}

interface ActivityRouteRow extends QueryResultRow {
  id: string;
  route_geometry: { type: "LineString"; coordinates: [number, number][] } | string;
}

export interface SyncRunsStore {
  create(range: SyncDateRange): Promise<SyncRun>;
  findById(id: string): Promise<SyncRun | null>;
}

export interface ActivitiesStore {
  list(
    limit: number,
    cursor: string | undefined,
    range: SyncDateRange,
    timeZone: string,
  ): Promise<ActivityPage>;
  listRoutes(range: SyncDateRange, timeZone: string): Promise<ActivityRouteCollection>;
  findById(id: string): Promise<ActivityDetail | null>;
}

export class PostgresSyncRunsStore implements SyncRunsStore {
  constructor(
    private readonly pool: Pool,
    private readonly topic: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  async create(range: SyncDateRange): Promise<SyncRun> {
    const client = await this.pool.connect();
    const syncRunId = this.uuid();
    const eventId = this.uuid();
    const requestedAt = this.clock().toISOString();
    const event: IngestionEventV1 = ingestionEventV1Schema.strict().parse({
      schemaVersion: 1,
      eventId,
      type: "activity.sync.requested",
      source: "intervals",
      syncRunId,
      requestedAt,
      range,
    });

    try {
      await client.query("BEGIN");
      const result = await client.query<SyncRunRow>(
        `
          INSERT INTO sync_runs (id, status, oldest, newest, created_at)
          VALUES ($1::uuid, 'queued', $2::date, $3::date, $4::timestamptz)
          RETURNING id, status, oldest::text AS oldest, newest::text AS newest,
                    discovered_count, processed_count, failed_count, error,
                    created_at, started_at, completed_at
        `,
        [syncRunId, range.oldest, range.newest, requestedAt],
      );
      await client.query(
        `
          INSERT INTO outbox_events (id, topic, payload, created_at)
          VALUES ($1::uuid, $2, $3::jsonb, $4::timestamptz)
        `,
        [eventId, this.topic, JSON.stringify(event), requestedAt],
      );
      await client.query("COMMIT");

      const row = result.rows[0];
      if (!row) throw new Error("sync run insert did not return a row");
      return mapSyncRun(row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<SyncRun | null> {
    const result = await this.pool.query<SyncRunRow>(
      `
        SELECT id, status, oldest::text AS oldest, newest::text AS newest,
               discovered_count, processed_count, failed_count, error,
               created_at, started_at, completed_at
        FROM sync_runs
        WHERE id = $1::uuid
      `,
      [id],
    );
    const row = result.rows[0];
    return row ? mapSyncRun(row) : null;
  }
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    startAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

type ActivityCursor = z.infer<typeof cursorSchema>;

export function encodeActivityCursor(activity: Pick<ActivitySummary, "id" | "startAt">): string {
  return Buffer.from(JSON.stringify({ v: 1, startAt: activity.startAt, id: activity.id }))
    .toString("base64url");
}

export function decodeActivityCursor(cursor: string): ActivityCursor {
  if (cursor.length > 512) {
    throw new HttpProblem(400, "Invalid cursor", "The pagination cursor is invalid.");
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return cursorSchema.parse(decoded);
  } catch {
    throw new HttpProblem(400, "Invalid cursor", "The pagination cursor is invalid.");
  }
}

const ACTIVITY_SUMMARY_COLUMNS = `
  a.id, a.source, a.source_activity_id, a.name, a.sport, a.start_at,
  a.moving_time_seconds, a.distance_meters,
  (a.route IS NOT NULL) AS has_route,
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(a.samples, '[]'::jsonb)) AS sample(value)
    WHERE sample.value->'heartRateBpm' IS NOT NULL
      AND sample.value->'heartRateBpm' <> 'null'::jsonb
  ) AS has_heart_rate,
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(a.samples, '[]'::jsonb)) AS sample(value)
    WHERE sample.value->'elevationMeters' IS NOT NULL
      AND sample.value->'elevationMeters' <> 'null'::jsonb
  ) AS has_elevation
`;

export class PostgresActivitiesStore implements ActivitiesStore {
  constructor(private readonly pool: Pool) {}

  async list(
    limit: number,
    encodedCursor: string | undefined,
    range: SyncDateRange,
    timeZone: string,
  ): Promise<ActivityPage> {
    const cursor = encodedCursor ? decodeActivityCursor(encodedCursor) : null;
    const result = await this.pool.query<ActivityRow>(
      `
        SELECT ${ACTIVITY_SUMMARY_COLUMNS}
        FROM activities a
        WHERE a.start_at >= (($1::date)::timestamp AT TIME ZONE $3)
          AND a.start_at < ((($2::date + 1))::timestamp AT TIME ZONE $3)
          AND ($4::timestamptz IS NULL OR (a.start_at, a.id) < ($4::timestamptz, $5::uuid))
        ORDER BY a.start_at DESC, a.id DESC
        LIMIT $6
      `,
      [
        range.oldest,
        range.newest,
        timeZone,
        cursor?.startAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );

    const hasNextPage = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(mapActivitySummary);
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor: hasNextPage && lastItem ? encodeActivityCursor(lastItem) : null,
    };
  }

  async listRoutes(range: SyncDateRange, timeZone: string): Promise<ActivityRouteCollection> {
    const result = await this.pool.query<ActivityRouteRow>(
      `
        SELECT a.id,
               ST_AsGeoJSON(
                 ST_Transform(
                   ST_SimplifyPreserveTopology(ST_Transform(a.route, 3857), 5),
                   4326
                 ),
                 7
               )::jsonb AS route_geometry
        FROM activities a
        WHERE a.route IS NOT NULL
          AND a.start_at >= (($1::date)::timestamp AT TIME ZONE $3)
          AND a.start_at < ((($2::date + 1))::timestamp AT TIME ZONE $3)
        ORDER BY a.start_at DESC, a.id DESC
      `,
      [range.oldest, range.newest, timeZone],
    );

    return {
      type: "FeatureCollection",
      features: result.rows.flatMap((row) => {
        const geometry = parseJson(row.route_geometry);
        if (!isLineStringGeometry(geometry)) return [];
        return [
          {
            type: "Feature" as const,
            geometry,
            properties: { activityId: row.id },
          },
        ];
      }),
    };
  }

  async findById(id: string): Promise<ActivityDetail | null> {
    const result = await this.pool.query<ActivityDetailRow>(
      `
        SELECT ${ACTIVITY_SUMMARY_COLUMNS},
               a.average_heart_rate_bpm,
               a.max_heart_rate_bpm,
               ST_AsGeoJSON(a.route, 7)::jsonb AS route_geometry,
               a.samples,
               a.heart_rate_zones
        FROM activities a
        WHERE a.id = $1::uuid
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;

    const summary = mapActivitySummary(row);
    const geometry = parseJson(row.route_geometry);
    return {
      ...summary,
      averageHeartRateBpm: nullableNumber(row.average_heart_rate_bpm),
      maxHeartRateBpm: nullableNumber(row.max_heart_rate_bpm),
      route: geometry
        ? {
            type: "Feature",
            geometry: geometry as GeoJsonLineStringFeature["geometry"],
            properties: { activityId: row.id },
          }
        : null,
      samples: asArray<ActivitySample>(row.samples),
      heartRateZones: normalizeHeartRateZones(row.heart_rate_zones),
    };
  }
}

function mapSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: row.id,
    status: row.status,
    oldest: row.oldest,
    newest: row.newest,
    discoveredCount: row.discovered_count,
    processedCount: row.processed_count,
    failedCount: row.failed_count,
    error: sanitizeWorkerError(row.error),
    createdAt: toIsoString(row.created_at),
    startedAt: row.started_at ? toIsoString(row.started_at) : null,
    completedAt: row.completed_at ? toIsoString(row.completed_at) : null,
  };
}

function mapActivitySummary(row: ActivityRow): ActivitySummary {
  return {
    id: row.id,
    source: row.source,
    sourceActivityId: row.source_activity_id,
    name: row.name,
    sport: row.sport,
    startAt: toIsoString(row.start_at),
    movingTimeSeconds: row.moving_time_seconds,
    distanceMeters: row.distance_meters === null ? null : Number(row.distance_meters),
    hasRoute: row.has_route,
    hasHeartRate: row.has_heart_rate,
    hasElevation: row.has_elevation,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLineStringGeometry(value: unknown): value is GeoJsonLineStringFeature["geometry"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  return candidate.type === "LineString" && Array.isArray(candidate.coordinates);
}

function normalizeHeartRateZones(value: unknown): HeartRateZone[] {
  return asArray<Record<string, unknown>>(value).flatMap((zone) => {
    if (
      typeof zone.index !== "number" ||
      typeof zone.label !== "string" ||
      typeof zone.color !== "string"
    ) {
      return [];
    }

    return [
      {
        index: zone.index,
        label: zone.label,
        color: zone.color,
        minBpm: typeof zone.minBpm === "number" ? zone.minBpm : null,
        maxBpm: typeof zone.maxBpm === "number" ? zone.maxBpm : null,
        durationSeconds:
          typeof zone.durationSeconds === "number" &&
          Number.isFinite(zone.durationSeconds) &&
          zone.durationSeconds >= 0
            ? zone.durationSeconds
            : null,
      },
    ];
  });
}

export function sanitizeWorkerError(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/\bBasic\s+[A-Za-z0-9+/=._-]+/gi, "Basic [redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//[redacted]@")
    .slice(0, 500);
}
