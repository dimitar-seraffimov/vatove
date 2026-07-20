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
import type { ErrorEvent as MapLibreErrorEvent } from "maplibre-gl";
import { DEFAULT_STYLE_URL, GLOBE_PROJECTION, INITIAL_MAP_VIEW } from "./mapDefaults";

interface MapContextValue {
  map: MapLibreMap | null;
  styleRevision: number;
  containerRef: RefCallback<HTMLDivElement>;
  contextLost: boolean;
  initializationError: string | null;
  requestResize: () => void;
}

const MapContext = createContext<MapContextValue | null>(null);

export function MapProvider({ children }: PropsWithChildren) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styleRevision, setStyleRevision] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const previousSize = useRef({ width: 0, height: 0 });

  const containerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
    setContainer(node);
  }, []);

  const requestResize = useCallback(() => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      const currentMap = mapRef.current;
      const currentContainer = currentMap?.getContainer();
      
      if (currentMap && currentContainer) {
        const { clientWidth, clientHeight } = currentContainer;
        if (
          clientWidth !== previousSize.current.width ||
          clientHeight !== previousSize.current.height
        ) {
          previousSize.current = { width: clientWidth, height: clientHeight };
          currentMap.resize();
        }
      }
      resizeFrameRef.current = null;
    });
  }, []);

  useEffect(() => {
    if (!container || mapRef.current) return;

    let instance: MapLibreMap | null = null;
    try {
      previousSize.current = { width: container.clientWidth, height: container.clientHeight };
      instance = new maplibregl.Map({
        container,
        style: import.meta.env.VITE_MAP_STYLE_URL || DEFAULT_STYLE_URL,
        ...INITIAL_MAP_VIEW,
        attributionControl: false,
      });
      instance.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right",
      );
    } catch (error) {
      instance?.remove();
      setInitializationError(
        error instanceof Error ? error.message : "The WebGL map could not be initialized.",
      );
      return;
    }

    mapRef.current = instance;
    setMap(instance);
    setStyleRevision(0);
    setInitializationError(null);
    let styleHasLoaded = false;
    
    const applyGlobeProjection = () => {
      instance!.setProjection(GLOBE_PROJECTION);
      setStyleRevision((current) => current + 1);
    };
    
    const handleStyleLoad = () => {
      styleHasLoaded = true;
      try {
        applyGlobeProjection();
        setInitializationError(null);
      } catch (error) {
        setInitializationError(
          error instanceof Error ? error.message : "The globe projection could not be initialized.",
        );
      }
    };
    
    const handleMapError = (event: MapLibreErrorEvent) => {
      if (styleHasLoaded) return;
      setInitializationError(`The map style could not be loaded. ${event.error.message}`);
    };
    
    instance.on("style.load", handleStyleLoad);
    instance.on("error", handleMapError);
    if (instance.isStyleLoaded()) handleStyleLoad();

    const canvas = instance.getCanvas();
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    
    const handleContextRestored = () => {
      setContextLost(false);
      instance!.resize();
      if (instance!.isStyleLoaded()) {
        try {
          applyGlobeProjection();
          setInitializationError(null);
        } catch (error) {
          setInitializationError(
            error instanceof Error ? error.message : "The globe projection could not be restored.",
          );
        }
      }
      instance!.triggerRepaint();
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
      instance!.off("style.load", handleStyleLoad);
      instance!.off("error", handleMapError);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      instance!.remove();
      mapRef.current = null;
      setMap(null);
      setStyleRevision(0);
    };
  }, [container, requestResize]);

  const value = useMemo(
    () => ({ map, styleRevision, containerRef, contextLost, initializationError, requestResize }),
    [map, styleRevision, containerRef, contextLost, initializationError, requestResize],
  );
  
  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMap(): MapContextValue {
  const context = useContext(MapContext);
  if (!context) throw new Error("useMap must be used inside MapProvider");
  return context;
}