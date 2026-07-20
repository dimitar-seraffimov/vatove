import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import { describe, expect, it } from "vitest";
import {
  buildHeartRateRoutePresentation,
  NEUTRAL_ROUTE_COLOR,
} from "./heartRateSegments";

function sample(
  index: number,
  heartRateZone: number | null,
  heartRateBpm: number | null = heartRateZone === null ? null : 140,
): ActivitySample {
  return {
    index,
    sourceIndex: index,
    longitude: -1 + index * 0.00001,
    latitude: 52,
    elapsedSeconds: index,
    distanceMeters: index * 10,
    elevationMeters: 100,
    speedMetersPerSecond: null,
    heartRateBpm,
    heartRateZone,
  };
}

function zone(
  index: number,
  color: string,
  minBpm: number | null,
  maxBpm: number | null,
): HeartRateZone {
  return {
    index,
    label: `Zone ${index}`,
    color,
    minBpm,
    maxBpm,
    durationSeconds: null,
  };
}

const zones: HeartRateZone[] = [
  zone(1, "#35A66F", null, 139),
  zone(2, "#f5a623", 140, null),
];

describe("buildHeartRateRoutePresentation", () => {
  it("returns an empty presentation for no activity or fewer than two samples", () => {
    expect(buildHeartRateRoutePresentation(null)).toEqual({
      data: { type: "FeatureCollection", features: [] },
      stats: {
        totalEdges: 0,
        coloredEdges: 0,
        neutralEdges: 0,
        discardedEdges: 0,
      },
      hasZoneColors: false,
    });

    const presentation = buildHeartRateRoutePresentation({
      id: "short",
      samples: [sample(0, 1)],
      heartRateZones: zones,
    });
    expect(presentation.data.features).toEqual([]);
    expect(presentation.stats.totalEdges).toBe(0);
  });

  it("uses the persisted zone before a contradictory BPM-derived zone", () => {
    const presentation = buildHeartRateRoutePresentation({
      id: "persisted-first",
      samples: [sample(0, 1, 180), sample(1, 2, 180)],
      heartRateZones: zones,
    });

    expect(presentation.data.features).toHaveLength(1);
    expect(presentation.data.features[0]?.properties).toEqual({
      activityId: "persisted-first",
      color: "#35a66f",
      zoneIndex: 1,
    });
  });

  it("accepts integer-like zone indices from runtime JSON", () => {
    const runtimeZones = [
      { ...zone(1, "#0f0", null, 150), index: "1" },
    ] as unknown as HeartRateZone[];
    const runtimeSamples = [sample(0, 1, null), sample(1, 1, null)].map((item) => ({
      ...item,
      heartRateZone: "1",
    })) as unknown as ActivitySample[];
    const presentation = buildHeartRateRoutePresentation({
      id: "string-indices",
      samples: runtimeSamples,
      heartRateZones: runtimeZones,
    });

    expect(presentation.stats.coloredEdges).toBe(1);
    expect(presentation.data.features[0]?.properties).toMatchObject({
      color: "#0f0",
      zoneIndex: 1,
    });
  });

  it.each([
    ["#F00", "#f00"],
    ["#FF0000FF", "#ff0000ff"],
    ["FF0000", "#ff0000"],
    ["rgb(255, 0, 0)", "rgb(255, 0, 0)"],
  ])("accepts MapLibre-compatible zone colour %s", (input, expected) => {
    const presentation = buildHeartRateRoutePresentation({
      id: "colour-formats",
      samples: [sample(0, 1), sample(1, 1)],
      heartRateZones: [zone(1, input, null, null)],
    });

    expect(presentation.stats.coloredEdges).toBe(1);
    expect(presentation.data.features[0]?.properties.color).toBe(expected);
  });

  it("uses dynamic BPM boundaries for missing indices and never hardcoded zones", () => {
    const customZones = [
      zone(1, "#111111", null, 199),
      zone(2, "#222222", 200, null),
    ];
    const presentation = buildHeartRateRoutePresentation({
      id: "dynamic",
      samples: [sample(0, null, 175), sample(1, null, 175)],
      heartRateZones: customZones,
    });

    expect(presentation.data.features[0]?.properties.zoneIndex).toBe(1);
    expect(presentation.data.features[0]?.properties.color).toBe("#111111");
  });

  it("falls back to the ending sample for an isolated missing starting HR", () => {
    const presentation = buildHeartRateRoutePresentation({
      id: "endpoint-fallback",
      samples: [sample(0, null, null), sample(1, 2, 160)],
      heartRateZones: zones,
    });

    expect(presentation.stats).toEqual({
      totalEdges: 1,
      coloredEdges: 1,
      neutralEdges: 0,
      discardedEdges: 0,
    });
    expect(presentation.data.features[0]?.properties.zoneIndex).toBe(2);
  });

  it("uses one neutral feature with non-null properties when HR cannot be resolved", () => {
    const presentation = buildHeartRateRoutePresentation({
      id: "neutral",
      samples: [sample(0, null), sample(1, null), sample(2, null)],
      heartRateZones: zones,
    });

    expect(presentation.hasZoneColors).toBe(false);
    expect(presentation.stats.neutralEdges).toBe(2);
    expect(presentation.data.features[0]?.properties).toEqual({
      activityId: "neutral",
      color: NEUTRAL_ROUTE_COLOR,
      zoneIndex: 0,
    });
  });

  it("turns invalid zone indices and colours into neutral segments", () => {
    const invalidZones = [
      zone(-1, "#123456", null, 139),
      zone(2, "not-a-colour", 140, null),
    ];
    const invalidIndex = buildHeartRateRoutePresentation({
      id: "invalid-index",
      samples: [sample(0, -1, 100), sample(1, -1, 100)],
      heartRateZones: invalidZones,
    });
    const invalidColor = buildHeartRateRoutePresentation({
      id: "invalid-color",
      samples: [sample(0, 2, 150), sample(1, 2, 150)],
      heartRateZones: invalidZones,
    });

    expect(invalidIndex.data.features[0]?.properties).toMatchObject({
      color: NEUTRAL_ROUTE_COLOR,
      zoneIndex: 0,
    });
    expect(invalidColor.data.features[0]?.properties).toMatchObject({
      color: NEUTRAL_ROUTE_COLOR,
      zoneIndex: 0,
    });
  });

  it("merges contiguous edges and duplicates their transition coordinate", () => {
    const samples = [sample(0, 1), sample(1, 1), sample(2, 2), sample(3, 2)];
    const presentation = buildHeartRateRoutePresentation({
      id: "transitions",
      samples,
      heartRateZones: zones,
    });
    const zoneOne = presentation.data.features.find(
      (feature) => feature.properties.zoneIndex === 1,
    );
    const zoneTwo = presentation.data.features.find(
      (feature) => feature.properties.zoneIndex === 2,
    );

    expect(zoneOne?.geometry.coordinates).toHaveLength(1);
    expect(zoneOne?.geometry.coordinates[0]).toHaveLength(3);
    expect(zoneTwo?.geometry.coordinates).toHaveLength(1);
    expect(zoneOne?.geometry.coordinates[0]?.at(-1)).toEqual(
      zoneTwo?.geometry.coordinates[0]?.at(0),
    );
    expect(presentation.stats.coloredEdges).toBe(3);
  });

  it("breaks runs at invalid coordinates instead of bridging gaps", () => {
    const samples = [
      sample(0, 1),
      sample(1, 1),
      sample(2, 1),
      sample(3, 1),
      sample(4, 1),
    ];
    samples[2]!.longitude = Number.NaN;

    const presentation = buildHeartRateRoutePresentation({
      id: "broken-route",
      samples,
      heartRateZones: zones,
    });

    expect(presentation.stats).toEqual({
      totalEdges: 4,
      coloredEdges: 2,
      neutralEdges: 0,
      discardedEdges: 2,
    });
    expect(presentation.data.features).toHaveLength(1);
    expect(presentation.data.features[0]?.geometry.coordinates).toHaveLength(2);
    expect(presentation.data.features[0]?.geometry.coordinates).toEqual([
      [
        [samples[0]!.longitude, samples[0]!.latitude],
        [samples[1]!.longitude, samples[1]!.latitude],
      ],
      [
        [samples[3]!.longitude, samples[3]!.latitude],
        [samples[4]!.longitude, samples[4]!.latitude],
      ],
    ]);
  });

  it("bounds a 12,441-sample frequently changing route to one feature per zone", () => {
    const sevenZones = Array.from({ length: 7 }, (_, index) =>
      zone(index + 1, `#${(index + 1).toString(16).repeat(6)}`, null, null),
    );
    const samples = Array.from({ length: 12_441 }, (_, index) =>
      sample(index, (index % sevenZones.length) + 1, 150),
    );
    const presentation = buildHeartRateRoutePresentation({
      id: "large-activity",
      samples,
      heartRateZones: sevenZones,
    });

    expect(presentation.data.features).toHaveLength(7);
    expect(presentation.data.features.length).toBeLessThanOrEqual(sevenZones.length + 1);
    expect(presentation.stats).toEqual({
      totalEdges: 12_440,
      coloredEdges: 12_440,
      neutralEdges: 0,
      discardedEdges: 0,
    });
    expect(presentation.hasZoneColors).toBe(true);
    for (const feature of presentation.data.features) {
      expect(feature.properties.activityId).toBe("large-activity");
      expect(feature.properties.zoneIndex).toBeTypeOf("number");
      expect(feature.properties.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
    }
  });
});
