import type { ActivityDetail } from "@vatove/contracts";
import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_LAYER_ID,
  ACTIVE_SOURCE_ID,
  activeSourceContainsActivity,
  ensureActivityMapLayers,
  OVERVIEW_SELECTED_LAYER_ID,
  setSelectedLoadingHighlight,
  type RouteCollection,
} from "./activityMapLayers";
import { buildHeartRateRoutePresentation } from "./heartRateSegments";

const routes: RouteCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.2, 51.5],
          [-0.1, 51.6],
        ],
      },
      properties: { activityId: "activity-1" },
    },
  ],
};

function detail(id: string): ActivityDetail {
  return {
    id,
    source: "intervals",
    sourceActivityId: "i1",
    name: "Zoned ride",
    sport: "Ride",
    startAt: "2026-07-20T08:00:00.000Z",
    movingTimeSeconds: 60,
    distanceMeters: 100,
    hasRoute: true,
    hasHeartRate: true,
    hasElevation: false,
    averageHeartRateBpm: 145,
    maxHeartRateBpm: 151,
    route: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.2, 51.5],
          [-0.1, 51.6],
        ],
      },
      properties: { activityId: id },
    },
    samples: [
      {
        index: 0,
        sourceIndex: 0,
        longitude: -0.2,
        latitude: 51.5,
        elapsedSeconds: 0,
        distanceMeters: 0,
        elevationMeters: null,
        speedMetersPerSecond: null,
        heartRateBpm: 140,
        heartRateZone: 1,
      },
      {
        index: 1,
        sourceIndex: 1,
        longitude: -0.1,
        latitude: 51.6,
        elapsedSeconds: 60,
        distanceMeters: 100,
        elevationMeters: null,
        speedMetersPerSecond: null,
        heartRateBpm: 150,
        heartRateZone: 2,
      },
    ],
    heartRateZones: [
      {
        index: 1,
        label: "Easy",
        color: "#22c55e",
        minBpm: null,
        maxBpm: 145,
        durationSeconds: 30,
      },
      {
        index: 2,
        label: "Hard",
        color: "#ef4444",
        minBpm: 146,
        maxBpm: null,
        durationSeconds: 30,
      },
    ],
  };
}

function fakeMap(styleLoaded = true) {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");

  const map = {
    isStyleLoaded: vi.fn(() => styleLoaded),
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, source: unknown) => {
      void source;
      sources.set(id, { setData: vi.fn() });
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((layer: { id: string }) => {
      layers.set(layer.id, layer);
    }),
    setFilter: vi.fn(),
    setPaintProperty: vi.fn(),
    moveLayer: vi.fn(),
    querySourceFeatures: vi.fn(
      (): Array<{ properties?: Record<string, unknown> }> => [],
    ),
    fitBounds: vi.fn(),
    getContainer: vi.fn(() => container),
    getCanvas: vi.fn(() => canvas),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    setProjection: vi.fn(),
    triggerRepaint: vi.fn(),
    resize: vi.fn(),
  };
  return { map: map as unknown as MapLibreMap, raw: map, sources, layers };
}

describe("ensureActivityMapLayers", () => {
  it("uses one property-coloured source without line metrics or a gradient", () => {
    const fixture = fakeMap();
    const presentation = buildHeartRateRoutePresentation(detail("activity-1"));

    ensureActivityMapLayers(fixture.map, routes, presentation, "activity-1", false);

    const activeSourceCall = fixture.raw.addSource.mock.calls.find(
      ([id]) => id === ACTIVE_SOURCE_ID,
    );
    expect(activeSourceCall?.[1]).toEqual({ type: "geojson", data: presentation.data });
    expect(activeSourceCall?.[1]).not.toHaveProperty("lineMetrics");

    const activeLayer = fixture.layers.get(ACTIVE_LAYER_ID) as {
      filter: unknown;
      paint: Record<string, unknown>;
    };
    expect(activeLayer.filter).toEqual(["==", ["get", "activityId"], "activity-1"]);
    expect(activeLayer.paint["line-color"]).toEqual([
      "coalesce",
      ["get", "color"],
      "#9ba8a3",
    ]);
    expect(activeLayer.paint).not.toHaveProperty("line-gradient");
    expect(fixture.raw.setPaintProperty).not.toHaveBeenCalled();
  });

  it("updates only source data and filters during a later selection", () => {
    const fixture = fakeMap();
    const first = buildHeartRateRoutePresentation(detail("activity-1"));
    const second = buildHeartRateRoutePresentation(detail("activity-2"));
    ensureActivityMapLayers(fixture.map, routes, first, "activity-1", true);
    fixture.raw.setFilter.mockClear();
    fixture.raw.setPaintProperty.mockClear();

    ensureActivityMapLayers(fixture.map, routes, second, "activity-2", false);

    expect(fixture.sources.get(ACTIVE_SOURCE_ID)?.setData).toHaveBeenLastCalledWith(second.data);
    expect(fixture.raw.setFilter).toHaveBeenCalledWith(
      ACTIVE_LAYER_ID,
      ["==", ["get", "activityId"], "activity-2"],
    );
    expect(fixture.raw.setFilter).toHaveBeenCalledWith(
      OVERVIEW_SELECTED_LAYER_ID,
      ["==", ["get", "activityId"], ""],
    );
    expect(fixture.raw.setPaintProperty).not.toHaveBeenCalled();
  });

  it("does nothing until the style is ready", () => {
    const fixture = fakeMap(false);
    ensureActivityMapLayers(
      fixture.map,
      routes,
      buildHeartRateRoutePresentation(detail("activity-1")),
      "activity-1",
      true,
    );
    expect(fixture.raw.addSource).not.toHaveBeenCalled();
    expect(fixture.raw.addLayer).not.toHaveBeenCalled();
  });

  it("hides the loading highlight only for source data belonging to the current activity", () => {
    const fixture = fakeMap();
    ensureActivityMapLayers(
      fixture.map,
      routes,
      buildHeartRateRoutePresentation(detail("activity-1")),
      "activity-1",
      true,
    );
    fixture.raw.querySourceFeatures.mockReturnValue([
      { properties: { activityId: "activity-1" } },
    ]);

    expect(activeSourceContainsActivity(fixture.map, "activity-1")).toBe(true);
    expect(activeSourceContainsActivity(fixture.map, "activity-2")).toBe(false);
    setSelectedLoadingHighlight(fixture.map, null);
    expect(fixture.raw.setFilter).toHaveBeenLastCalledWith(
      OVERVIEW_SELECTED_LAYER_ID,
      ["==", ["get", "activityId"], ""],
    );

    fixture.raw.querySourceFeatures.mockImplementation(() => {
      throw new Error("source worker is not ready");
    });
    expect(activeSourceContainsActivity(fixture.map, "activity-1")).toBe(false);
  });
});
