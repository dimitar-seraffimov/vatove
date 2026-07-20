import type { Feature, FeatureCollection, LineString } from "geojson";
import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import {
  NEUTRAL_ROUTE_COLOR,
  type HeartRateRoutePresentation,
} from "./heartRateSegments";

export const OVERVIEW_SOURCE_ID = "activity-route-overview";
export const OVERVIEW_LAYER_ID = "activity-route-overview-line";
export const OVERVIEW_SELECTED_LAYER_ID = "activity-route-selected-line";
export const OVERVIEW_HIT_LAYER_ID = "activity-route-hit-target";
export const ACTIVE_SOURCE_ID = "active-activity-route";
export const ACTIVE_LAYER_ID = "active-activity-route-line";

export type RouteFeature = Feature<LineString, { activityId: string }>;
export type RouteCollection = FeatureCollection<LineString, { activityId: string }>;

export function activityFilter(activityId: string | null): FilterSpecification {
  return ["==", ["get", "activityId"], activityId ?? ""];
}

export function setSelectedLoadingHighlight(
  map: MapLibreMap,
  activityId: string | null,
): void {
  if (!map.getLayer(OVERVIEW_SELECTED_LAYER_ID)) return;
  map.setFilter(OVERVIEW_SELECTED_LAYER_ID, activityFilter(activityId));
}

export function activeSourceContainsActivity(
  map: MapLibreMap,
  activityId: string,
): boolean {
  if (!map.getSource(ACTIVE_SOURCE_ID)) return false;
  try {
    return map
      .querySourceFeatures(ACTIVE_SOURCE_ID)
      .some((feature) => feature.properties?.activityId === activityId);
  } catch {
    // The source exists synchronously but its worker tiles may not be ready yet.
    return false;
  }
}

/**
 * Installs or refreshes all application-owned map sources and layers.
 *
 * The selected route deliberately updates only its GeoJSON source. Its colour
 * is carried by feature properties, keeping geometry and styling in the same
 * worker update and avoiding the line-gradient/line-progress race.
 */
export function ensureActivityMapLayers(
  map: MapLibreMap,
  routes: RouteCollection,
  activeRoute: HeartRateRoutePresentation,
  selectedId: string | null,
  showSelectedLoadingHighlight: boolean,
): void {
  if (!map.isStyleLoaded()) return;

  const overviewSource = map.getSource(OVERVIEW_SOURCE_ID) as GeoJSONSource | undefined;
  if (overviewSource) overviewSource.setData(routes);
  else map.addSource(OVERVIEW_SOURCE_ID, { type: "geojson", data: routes });

  if (!map.getLayer(OVERVIEW_LAYER_ID)) {
    map.addLayer({
      id: OVERVIEW_LAYER_ID,
      type: "line",
      source: OVERVIEW_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#71817c",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.25, 12, 2.5, 18, 4],
        "line-opacity": 0.48,
      },
    });
  }

  const loadingSelection = showSelectedLoadingHighlight ? selectedId : null;
  if (!map.getLayer(OVERVIEW_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: OVERVIEW_SELECTED_LAYER_ID,
      type: "line",
      source: OVERVIEW_SOURCE_ID,
      filter: activityFilter(loadingSelection),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": NEUTRAL_ROUTE_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 12, 7, 18, 11],
        "line-opacity": 0.82,
        "line-blur": 0.2,
      },
    });
  } else {
    setSelectedLoadingHighlight(map, loadingSelection);
  }

  if (!map.getLayer(OVERVIEW_HIT_LAYER_ID)) {
    map.addLayer({
      id: OVERVIEW_HIT_LAYER_ID,
      type: "line",
      source: OVERVIEW_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(0, 0, 0, 0)", "line-width": 18 },
    });
  }

  const activeSource = map.getSource(ACTIVE_SOURCE_ID) as GeoJSONSource | undefined;
    if (activeSource) activeSource.setData(activeRoute.data);
    else {
      map.addSource(ACTIVE_SOURCE_ID, {
        type: "geojson",
        data: activeRoute.data,
      });
    }

  const activeLayerPaint = {
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 12, 8, 18, 13],
      "line-opacity": 0.98,
      "line-color": ["coalesce", ["get", "color"], NEUTRAL_ROUTE_COLOR],
    } as const;

    // --- ADDED LOG ---
    console.log(JSON.stringify({
      diagnostic: "MAPLIBRE_PAINT_EXPRESSION",
      paint: activeLayerPaint
    }, null, 2));
    // -----------------

    if (!map.getLayer(ACTIVE_LAYER_ID)) {
      map.addLayer({
        id: ACTIVE_LAYER_ID,
        type: "line",
        source: ACTIVE_SOURCE_ID,
        filter: activityFilter(selectedId),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: activeLayerPaint as any,
      });
    } else {
      map.setFilter(ACTIVE_LAYER_ID, activityFilter(selectedId));
    }
}