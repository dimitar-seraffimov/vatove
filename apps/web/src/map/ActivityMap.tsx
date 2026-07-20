import { useEffect, useMemo, useRef } from "react";
import type { ActivityDetail, ActivityRouteCollection } from "@vatove/contracts";
import type { Feature, FeatureCollection, LineString } from "geojson";
import maplibregl, {
  type FilterSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type Marker,
} from "maplibre-gl";
import { useTooltip } from "../context/TooltipContext";
import {
  buildHeartRateRoutePresentation,
  NEUTRAL_ROUTE_COLOR,
  type HeartRateRoutePresentation,
} from "./heartRateGradient";
import { useMap } from "./MapProvider";
import { snapToSampleIndex } from "./snapToRoute";

const OVERVIEW_SOURCE_ID = "activity-route-overview";
const OVERVIEW_LAYER_ID = "activity-route-overview-line";
const OVERVIEW_SELECTED_LAYER_ID = "activity-route-selected-line";
const OVERVIEW_HIT_LAYER_ID = "activity-route-hit-target";
const ACTIVE_SOURCE_ID = "active-activity-route";
const ACTIVE_LAYER_ID = "active-activity-route-line";

type RouteFeature = Feature<LineString, { activityId: string }>;
type RouteCollection = FeatureCollection<LineString, { activityId: string }>;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function selectedFilter(selectedId: string | null): FilterSpecification {
  return ["==", ["get", "activityId"], selectedId ?? ""];
}

function visibleOverlay(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
}

interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function fitPadding(container: HTMLElement): FitPadding {
  const mapRect = container.getBoundingClientRect();
  const padding: FitPadding = { top: 52, right: 52, bottom: 52, left: 52 };
  const overlays = document.querySelectorAll<HTMLElement>("[data-map-overlay]");

  for (const overlay of overlays) {
    if (!visibleOverlay(overlay)) continue;
    const rect = overlay.getBoundingClientRect();
    const overlapsHorizontally = rect.right > mapRect.left && rect.left < mapRect.right;
    const overlapsVertically = rect.bottom > mapRect.top && rect.top < mapRect.bottom;
    if (!overlapsHorizontally || !overlapsVertically) continue;

    const isBottomSheet = rect.width >= mapRect.width * 0.7 && rect.top >= mapRect.top + mapRect.height * 0.28;
    if (isBottomSheet) {
      padding.bottom = Math.max(padding.bottom, mapRect.bottom - rect.top + 24);
    } else if (rect.left <= mapRect.left + 28 && rect.right < mapRect.left + mapRect.width * 0.65) {
      padding.left = Math.max(padding.left, rect.right - mapRect.left + 24);
    } else if (rect.right >= mapRect.right - 28 && rect.left > mapRect.left + mapRect.width * 0.35) {
      padding.right = Math.max(padding.right, mapRect.right - rect.left + 24);
    }
  }

  const horizontalLimit = Math.max(52, mapRect.width - 140);
  if (padding.left + padding.right > horizontalLimit) {
    const scale = horizontalLimit / (padding.left + padding.right);
    padding.left *= scale;
    padding.right *= scale;
  }
  const verticalLimit = Math.max(52, mapRect.height - 140);
  if (padding.top + padding.bottom > verticalLimit) {
    const scale = verticalLimit / (padding.top + padding.bottom);
    padding.top *= scale;
    padding.bottom *= scale;
  }
  return padding;
}

function routeBounds(features: readonly RouteFeature[]): maplibregl.LngLatBounds | null {
  let first: [number, number] | null = null;
  for (const feature of features) {
    for (const coordinate of feature.geometry.coordinates) {
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (typeof longitude === "number" && typeof latitude === "number" && Number.isFinite(longitude) && Number.isFinite(latitude)) {
        first = [longitude, latitude];
        break;
      }
    }
    if (first) break;
  }
  if (!first) return null;
  const bounds = new maplibregl.LngLatBounds(first, first);
  for (const feature of features) {
    for (const coordinate of feature.geometry.coordinates) {
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (typeof longitude === "number" && typeof latitude === "number" && Number.isFinite(longitude) && Number.isFinite(latitude)) {
        bounds.extend([longitude, latitude]);
      }
    }
  }
  return bounds;
}

function ensureSourcesAndLayers(
  map: MapLibreMap,
  routes: RouteCollection,
  activeRoute: HeartRateRoutePresentation,
  selectedId: string | null,
): void {
  if (!map.isStyleLoaded()) return;

  const overviewSource = map.getSource(OVERVIEW_SOURCE_ID) as GeoJSONSource | undefined;
  if (overviewSource) overviewSource.setData(routes);
  else {
    map.addSource(OVERVIEW_SOURCE_ID, { type: "geojson", data: routes });
  }

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
  if (!map.getLayer(OVERVIEW_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: OVERVIEW_SELECTED_LAYER_ID,
      type: "line",
      source: OVERVIEW_SOURCE_ID,
      filter: selectedFilter(selectedId),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": NEUTRAL_ROUTE_COLOR,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 12, 7, 18, 11],
        "line-opacity": 0.82,
        "line-blur": 0.2,
      },
    });
  } else {
    map.setFilter(OVERVIEW_SELECTED_LAYER_ID, selectedFilter(selectedId));
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
      lineMetrics: true,
    });
  }

  if (!map.getLayer(ACTIVE_LAYER_ID)) {
    map.addLayer({
      id: ACTIVE_LAYER_ID,
      type: "line",
      source: ACTIVE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 12, 8, 18, 13],
        "line-opacity": 0.98,
        "line-gradient": activeRoute.gradient,
      },
    });
  } else {
    map.setPaintProperty(ACTIVE_LAYER_ID, "line-gradient", activeRoute.gradient);
  }
  // Style reloads and rapid source updates can otherwise leave the neutral
  // overview above the HR route. Reassert the active layer as the final layer.
  map.moveLayer(ACTIVE_LAYER_ID);
  map.triggerRepaint();
}

export interface ActivityMapProps {
  activity: ActivityDetail | null;
  routes: ActivityRouteCollection;
  selectedId: string | null;
  selectionRevision: number;
  loadingDetail?: boolean;
  loadingRoutes?: boolean;
  routesError?: string | null;
  routesInteractive?: boolean;
  onRetryRoutes?: () => void;
  onSelectActivity: (id: string) => void;
}

export function ActivityMap({
  activity,
  routes,
  selectedId,
  selectionRevision,
  loadingDetail = false,
  loadingRoutes = false,
  routesError = null,
  routesInteractive = true,
  onRetryRoutes,
  onSelectActivity,
}: ActivityMapProps) {
  const { map, styleRevision, containerRef, contextLost, initializationError } = useMap();
  const { activeSampleIndex, setActiveSampleIndex } = useTooltip();
  const markerRef = useRef<Marker | null>(null);
  const routeData = routes as RouteCollection;
  const selectedActivity = activity?.id === selectedId ? activity : null;
  const activeRoute = useMemo(
    () => buildHeartRateRoutePresentation(selectedActivity),
    [selectedActivity],
  );
  const selectedOverviewRoute = useMemo(
    () => routeData.features.find((feature) => feature.properties.activityId === selectedId) ?? null,
    [routeData.features, selectedId],
  );

  useEffect(() => {
    if (!map || styleRevision === 0 || !map.isStyleLoaded()) return;
    ensureSourcesAndLayers(map, routeData, activeRoute, selectedId);
  }, [activeRoute, map, routeData, selectedId, styleRevision]);

  useEffect(() => {
    if (!map || styleRevision === 0) return;
    const onMapClick = (event: MapMouseEvent) => {
      if (!routesInteractive) return;
      if (!map.getLayer(OVERVIEW_HIT_LAYER_ID)) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [OVERVIEW_HIT_LAYER_ID] })[0];
      const activityId = feature?.properties?.activityId;
      if (typeof activityId !== "string" || activityId.length === 0) return;
      onSelectActivity(activityId);
      if (activityId === selectedActivity?.id && selectedActivity.route) {
        setActiveSampleIndex(
          snapToSampleIndex(
            selectedActivity.route.geometry.coordinates,
            selectedActivity.samples,
            [event.lngLat.lng, event.lngLat.lat],
          ),
        );
      }
    };
    const onMapMove = (event: MapMouseEvent) => {
      if (!routesInteractive) {
        map.getCanvas().style.cursor = "";
        return;
      }
      if (!map.getLayer(OVERVIEW_HIT_LAYER_ID)) return;
      const hoveringRoute = map.queryRenderedFeatures(event.point, {
        layers: [OVERVIEW_HIT_LAYER_ID],
      }).length > 0;
      map.getCanvas().style.cursor = hoveringRoute ? "pointer" : "";
    };
    const clearCursor = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("click", onMapClick);
    map.on("mousemove", onMapMove);
    map.on("mouseout", clearCursor);
    return () => {
      map.off("click", onMapClick);
      map.off("mousemove", onMapMove);
      map.off("mouseout", clearCursor);
      clearCursor();
    };
  }, [
    map,
    onSelectActivity,
    routesInteractive,
    selectedActivity,
    setActiveSampleIndex,
    styleRevision,
  ]);

  useEffect(() => {
    if (!map || styleRevision === 0 || !selectedId || !selectedOverviewRoute) return;
    const bounds = routeBounds([selectedOverviewRoute]);
    if (!bounds) return;
    const fitSelectedRoute = () => {
      map.fitBounds(bounds, {
        padding: fitPadding(map.getContainer()),
        maxZoom: 15,
        duration: prefersReducedMotion() ? 0 : 500,
      });
    };
    if (!window.matchMedia("(max-width: 999px)").matches) {
      fitSelectedRoute();
      return;
    }
    const timer = window.setTimeout(fitSelectedRoute, prefersReducedMotion() ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [map, selectedId, selectedOverviewRoute, selectionRevision, styleRevision]);

  useEffect(() => {
    if (!map || styleRevision === 0) return;
    const sample = selectedActivity?.samples.find((item) => item.index === activeSampleIndex);
    if (!sample || !Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const markerElement = document.createElement("div");
      markerElement.className = "route-marker";
      markerElement.setAttribute("aria-hidden", "true");
      markerRef.current = new maplibregl.Marker({ element: markerElement })
        .setLngLat([sample.longitude, sample.latitude])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([sample.longitude, sample.latitude]);
    }
  }, [activeSampleIndex, map, selectedActivity, styleRevision]);

  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    [],
  );

  const mapLoading = styleRevision === 0 && initializationError === null;
  const noRoutes = !loadingRoutes && !routesError && routeData.features.length === 0;
  const noSelectedRoute = Boolean(
    selectedId && !loadingDetail && selectedActivity && !selectedActivity.route,
  );
  const unmatchedHeartRateRoute = Boolean(
    selectedActivity?.route && selectedActivity.hasHeartRate && !activeRoute.hasZoneColors,
  );
  const controlsDisabled = map === null || styleRevision === 0;

  return (
    <div className="map-shell" aria-label="Activity route map">
      <div ref={containerRef} className="map-canvas" />

      <div className="map-zoom-control" role="group" aria-label="Map zoom controls">
        <button
          type="button"
          aria-label="Zoom in"
          disabled={controlsDisabled}
          onClick={() => map?.zoomIn({ duration: prefersReducedMotion() ? 0 : 250 })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={controlsDisabled}
          onClick={() => map?.zoomOut({ duration: prefersReducedMotion() ? 0 : 250 })}
        >
          −
        </button>
      </div>

      {(mapLoading || loadingRoutes) && (
        <div className="map-status" role="status">
          {mapLoading ? "Loading map…" : "Loading 60-day routes…"}
        </div>
      )}
      {!mapLoading && !loadingRoutes && selectedId && loadingDetail && (
        <div className="map-status" role="status">
          Loading heart-rate route…
        </div>
      )}
      {routesError && (
        <div className="map-status map-status--error" role="alert">
          <span>Routes unavailable · {routesError}</span>
          {onRetryRoutes && (
            <button type="button" onClick={onRetryRoutes}>
              Retry routes
            </button>
          )}
        </div>
      )}
      {noRoutes && (
        <div className="map-status">No GPS routes found in the latest 60 days.</div>
      )}
      {noSelectedRoute && (
        <div className="map-status">No GPS route was recorded for this activity.</div>
      )}
      {unmatchedHeartRateRoute && (
        <div className="map-status map-status--error" role="alert">
          Heart-rate samples loaded, but no route zones could be matched.
        </div>
      )}
      {contextLost && (
        <div className="map-status map-status--error" role="alert">
          The graphics context was interrupted. The map will redraw when it recovers.
        </div>
      )}
      {initializationError && (
        <div className="map-overlay map-overlay--error">{initializationError}</div>
      )}
    </div>
  );
}
