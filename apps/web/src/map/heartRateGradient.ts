import type { ActivityDetail, ActivitySample, HeartRateZone } from "@vatove/contracts";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import { resolveSampleHeartRateZone } from "../utils/heartRateZones";

export const NEUTRAL_ROUTE_COLOR = "#9ba8a3";

export type LineGradientExpression = [
  "step",
  ["line-progress"],
  string,
  ...Array<number | string>,
];

export interface ActiveRouteProperties {
  activityId: string;
}

export type ActiveRouteCollection = FeatureCollection<LineString, ActiveRouteProperties>;

export interface HeartRateRoutePresentation {
  data: ActiveRouteCollection;
  gradient: LineGradientExpression;
  hasZoneColors: boolean;
}

const EMPTY_ACTIVE_ROUTE: ActiveRouteCollection = {
  type: "FeatureCollection",
  features: [],
};

function sampleColor(sample: ActivitySample, zones: readonly HeartRateZone[]): string {
  return resolveSampleHeartRateZone(sample, zones)?.color.trim() || NEUTRAL_ROUTE_COLOR;
}

function validPosition(sample: ActivitySample): Position | null {
  if (!Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude)) return null;
  return [sample.longitude, sample.latitude];
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(left: Position, right: Position): number {
  const latitudeDelta = radians((right[1] as number) - (left[1] as number));
  const longitudeDelta = radians((right[0] as number) - (left[0] as number));
  const leftLatitude = radians(left[1] as number);
  const rightLatitude = radians(right[1] as number);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

interface RoutePoint {
  sample: ActivitySample;
  coordinate: Position;
  distance: number;
}

function routePoints(samples: readonly ActivitySample[]): RoutePoint[] {
  const points: RoutePoint[] = [];
  let cumulativeDistance = 0;
  for (const sample of samples) {
    const coordinate = validPosition(sample);
    if (!coordinate) continue;
    const previous = points.at(-1);
    if (previous) cumulativeDistance += distanceMeters(previous.coordinate, coordinate);
    points.push({ sample, coordinate, distance: cumulativeDistance });
  }
  return points;
}

/**
 * Creates a hard-stepped MapLibre line gradient. Progress is based on actual
 * route distance, matching MapLibre's `line-progress`, rather than array index.
 * Only zone transitions become expression stops, so even long activities stay
 * a single lightweight GeoJSON feature.
 */
export function buildHeartRateGradient(
  samples: readonly ActivitySample[],
  zones: readonly HeartRateZone[],
): LineGradientExpression {
  return gradientForPoints(routePoints(samples), zones).gradient;
}

function gradientForPoints(
  points: readonly RoutePoint[],
  zones: readonly HeartRateZone[],
): Pick<HeartRateRoutePresentation, "gradient" | "hasZoneColors"> {
  if (points.length < 2) {
    return {
      gradient: ["step", ["line-progress"], NEUTRAL_ROUTE_COLOR],
      hasZoneColors: false,
    };
  }

  const colors = points.map(({ sample }) => sampleColor(sample, zones));
  let initialColor = colors[0] ?? NEUTRAL_ROUTE_COLOR;
  let currentColor = initialColor;
  const totalDistance = points.at(-1)?.distance ?? 0;
  const stops: Array<number | string> = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const nextColor = colors[index] ?? NEUTRAL_ROUTE_COLOR;
    if (nextColor === currentColor) continue;
    const progress =
      totalDistance > 0
        ? (points[index]?.distance ?? 0) / totalDistance
        : index / (points.length - 1);
    if (progress <= 0) {
      initialColor = nextColor;
    } else if (progress < 1) {
      const previousProgress = stops.at(-2);
      if (typeof previousProgress === "number" && progress <= previousProgress) {
        stops[stops.length - 1] = nextColor;
      } else {
        stops.push(progress, nextColor);
      }
    }
    currentColor = nextColor;
  }

  return {
    gradient: ["step", ["line-progress"], initialColor, ...stops],
    hasZoneColors: colors.some((color) => color !== NEUTRAL_ROUTE_COLOR),
  };
}

export function buildHeartRateRoutePresentation(
  activity: Pick<ActivityDetail, "id" | "samples" | "heartRateZones"> | null,
): HeartRateRoutePresentation {
  if (!activity) {
    return {
      data: EMPTY_ACTIVE_ROUTE,
      gradient: ["step", ["line-progress"], NEUTRAL_ROUTE_COLOR],
      hasZoneColors: false,
    };
  }

  const points = routePoints(activity.samples);
  if (points.length < 2) {
    return {
      data: EMPTY_ACTIVE_ROUTE,
      gradient: ["step", ["line-progress"], NEUTRAL_ROUTE_COLOR],
      hasZoneColors: false,
    };
  }

  const feature: Feature<LineString, ActiveRouteProperties> = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => point.coordinate),
    },
    properties: { activityId: activity.id },
  };
  const style = gradientForPoints(points, activity.heartRateZones);
  return {
    data: { type: "FeatureCollection", features: [feature] },
    ...style,
  };
}
