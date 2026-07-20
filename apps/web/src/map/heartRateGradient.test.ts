import { describe, expect, it } from "vitest";
import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import {
  buildHeartRateGradient,
  buildHeartRateRoutePresentation,
  NEUTRAL_ROUTE_COLOR,
} from "./heartRateGradient";

function sample(index: number, heartRateZone: number | null): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: -1 + index / 100,
    latitude: 52,
    elapsedSeconds: index,
    distanceMeters: index * 10,
    elevationMeters: 100,
    speedMetersPerSecond: null,
    heartRateBpm: heartRateZone === null ? null : 140,
    heartRateZone,
  };
}

const zones: HeartRateZone[] = [
  { index: 1, label: "Easy", color: "#35a66f", minBpm: null, maxBpm: 139, durationSeconds: 120 },
  { index: 2, label: "Tempo", color: "#f5a623", minBpm: 140, maxBpm: null, durationSeconds: 180 },
];

describe("buildHeartRateGradient", () => {
  it("creates hard, increasing progress steps at zone transitions", () => {
    const expression = buildHeartRateGradient(
      [sample(0, 1), sample(1, 1), sample(2, 2), sample(3, 2)],
      zones,
    );
    const stops = expression.slice(3);
    const positions = stops.filter((_, index) => index % 2 === 0) as number[];

    expect(expression.slice(0, 3)).toEqual([
      "step",
      ["line-progress"],
      "#35a66f",
    ]);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every((position) => position > 0 && position < 1)).toBe(true);
    expect(positions.every((position, index) => index === 0 || position > positions[index - 1]!)).toBe(true);
    expect(stops).toContain("#f5a623");
  });

  it("uses the neutral colour when heart rate is absent", () => {
    const expression = buildHeartRateGradient([sample(0, null), sample(1, null)], zones);
    expect(expression).toEqual([
      "step",
      ["line-progress"],
      NEUTRAL_ROUTE_COLOR,
    ]);
  });

  it("positions transitions by route distance rather than sample index", () => {
    const samples = [sample(0, 1), sample(1, 2), sample(2, 2)];
    samples[0]!.longitude = 0;
    samples[1]!.longitude = 0.001;
    samples[2]!.longitude = 0.01;

    const expression = buildHeartRateGradient(samples, zones);
    expect(expression[3]).toBeLessThan(0.2);
  });

  it("keeps a 12k-sample activity in one feature with only zone transition stops", () => {
    const samples = Array.from({ length: 12_441 }, (_, index) =>
      sample(index, index < 4_000 ? 1 : 2),
    );
    const presentation = buildHeartRateRoutePresentation({
      id: "large-activity",
      samples,
      heartRateZones: zones,
    });

    expect(presentation.data.features).toHaveLength(1);
    expect(presentation.data.features[0]?.geometry.coordinates).toHaveLength(12_441);
    expect(presentation.gradient).toHaveLength(5);
    expect(presentation.hasZoneColors).toBe(true);
  });
});
