import { useEffect, useMemo, useRef } from "react";
import type { ActivityDetail, ActivityRouteCollection } from "@vatove/contracts";
import type { Feature, LineString } from "geojson";
import maplibregl, {
  type MapMouseEvent,
  type MapSourceDataEvent,
  type Marker,
} from "maplibre-gl";
import { useTooltip } from "../context/TooltipContext";
import {
  buildHeartRateRoutePresentation,
} from "./heartRateSegments";
import {
  ACTIVE_SOURCE_ID,
  activeSourceContainsActivity,
  ensureActivityMapLayers,
  OVERVIEW_HIT_LAYER_ID,
  setSelectedLoadingHighlight,
  type RouteCollection,
} from "./activityMapLayers";
import { useMap } from "./MapProvider";
import { snapToSampleIndex } from "./snapToRoute";

type RouteFeature = Feature<LineString, { activityId: string }>;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const awaitingActiveSource = Boolean(selectedId && activeRoute.data.features.length > 0);
  const showSelectedLoadingHighlight = Boolean(
    selectedId && (loadingDetail || awaitingActiveSource),
  );
  const selectedOverviewRoute = useMemo(
    () => routeData.features.find((feature) => feature.properties.activityId === selectedId) ?? null,
    [routeData.features, selectedId],
  );

  useEffect(() => {
    if (!map || styleRevision === 0 || !map.isStyleLoaded()) return;
    const hideHighlightWhenCurrentSourceIsReady = () => {
      if (!selectedId || !awaitingActiveSource) return;
      if (!activeSourceContainsActivity(map, selectedId)) return;
      setSelectedLoadingHighlight(map, null);
    };
    const onSourceData = (event: MapSourceDataEvent) => {
      if (
        event.sourceId !== ACTIVE_SOURCE_ID ||
        !event.isSourceLoaded ||
        (event.sourceDataType !== "content" && event.sourceDataType !== "idle")
      ) {
        return;
      }
      hideHighlightWhenCurrentSourceIsReady();
    };
    if (awaitingActiveSource) map.on("sourcedata", onSourceData);
    ensureActivityMapLayers(
      map,
      routeData,
      activeRoute,
      selectedId,
      showSelectedLoadingHighlight,
    );
    hideHighlightWhenCurrentSourceIsReady();
    return () => {
      if (awaitingActiveSource) map.off("sourcedata", onSourceData);
    };
  }, [
    activeRoute,
    awaitingActiveSource,
    map,
    routeData,
    selectedId,
    showSelectedLoadingHighlight,
    styleRevision,
  ]);

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
    if (!map || styleRevision === 0) return;

    const featuresToFit = selectedOverviewRoute 
      ? [selectedOverviewRoute] 
      : routeData.features;
      
    if (featuresToFit.length === 0) return;

    const bounds = routeBounds(featuresToFit);
    if (!bounds) return;

    let animationFrame: number | null = null;
    let transitionTimer: number | null = null;

    const fitSelectedRoute = () => {
      map.fitBounds(bounds, {
        padding: fitPadding(map.getContainer()),
        maxZoom: 15,
        duration: prefersReducedMotion() ? 0 : 500,
      });
    };

    const fitAfterLayout = () => {
      animationFrame = window.requestAnimationFrame(fitSelectedRoute);
    };

    if (!window.matchMedia("(max-width: 999px)").matches) {
      fitAfterLayout();
    } else {
      transitionTimer = window.setTimeout(
        fitAfterLayout,
        prefersReducedMotion() ? 0 : 260,
      );
    }

    return () => {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [map, selectedOverviewRoute, routeData.features, selectionRevision, styleRevision]);

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
    selectedActivity?.route &&
      selectedActivity.hasHeartRate &&
      selectedActivity.heartRateZones.length > 0 &&
      activeRoute.stats.coloredEdges === 0,
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
