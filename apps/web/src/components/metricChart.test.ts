import { describe, expect, it } from "vitest";
import type { ActivitySample } from "@vatove/contracts";
import {
  buildMetricChartData,
  buildMetricChartSegments,
  findNearestMetricPoint,
  type MetricChartPoint,
} from "./metricChartData";

function sample(
  index: number,
  distanceMeters: number | null,
  elevationMeters: number | null,
): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: 0,
    latitude: 0,
    elapsedSeconds: index,
    distanceMeters,
    elevationMeters,
    heartRateBpm: null,
    heartRateZone: null,
  };
}

describe("buildMetricChartData", () => {
  it("uses distance when every rendered metric point has a finite distance", () => {
    const data = buildMetricChartData(
      [sample(5, 100, 12), sample(7, 350, null), sample(9, 600, 18)],
      (item) => item.elevationMeters,
    );

    expect(data.usesDistance).toBe(true);
    expect(data.points.map(({ sampleIndex, x, value }) => ({ sampleIndex, x, value }))).toEqual([
      { sampleIndex: 5, x: 100, value: 12 },
      { sampleIndex: 9, x: 600, value: 18 },
    ]);
  });

  it("falls the complete axis back to sample positions when distance is incomplete", () => {
    const data = buildMetricChartData(
      [sample(5, 100, 12), sample(7, 350, null), sample(9, null, 18)],
      (item) => item.elevationMeters,
    );

    expect(data.usesDistance).toBe(false);
    expect(data.points.map((point) => point.x)).toEqual([0, 2]);
  });

  it("omits null and non-finite metric values", () => {
    const data = buildMetricChartData(
      [sample(0, 0, null), sample(1, 1, Number.NaN), sample(2, 2, 20)],
      (item) => item.elevationMeters,
    );

    expect(data.points).toHaveLength(1);
    expect(data.points[0]?.sampleIndex).toBe(2);
  });
});

describe("metric chart interactions", () => {
  const points: MetricChartPoint[] = [
    { sampleIndex: 10, x: 0, value: 100, color: "red" },
    { sampleIndex: 20, x: 50, value: 110, color: "blue" },
    { sampleIndex: 30, x: 100, value: 120, color: "green" },
  ];

  it("finds the nearest sample for shared tooltip selection", () => {
    expect(findNearestMetricPoint(points, 62)?.sampleIndex).toBe(20);
    expect(findNearestMetricPoint(points, 91)?.sampleIndex).toBe(30);
  });

  it("colors each connection from its destination metric point", () => {
    expect(buildMetricChartSegments(points).map((segment) => segment.color)).toEqual([
      "blue",
      "green",
    ]);
  });
});
