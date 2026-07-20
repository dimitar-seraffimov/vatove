import {
  createContext,
  type PropsWithChildren,
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

interface MapContextValue {
  map: MapLibreMap | null;
  containerRef: RefCallback<HTMLDivElement>;
  contextLost: boolean;
  initializationError: string | null;
  requestResize: () => void;
}

const MapContext = createContext<MapContextValue | null>(null);
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function MapProvider({ children }: PropsWithChildren) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const containerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setContainer(node);
  }, []);

  const requestResize = useCallback(() => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      mapRef.current?.resize();
      resizeFrameRef.current = null;
    });
  }, []);

  useEffect(() => {
    if (!container || mapRef.current) return;

    let instance: MapLibreMap;
    try {
      instance = new maplibregl.Map({
        container,
        style: import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_STYLE_URL,
        center: [-2.5, 54.5],
        zoom: 4.25,
        pitch: 28,
        bearing: 0,
        attributionControl: false,
        cooperativeGestures: true,
      });
      instance.setProjection({ type: "globe" });
      instance.addControl(
        new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
        "top-right",
      );
      instance.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right",
      );
    } catch (error) {
      setInitializationError(
        error instanceof Error ? error.message : "The WebGL map could not be initialized.",
      );
      return;
    }

    mapRef.current = instance;
    setMap(instance);
    const canvas = instance.getCanvas();
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
      instance.resize();
      instance.triggerRepaint();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    const resizeObserver = new ResizeObserver(requestResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", requestResize, { passive: true });
    window.addEventListener("orientationchange", requestResize, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", requestResize);
      window.removeEventListener("orientationchange", requestResize);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, [container, requestResize]);

  const value = useMemo(
    () => ({ map, containerRef, contextLost, initializationError, requestResize }),
    [map, containerRef, contextLost, initializationError, requestResize],
  );
  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

// This module intentionally exports the provider and its paired hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useMap(): MapContextValue {
  const context = useContext(MapContext);
  if (!context) throw new Error("useMap must be used inside MapProvider");
  return context;
}
