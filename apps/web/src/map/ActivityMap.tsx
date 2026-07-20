import { useEffect, useRef } from "react";
import type { ActivityDetail } from "@vatove/contracts";
import type { FeatureCollection, LineString } from "geojson";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type Marker,
} from "maplibre-gl";
import { useTooltip } from "../context/TooltipContext";
import { buildHeartRateGradient } from "./heartRateGradient";
import { useMap } from "./MapProvider";
import { snapToSampleIndex } from "./snapToRoute";

const ROUTE_SOURCE_ID = "active-activity-route";
const ROUTE_LAYER_ID = "active-activity-route-line";

const EMPTY_ROUTE: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [],
};

function ensureRouteLayer(map: MapLibreMap, activity: ActivityDetail | null): void {
  const routeData = activity?.route ?? EMPTY_ROUTE;
  const gradient = buildHeartRateGradient(
    activity?.samples ?? [],
    activity?.heartRateZones ?? [],
  );
  const existingSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(routeData);
  } else {
    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: routeData,
      lineMetrics: true,
    });
  }

  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 12, 7, 18, 12],
        "line-opacity": 0.96,
        "line-gradient": gradient,
      },
    });
  } else {
    map.setPaintProperty(ROUTE_LAYER_ID, "line-gradient", gradient);
  }
}

function fitRoute(map: MapLibreMap, activity: ActivityDetail): void {
  const coordinates = activity.route?.geometry.coordinates;
  if (!coordinates || coordinates.length < 2) return;
  const first = coordinates[0];
  if (!first) return;
  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(first, first),
  );
  map.fitBounds(bounds, {
    padding: { top: 72, right: 52, bottom: 72, left: 52 },
    maxZoom: 15,
    duration: 700,
  });
}

export interface ActivityMapProps {
  activity: ActivityDetail | null;
  loading?: boolean;
}

export function ActivityMap({ activity, loading = false }: ActivityMapProps) {
  const { map, containerRef, contextLost, initializationError } = useMap();
  const { activeSampleIndex, setActiveSampleIndex } = useTooltip();
  const markerRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    let eventsAttached = false;
    const onRouteClick = (event: MapLayerMouseEvent) => {
      if (!activity?.route) return;
      const index = snapToSampleIndex(
        activity.route.geometry.coordinates,
        activity.samples,
        [event.lngLat.lng, event.lngLat.lat],
      );
      setActiveSampleIndex(index);
    };
    const onRouteEnter = () => {
      map.getCanvas().style.cursor = "crosshair";
    };
    const onRouteLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    const applyActivity = () => {
      ensureRouteLayer(map, activity);
      map.on("click", ROUTE_LAYER_ID, onRouteClick);
      map.on("mouseenter", ROUTE_LAYER_ID, onRouteEnter);
      map.on("mouseleave", ROUTE_LAYER_ID, onRouteLeave);
      eventsAttached = true;
      if (activity) fitRoute(map, activity);
    };

    if (map.isStyleLoaded()) applyActivity();
    else map.once("load", applyActivity);

    return () => {
      map.off("load", applyActivity);
      if (eventsAttached) {
        map.off("click", ROUTE_LAYER_ID, onRouteClick);
        map.off("mouseenter", ROUTE_LAYER_ID, onRouteEnter);
        map.off("mouseleave", ROUTE_LAYER_ID, onRouteLeave);
      }
    };
  }, [activity, map, setActiveSampleIndex]);

  useEffect(() => {
    if (!map) return;
    const sample = activity?.samples.find((item) => item.index === activeSampleIndex);
    if (!sample || !Number.isFinite(sample.longitude) || !Number.isFinite(sample.latitude)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const markerElement = document.createElement("div");
      markerElement.className = "route-marker";
      markerElement.setAttribute("aria-hidden", "true");
      markerRef.current = new maplibregl.Marker({ element: markerElement }).setLngLat([
        sample.longitude,
        sample.latitude,
      ]).addTo(map);
    } else {
      markerRef.current.setLngLat([sample.longitude, sample.latitude]);
    }
  }, [activeSampleIndex, activity, map]);

  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    [],
  );

  const noRoute = !loading && activity !== null && !activity.route;
  const noSelection = !loading && activity === null;

  return (
    <div className="map-shell" aria-label="Activity route map">
      <div ref={containerRef} className="map-canvas" />
      {loading && <div className="map-overlay map-overlay--quiet">Loading route…</div>}
      {noSelection && (
        <div className="map-overlay">
          <span className="eyebrow">Your terrain awaits</span>
          <strong>Select an activity to inspect its route.</strong>
        </div>
      )}
      {noRoute && (
        <div className="map-overlay">
          <span className="eyebrow">List-only activity</span>
          <strong>This activity has fewer than two valid GPS points.</strong>
        </div>
      )}
      {contextLost && (
        <div className="map-overlay map-overlay--error">
          The graphics context was interrupted. The map will redraw when it recovers.
        </div>
      )}
      {initializationError && (
        <div className="map-overlay map-overlay--error">{initializationError}</div>
      )}
    </div>
  );
}
