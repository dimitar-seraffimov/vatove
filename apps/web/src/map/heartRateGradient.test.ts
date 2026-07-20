import { describe, expect, it } from "vitest";
import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import {
  buildHeartRateGradient,
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
    heartRateBpm: heartRateZone === null ? null : 140,
    heartRateZone,
  };
}

const zones: HeartRateZone[] = [
  { index: 1, label: "Easy", color: "#35a66f", minBpm: null, maxBpm: 139 },
  { index: 2, label: "Tempo", color: "#f5a623", minBpm: 140, maxBpm: null },
];

describe("buildHeartRateGradient", () => {
  it("creates bounded, increasing progress stops at zone transitions", () => {
    const expression = buildHeartRateGradient(
      [sample(0, 1), sample(1, 1), sample(2, 2), sample(3, 2)],
      zones,
    );
    const stops = expression.slice(3);
    const positions = stops.filter((_, index) => index % 2 === 0) as number[];

    expect(expression.slice(0, 3)).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
    ]);
    expect(positions[0]).toBe(0);
    expect(positions.at(-1)).toBe(1);
    expect(positions.every((position, index) => index === 0 || position > positions[index - 1]!)).toBe(true);
    expect(stops).toContain("#35a66f");
    expect(stops).toContain("#f5a623");
  });

  it("uses the neutral colour when heart rate is absent", () => {
    const expression = buildHeartRateGradient([sample(0, null), sample(1, null)], zones);
    expect(expression).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      NEUTRAL_ROUTE_COLOR,
      1,
      NEUTRAL_ROUTE_COLOR,
    ]);
  });
});
