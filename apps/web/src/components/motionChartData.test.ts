import type { ActivitySample } from "@vatove/contracts";
import { describe, expect, it } from "vitest";
import { buildMotionChartData } from "./motionChartData";

function sample(index: number, distanceMeters: number | null, elapsedSeconds: number | null): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: 0,
    latitude: 0,
    elapsedSeconds,
    distanceMeters,
    elevationMeters: null,
    heartRateBpm: null,
    heartRateZone: null,
  };
}

describe("buildMotionChartData", () => {
  const samples = [
    sample(0, 0, 0),
    sample(1, 100, 30),
    sample(2, 300, 70),
  ];

  it("derives seconds per kilometre at the destination sample", () => {
    expect(buildMotionChartData(samples, "pace").points).toEqual([
      { sampleIndex: 1, x: 100, value: 300 },
      { sampleIndex: 2, x: 300, value: 200 },
    ]);
  });

  it("derives kilometres per hour from the same intervals", () => {
    expect(buildMotionChartData(samples, "speed").points.map((point) => point.value)).toEqual([
      12,
      18,
    ]);
  });

  it("omits gaps, stationary samples, resets, and zero-duration intervals", () => {
    const data = buildMotionChartData(
      [
        sample(0, 0, 0),
        sample(1, 0, 10),
        sample(2, null, 20),
        sample(3, 100, 30),
        sample(4, 90, 40),
        sample(5, 120, 40),
        sample(6, 150, 50),
      ],
      "speed",
    );

    expect(data.points).toEqual([{ sampleIndex: 6, x: 150, value: 10.8 }]);
  });
});
