import type { ActivityDetail, ActivitySample, HeartRateZone } from "@vatove/contracts";
import { Color } from "@maplibre/maplibre-gl-style-spec";
import type { Feature, FeatureCollection, MultiLineString, Position } from "geojson";
import {
  normalizeHeartRateZoneIndex,
  resolveSampleHeartRateZone,
} from "../utils/heartRateZones";

export const NEUTRAL_ROUTE_COLOR = "#9ba8a3";

const NEUTRAL_ZONE_INDEX = 0;
const UNPREFIXED_HEX_COLOR = /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface HeartRateSegmentProperties {
  activityId: string;
  color: string;
  zoneIndex: number;
}

export type HeartRateSegmentCollection = FeatureCollection<
  MultiLineString,
  HeartRateSegmentProperties
>;

export interface HeartRateRouteStats {
  totalEdges: number;
  coloredEdges: number;
  neutralEdges: number;
  discardedEdges: number;
}

export interface HeartRateRoutePresentation {
  data: HeartRateSegmentCollection;
  stats: HeartRateRouteStats;
  hasZoneColors: boolean;
}

interface SegmentStyle {
  zoneIndex: number;
  color: string;
}

interface SegmentGroup extends SegmentStyle {
  lines: Position[][];
}

interface ActiveRun extends SegmentStyle {
  coordinates: Position[];
}

const NEUTRAL_STYLE: SegmentStyle = {
  zoneIndex: NEUTRAL_ZONE_INDEX,
  color: NEUTRAL_ROUTE_COLOR,
};

function emptyCollection(): HeartRateSegmentCollection {
  return { type: "FeatureCollection", features: [] };
}

function emptyStats(): HeartRateRouteStats {
  return {
    totalEdges: 0,
    coloredEdges: 0,
    neutralEdges: 0,
    discardedEdges: 0,
  };
}

function positionForSample(sample: ActivitySample): Position | null {
  if (!Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude)) {
    return null;
  }
  return [sample.longitude, sample.latitude];
}

function normalizeZoneColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = UNPREFIXED_HEX_COLOR.test(trimmed) ? `#${trimmed}` : trimmed;
  if (!Color.parse(candidate)) return null;
  return candidate.startsWith("#") ? candidate.toLowerCase() : candidate;
}

function styleForZone(zone: HeartRateZone | null): SegmentStyle {
  if (!zone) return NEUTRAL_STYLE;
  const zoneIndex = normalizeHeartRateZoneIndex(zone.index);
  const color = normalizeZoneColor(zone.color);
  if (zoneIndex === null || color === null) return NEUTRAL_STYLE;

  return { zoneIndex, color };
}

function styleForEdge(
  start: ActivitySample,
  end: ActivitySample,
  zones: readonly HeartRateZone[],
): SegmentStyle {
  const zone =
    resolveSampleHeartRateZone(start, zones) ??
    resolveSampleHeartRateZone(end, zones);
  return styleForZone(zone);
}

function groupSort(left: SegmentGroup, right: SegmentGroup): number {
  if (left.zoneIndex === NEUTRAL_ZONE_INDEX) return 1;
  if (right.zoneIndex === NEUTRAL_ZONE_INDEX) return -1;
  return left.zoneIndex - right.zoneIndex;
}

/**
 * Builds a bounded, fixed-colour GeoJSON presentation for an activity route.
 *
 * Each adjacent valid GPS pair is assigned to its starting sample's persisted
 * heart-rate zone. The shared zone resolver recovers legacy samples from their
 * BPM and dynamic zone boundaries; the ending sample is consulted only when
 * the starting sample cannot be resolved. Consecutive edges in the same zone
 * become one run, then all runs for a zone are grouped into one MultiLineString.
 */
export function buildHeartRateRoutePresentation(
  activity: Pick<ActivityDetail, "id" | "samples" | "heartRateZones"> | null,
): HeartRateRoutePresentation {
  if (!activity || activity.samples.length < 2) {
    return {
      data: emptyCollection(),
      stats: emptyStats(),
      hasZoneColors: false,
    };
  }

  const stats: HeartRateRouteStats = {
    ...emptyStats(),
    totalEdges: activity.samples.length - 1,
  };
  const groups = new Map<number, SegmentGroup>();
  let activeRun: ActiveRun | null = null;

  const finishRun = (): void => {
    if (!activeRun) return;
    const currentRun = activeRun;
    const group = groups.get(currentRun.zoneIndex);
    if (group) {
      group.lines.push(currentRun.coordinates);
    } else {
      groups.set(currentRun.zoneIndex, {
        zoneIndex: currentRun.zoneIndex,
        color: currentRun.color,
        lines: [currentRun.coordinates],
      });
    }
    activeRun = null;
  };

  for (let index = 0; index < activity.samples.length - 1; index += 1) {
    const start = activity.samples[index];
    const end = activity.samples[index + 1];
    if (!start || !end) continue;

    const startPosition = positionForSample(start);
    const endPosition = positionForSample(end);
    if (!startPosition || !endPosition) {
      stats.discardedEdges += 1;
      finishRun();
      continue;
    }

    const style = styleForEdge(start, end, activity.heartRateZones);
    if (style.zoneIndex === NEUTRAL_ZONE_INDEX) {
      stats.neutralEdges += 1;
    } else {
      stats.coloredEdges += 1;
    }

    if (activeRun?.zoneIndex === style.zoneIndex) {
      activeRun.coordinates.push(endPosition);
      continue;
    }

    finishRun();
    activeRun = {
      ...style,
      coordinates: [startPosition, endPosition],
    };
  }
  finishRun();

  const features: Array<Feature<MultiLineString, HeartRateSegmentProperties>> =
    [...groups.values()].sort(groupSort).map((group) => ({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: group.lines,
      },
      properties: {
        activityId: activity.id,
        color: group.color,
        zoneIndex: group.zoneIndex,
      },
    }));

  return {
    data: { type: "FeatureCollection", features },
    stats,
    hasZoneColors: stats.coloredEdges > 0,
  };
}
