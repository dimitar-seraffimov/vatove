import { describe, expect, it } from "vitest";
import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import {
  buildHeartRateChartData,
  HEART_RATE_CHART_NEUTRAL_COLOR,
} from "./heartRateChartData";

function sample(
  index: number,
  heartRateBpm: number | null,
  heartRateZone: number | null,
): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: 0,
    latitude: 0,
    elapsedSeconds: index,
    distanceMeters: index * 100,
    elevationMeters: null,
    heartRateBpm,
    heartRateZone,
  };
}

function zone(index: number, color: string): HeartRateZone {
  return {
    index,
    label: `Zone ${index}`,
    color,
    minBpm: null,
    maxBpm: null,
    durationSeconds: null,
  };
}

describe("buildHeartRateChartData", () => {
  it("maps valid BPM samples to colors from the activity's dynamic zones", () => {
    const data = buildHeartRateChartData(
      [sample(0, 120, 1), sample(1, 145, 2), sample(2, 160, 3)],
      [zone(1, "#117733"), zone(2, " #ddaa33 "), zone(3, "#cc3311")],
    );

    expect(data.points.map((point) => [point.value, point.color])).toEqual([
      [120, "#117733"],
      [145, "#ddaa33"],
      [160, "#cc3311"],
    ]);
  });

  it("uses a neutral color for missing, unknown, or empty zones", () => {
    const data = buildHeartRateChartData(
      [sample(0, 120, null), sample(1, 145, 20), sample(2, 160, 3)],
      [zone(3, "  ")],
    );

    expect(data.points.map((point) => point.color)).toEqual([
      HEART_RATE_CHART_NEUTRAL_COLOR,
      HEART_RATE_CHART_NEUTRAL_COLOR,
      HEART_RATE_CHART_NEUTRAL_COLOR,
    ]);
  });

  it("excludes missing BPM samples so callers can require at least two points", () => {
    const data = buildHeartRateChartData(
      [sample(0, null, 1), sample(1, Number.NaN, 1), sample(2, 150, 1)],
      [zone(1, "#117733")],
    );

    expect(data.points).toHaveLength(1);
  });
});
