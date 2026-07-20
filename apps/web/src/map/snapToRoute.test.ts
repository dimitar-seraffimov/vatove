import { describe, expect, it } from "vitest";
import type { ActivitySample } from "@vatove/contracts";
import { snapToSampleIndex } from "./snapToRoute";

function samples(): ActivitySample[] {
  return [10, 20, 30].map((index, position) => ({
    index,
    sourceIndex: index + 100,
    longitude: position,
    latitude: 0,
    elapsedSeconds: position * 60,
    distanceMeters: position * 1_000,
    elevationMeters: 100 + position,
    speedMetersPerSecond: 2,
    heartRateBpm: 130,
    heartRateZone: 1,
  }));
}

describe("snapToSampleIndex", () => {
  it("returns the original activity sample index nearest the snapped point", () => {
    expect(
      snapToSampleIndex(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        samples(),
        [1.86, 0.02],
      ),
    ).toBe(30);
  });

  it("returns null for a route that cannot form a line", () => {
    expect(snapToSampleIndex([[0, 0]], samples(), [0, 0])).toBeNull();
  });
});
