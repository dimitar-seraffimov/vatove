import type { ActivityDetail, ActivitySample, HeartRateZone } from "@vatove/contracts";
import { Color } from "@maplibre/maplibre-gl-style-spec";
import type { Feature, FeatureCollection, MultiLineString, Position } from "geojson";
import { resolveSampleHeartRateZone } from "../utils/heartRateZones";

export const NEUTRAL_ROUTE_COLOR = "#9ba8a3";

const NEUTRAL_ZONE_INDEX = 0;

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
  const lon = Number(sample.longitude);
  const lat = Number(sample.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }
  return [lon, lat];
}

function normalizeZoneColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[0-9a-f]{3,8}$/i.test(trimmed) ? `#${trimmed}` : trimmed;
  const parsed = Color.parse(candidate);
  if (!parsed) return null;

  return `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${parsed.a})`;
}

function styleForZone(zone: HeartRateZone | null): SegmentStyle {
  if (!zone) return NEUTRAL_STYLE;
  
  const zoneIndex = parseInt(String(zone.index), 10);
  if (Number.isNaN(zoneIndex) || zoneIndex <= NEUTRAL_ZONE_INDEX) return NEUTRAL_STYLE;

  const color = normalizeZoneColor(zone.color);
  if (color === null) return NEUTRAL_STYLE;

  return { zoneIndex, color };
}

function groupSort(left: SegmentGroup, right: SegmentGroup): number {
  if (left.zoneIndex === NEUTRAL_ZONE_INDEX) return 1;
  if (right.zoneIndex === NEUTRAL_ZONE_INDEX) return -1;
  return left.zoneIndex - right.zoneIndex;
}

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

  const stats: HeartRateRouteStats = emptyStats();
  
  const precomputedStyles = new Map<number, SegmentStyle>();
  for (const zone of activity.heartRateZones) {
    const style = styleForZone(zone);
    precomputedStyles.set(style.zoneIndex, style);
  }

  const groups = new Map<number, SegmentGroup>();
  let activeRun: ActiveRun | null = null;

  const finishRun = (): void => {
    if (!activeRun || activeRun.coordinates.length < 2) return;
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

  let lastValidSample: ActivitySample | null = null;
  let lastValidPosition: Position | null = null;
  let lastKnownZoneIndex = NEUTRAL_ZONE_INDEX;

  for (const sample of activity.samples) {
    const pos = positionForSample(sample);
    if (!pos) {
      stats.discardedEdges += 1;
      continue;
    }

    const resolvedZone = resolveSampleHeartRateZone(sample, activity.heartRateZones);
    const sampleZoneIndex = resolvedZone ? parseInt(String(resolvedZone.index), 10) : NEUTRAL_ZONE_INDEX;

    if (lastValidSample && lastValidPosition) {
      stats.totalEdges += 1;
      
      const resolvedPreviousZone = resolveSampleHeartRateZone(lastValidSample, activity.heartRateZones);
      const previousZoneIndex = resolvedPreviousZone ? parseInt(String(resolvedPreviousZone.index), 10) : NEUTRAL_ZONE_INDEX;
      
      const edgeZoneIndex = 
        !Number.isNaN(sampleZoneIndex) && sampleZoneIndex > NEUTRAL_ZONE_INDEX ? sampleZoneIndex :
        !Number.isNaN(previousZoneIndex) && previousZoneIndex > NEUTRAL_ZONE_INDEX ? previousZoneIndex :
        lastKnownZoneIndex;

      const style = precomputedStyles.get(edgeZoneIndex) ?? NEUTRAL_STYLE;

      if (style.zoneIndex === NEUTRAL_ZONE_INDEX) {
        stats.neutralEdges += 1;
      } else {
        stats.coloredEdges += 1;
      }

      if (activeRun?.zoneIndex === style.zoneIndex) {
        activeRun.coordinates.push(pos);
      } else {
        finishRun();
        activeRun = {
          ...style,
          coordinates: [lastValidPosition, pos],
        };
      }
    }

    lastValidSample = sample;
    lastValidPosition = pos;
    if (!Number.isNaN(sampleZoneIndex) && sampleZoneIndex > NEUTRAL_ZONE_INDEX) {
      lastKnownZoneIndex = sampleZoneIndex;
    }
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