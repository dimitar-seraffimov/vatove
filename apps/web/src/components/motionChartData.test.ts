import type { ActivitySample } from "@vatove/contracts";
import { describe, expect, it } from "vitest";
import { buildMotionChartData } from "./motionChartData";

function sample(
  index: number,
  distanceMeters: number | null,
  speedMetersPerSecond: number | null,
): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: 0,
    latitude: 0,
    elapsedSeconds: index * 10,
    distanceMeters,
    elevationMeters: null,
    speedMetersPerSecond,
    heartRateBpm: null,
    heartRateZone: null,
  };
}

describe("buildMotionChartData", () => {
  const samples = [
    sample(0, 100, 10 / 3),
    sample(1, 300, 5),
  ];

  it("converts Intervals velocity into seconds per kilometre", () => {
    expect(buildMotionChartData(samples, "pace").points).toEqual([
      { sampleIndex: 0, x: 100, value: 300 },
      { sampleIndex: 1, x: 300, value: 200 },
    ]);
  });

  it("converts the same Intervals velocity into kilometres per hour", () => {
    const values = buildMotionChartData(samples, "speed").points.map((point) => point.value);
    expect(values[0]).toBeCloseTo(12);
    expect(values[1]).toBeCloseTo(18);
  });

  it("formats swimming pace against 100 metres", () => {
    expect(buildMotionChartData(samples, "pace", 100).points.map((point) => point.value)).toEqual([
      30,
      20,
    ]);
  });

  it("omits missing, stationary, negative, non-finite, or positionless velocity samples", () => {
    const data = buildMotionChartData(
      [
        sample(0, 0, null),
        sample(1, 10, 0),
        sample(2, 20, -1),
        sample(3, 30, Number.NaN),
        sample(4, null, 3),
        sample(5, 50, 3),
      ],
      "speed",
    );

    expect(data.points).toEqual([{ sampleIndex: 5, x: 50, value: 10.8 }]);
  });
});
