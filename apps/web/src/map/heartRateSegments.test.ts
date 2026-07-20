import type {
  ActivityDetail,
  ActivitySample,
  HeartRateZone,
} from "@vatove/contracts";
import { describe, expect, it } from "vitest";
import { NEUTRAL_ROUTE_COLOR } from "./heartRateGradient";
import { buildHeartRateRouteSegments } from "./heartRateSegments";

function sample(index: number, heartRateZone: number | null): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: -1 + index / 100,
    latitude: 52 + index / 100,
    elapsedSeconds: index * 10,
    distanceMeters: index * 100,
    elevationMeters: 100 + index,
    heartRateBpm: heartRateZone === null ? null : 140,
    heartRateZone,
  };
}

const zones: HeartRateZone[] = [
  {
    index: 1,
    label: "Easy",
    color: "#35a66f",
    minBpm: null,
    maxBpm: 139,
    durationSeconds: 120,
  },
  {
    index: 2,
    label: "Tempo",
    color: "#f5a623",
    minBpm: 140,
    maxBpm: null,
    durationSeconds: 180,
  },
];

function activity(
  samples: ActivitySample[],
  heartRateZones: HeartRateZone[] = zones,
): Pick<ActivityDetail, "id" | "samples" | "heartRateZones"> {
  return {
    id: "activity-123",
    samples,
    heartRateZones,
  };
}

describe("buildHeartRateRouteSegments", () => {
  it("merges adjacent edges in one zone and duplicates transition coordinates", () => {
    const collection = buildHeartRateRouteSegments(
      activity([sample(0, 1), sample(1, 1), sample(2, 2), sample(3, 2)]),
    );

    expect(collection).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-1, 52],
              [-0.99, 52.01],
              [-0.98, 52.02],
            ],
          },
          properties: {
            activityId: "activity-123",
            color: "#35a66f",
            zoneIndex: 1,
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [-0.98, 52.02],
              [-0.97, 52.03],
            ],
          },
          properties: {
            activityId: "activity-123",
            color: "#f5a623",
            zoneIndex: 2,
          },
        },
      ],
    });
  });

  it("recovers an unmatched persisted zone from BPM and dynamic boundaries", () => {
    const collection = buildHeartRateRouteSegments(
      activity([sample(0, null), sample(1, 99), sample(2, 1)]),
    );

    expect(collection.features.map((feature) => feature.properties)).toEqual([
      { activityId: "activity-123", color: "#f5a623", zoneIndex: 2 },
    ]);
  });

  it("borrows the next valid sample zone for an edge with missing starting HR", () => {
    const collection = buildHeartRateRouteSegments(
      activity([sample(0, null), sample(1, 1), sample(2, 1)]),
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.color).toBe("#35a66f");
  });

  it("retains the neutral fallback when neither endpoint has usable HR", () => {
    const collection = buildHeartRateRouteSegments(
      activity([sample(0, null), sample(1, null), sample(2, null)]),
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toMatchObject({
      color: NEUTRAL_ROUTE_COLOR,
      zoneIndex: null,
    });
  });

  it("merges equal colours and clears an ambiguous zone index", () => {
    const sameColourZones = zones.map((zone) => ({ ...zone, color: "#abcdef" }));
    const collection = buildHeartRateRouteSegments(
      activity([sample(0, 1), sample(1, 2), sample(2, 2)], sameColourZones),
    );

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({
      activityId: "activity-123",
      color: "#abcdef",
      zoneIndex: null,
    });
  });

  it("breaks segments at invalid coordinates instead of bridging the gap", () => {
    const invalid = { ...sample(2, 1), longitude: Number.NaN };
    const collection = buildHeartRateRouteSegments(
      activity([
        sample(0, 1),
        sample(1, 1),
        invalid,
        sample(3, 1),
        sample(4, 1),
      ]),
    );

    expect(collection.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [
        [-1, 52],
        [-0.99, 52.01],
      ],
      [
        [-0.97, 52.03],
        [-0.96, 52.04],
      ],
    ]);
  });

  it("returns an empty collection when there is no drawable edge", () => {
    expect(buildHeartRateRouteSegments(activity([]))).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(buildHeartRateRouteSegments(activity([sample(0, 1)]))).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });
});
