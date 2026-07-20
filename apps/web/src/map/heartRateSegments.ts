import type { ActivityDetail, HeartRateZone } from "@vatove/contracts";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import { NEUTRAL_ROUTE_COLOR } from "./heartRateGradient";

export interface HeartRateSegmentProperties {
  activityId: string;
  color: string;
  zoneIndex: number | null;
}

export type HeartRateSegmentFeature = Feature<LineString, HeartRateSegmentProperties>;
export type HeartRateSegmentCollection = FeatureCollection<
  LineString,
  HeartRateSegmentProperties
>;

function validCoordinate(longitude: number, latitude: number): Position | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

function zoneStyle(
  zoneIndex: number | null,
  zonesByIndex: ReadonlyMap<number, HeartRateZone>,
): Pick<HeartRateSegmentProperties, "color" | "zoneIndex"> {
  if (zoneIndex === null) {
    return { color: NEUTRAL_ROUTE_COLOR, zoneIndex: null };
  }

  const zone = zonesByIndex.get(zoneIndex);
  const color = zone?.color.trim();
  if (!zone || !color) {
    return { color: NEUTRAL_ROUTE_COLOR, zoneIndex: null };
  }
  return { color, zoneIndex: zone.index };
}

function edgeFeature(
  activityId: string,
  start: Position,
  end: Position,
  style: Pick<HeartRateSegmentProperties, "color" | "zoneIndex">,
): HeartRateSegmentFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [start, end],
    },
    properties: {
      activityId,
      color: style.color,
      zoneIndex: style.zoneIndex,
    },
  };
}

function sameCoordinate(left: Position | undefined, right: Position): boolean {
  return left !== undefined && left[0] === right[0] && left[1] === right[1];
}

/**
 * Splits an activity route into contiguous, zone-coloured LineStrings.
 *
 * Each edge uses the zone of its starting sample, matching the existing
 * line-progress gradient. The coordinate at a colour transition is included
 * in both adjoining features so MapLibre cannot render a gap between them.
 */
export function buildHeartRateRouteSegments(
  activity: Pick<ActivityDetail, "id" | "samples" | "heartRateZones">,
): HeartRateSegmentCollection {
  const features: HeartRateSegmentFeature[] = [];
  const zonesByIndex = new Map(
    activity.heartRateZones.map((zone) => [zone.index, zone]),
  );
  let canMergePrevious = false;

  for (let index = 0; index < activity.samples.length - 1; index += 1) {
    const sample = activity.samples[index];
    const nextSample = activity.samples[index + 1];
    if (!sample || !nextSample) continue;

    const start = validCoordinate(sample.longitude, sample.latitude);
    const end = validCoordinate(nextSample.longitude, nextSample.latitude);
    if (!start || !end) {
      canMergePrevious = false;
      continue;
    }

    const style = zoneStyle(sample.heartRateZone, zonesByIndex);
    const previous = canMergePrevious ? features.at(-1) : undefined;
    if (
      previous?.properties.color === style.color &&
      sameCoordinate(previous.geometry.coordinates.at(-1), start)
    ) {
      previous.geometry.coordinates.push(end);
      if (previous.properties.zoneIndex !== style.zoneIndex) {
        previous.properties.zoneIndex = null;
      }
    } else {
      features.push(edgeFeature(activity.id, start, end, style));
    }
    canMergePrevious = true;
  }

  return { type: "FeatureCollection", features };
}
