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

  const candidate = UNPREFIXED_HEX_COLOR.test(trimmed) ? `#${trimmed}` : trimmed;
  const parsed = Color.parse(candidate);
  if (!parsed) return null;

  return `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${parsed.a})`;
}

function styleForZone(zone: HeartRateZone | null): SegmentStyle {
  if (!zone) return NEUTRAL_STYLE;
  
  const zoneIndex = normalizeHeartRateZoneIndex(zone.index);
  if (zoneIndex === null || zoneIndex <= NEUTRAL_ZONE_INDEX) return NEUTRAL_STYLE;

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

  const stats: HeartRateRouteStats = {
    ...emptyStats(),
    totalEdges: activity.samples.length - 1,
  };
  
  const precomputedStyles = new Map<number, SegmentStyle>();
  for (const zone of activity.heartRateZones) {
    const style = styleForZone(zone);
    if (style.zoneIndex !== NEUTRAL_ZONE_INDEX) {
      precomputedStyles.set(style.zoneIndex, style);
    }
  }

  const groups = new Map<number, SegmentGroup>();
  let activeRun: ActiveRun | null = null;
  let lastKnownZoneIndex = NEUTRAL_ZONE_INDEX;

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

    const resolvedZone = 
      resolveSampleHeartRateZone(start, activity.heartRateZones) ?? 
      resolveSampleHeartRateZone(end, activity.heartRateZones);
      
    let style = styleForZone(resolvedZone);

    if (style.zoneIndex === NEUTRAL_ZONE_INDEX && lastKnownZoneIndex !== NEUTRAL_ZONE_INDEX) {
      style = precomputedStyles.get(lastKnownZoneIndex) ?? NEUTRAL_STYLE;
    } else if (style.zoneIndex !== NEUTRAL_ZONE_INDEX) {
      lastKnownZoneIndex = style.zoneIndex;
    }

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

  const presentation: HeartRateRoutePresentation = {
    data: { type: "FeatureCollection", features },
    stats,
    hasZoneColors: stats.coloredEdges > 0,
  };

  // --- ADDED LOG ---
  console.log(JSON.stringify({
    diagnostic: "HEART_RATE_SEGMENTS_PAYLOAD",
    featureCount: presentation.data.features.length,
    sampleFeature: presentation.data.features[0],
    properties: presentation.data.features[0]?.properties
  }, null, 2));
  // -----------------

  return presentation;
}