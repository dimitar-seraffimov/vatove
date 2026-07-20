import type { ActivitySample, HeartRateZone } from "@vatove/contracts";

export const NEUTRAL_ROUTE_COLOR = "#9ba8a3";

export type LineGradientExpression = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  ...Array<number | string>,
];

function zoneColor(
  zoneIndex: number | null,
  zonesByIndex: ReadonlyMap<number, HeartRateZone>,
): string {
  if (zoneIndex === null) return NEUTRAL_ROUTE_COLOR;
  const color = zonesByIndex.get(zoneIndex)?.color.trim();
  return color ? color : NEUTRAL_ROUTE_COLOR;
}

/**
 * Builds a bounded line-progress expression while keeping the route as one
 * GeoJSON feature. A tiny same-colour stop before each zone boundary prevents
 * the whole preceding segment from blending into the next zone.
 */
export function buildHeartRateGradient(
  samples: readonly ActivitySample[],
  zones: readonly HeartRateZone[],
): LineGradientExpression {
  const zonesByIndex = new Map(zones.map((zone) => [zone.index, zone]));
  if (samples.length < 2) {
    return [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      NEUTRAL_ROUTE_COLOR,
      1,
      NEUTRAL_ROUTE_COLOR,
    ];
  }

  const colors = samples.map((sample) =>
    zoneColor(sample.heartRateZone, zonesByIndex),
  );
  const stops: Array<number | string> = [0, colors[0] ?? NEUTRAL_ROUTE_COLOR];
  let currentColor = colors[0] ?? NEUTRAL_ROUTE_COLOR;
  const transitionWidth = Math.min(0.0001, 0.2 / (samples.length - 1));

  for (let index = 1; index < colors.length; index += 1) {
    const nextColor = colors[index] ?? NEUTRAL_ROUTE_COLOR;
    if (nextColor === currentColor) continue;
    const progress = index / (samples.length - 1);
    stops.push(Math.max(0, progress - transitionWidth), currentColor);
    stops.push(progress, nextColor);
    currentColor = nextColor;
  }

  const lastStop = stops.at(-2);
  if (typeof lastStop !== "number" || lastStop < 1) stops.push(1, currentColor);

  return ["interpolate", ["linear"], ["line-progress"], ...stops];
}
