import { lineString, point } from "@turf/helpers";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { ActivitySample } from "@vatove/contracts";

type Coordinate = [number, number];

function squaredDistance(a: Coordinate, b: Coordinate): number {
  const longitudeScale = Math.cos((b[1] * Math.PI) / 180);
  const dx = (a[0] - b[0]) * longitudeScale;
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Returns the activity sample index nearest to a map interaction. */
export function snapToSampleIndex(
  coordinates: readonly Coordinate[],
  samples: readonly ActivitySample[],
  clicked: Coordinate,
): number | null {
  if (coordinates.length < 2 || samples.length === 0) return null;

  const snapped = nearestPointOnLine(
    lineString([...coordinates]),
    point(clicked),
    { units: "kilometers" },
  );
  const snappedCoordinate = snapped.geometry.coordinates as Coordinate;
  const segment = Math.max(
    0,
    Math.min(
      coordinates.length - 2,
      typeof snapped.properties.index === "number" ? snapped.properties.index : 0,
    ),
  );
  const candidates = [segment, segment + 1].filter(
    (index) => index < coordinates.length && index < samples.length,
  );
  if (candidates.length === 0) return null;

  const closest = candidates.reduce((best, candidate) => {
    const bestCoordinate = coordinates[best];
    const candidateCoordinate = coordinates[candidate];
    if (!bestCoordinate || !candidateCoordinate) return best;
    return squaredDistance(candidateCoordinate, snappedCoordinate) <
      squaredDistance(bestCoordinate, snappedCoordinate)
      ? candidate
      : best;
  });

  return samples[closest]?.index ?? null;
}
