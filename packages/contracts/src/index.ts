import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createSyncRunSchema = z
  .object({
    oldest: isoDateSchema.optional(),
    newest: isoDateSchema.optional(),
  })
  .refine(
    ({ oldest, newest }) => !oldest || !newest || oldest <= newest,
    "oldest must not be after newest",
  );

export type CreateSyncRun = z.infer<typeof createSyncRunSchema>;
export type SyncRunStatus = "queued" | "running" | "completed" | "failed";

export interface SyncRun {
  id: string;
  status: SyncRunStatus;
  oldest: string;
  newest: string;
  discoveredCount: number;
  processedCount: number;
  failedCount: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface HeartRateZone {
  index: number;
  label: string;
  color: string;
  minBpm: number | null;
  maxBpm: number | null;
  durationSeconds: number | null;
}

export interface ActivitySample {
  index: number;
  sourceIndex: number;
  longitude: number;
  latitude: number;
  elapsedSeconds: number | null;
  distanceMeters: number | null;
  elevationMeters: number | null;
  speedMetersPerSecond: number | null;
  heartRateBpm: number | null;
  heartRateZone: number | null;
}

export interface GeoJsonLineStringFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: {
    activityId: string;
  };
}

export interface ActivitySummary {
  id: string;
  source: "intervals";
  sourceActivityId: string;
  name: string;
  sport: string;
  startAt: string;
  movingTimeSeconds: number | null;
  distanceMeters: number | null;
  hasRoute: boolean;
  hasHeartRate: boolean;
  hasElevation: boolean;
}

export interface ActivityDetail extends ActivitySummary {
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  route: GeoJsonLineStringFeature | null;
  samples: ActivitySample[];
  heartRateZones: HeartRateZone[];
}

export interface ActivityRouteCollection {
  type: "FeatureCollection";
  features: GeoJsonLineStringFeature[];
}

export interface ActivityPage {
  items: ActivitySummary[];
  nextCursor: string | null;
}

export const ingestionEventV1Schema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  type: z.literal("activity.sync.requested"),
  source: z.literal("intervals"),
  syncRunId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  range: z.object({
    oldest: isoDateSchema,
    newest: isoDateSchema,
  }),
});

export type IngestionEventV1 = z.infer<typeof ingestionEventV1Schema>;
