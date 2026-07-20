import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityRouteCollection } from "@vatove/contracts";
import { getActivityRoutes } from "../api/client";

const EMPTY_ROUTES: ActivityRouteCollection = {
  type: "FeatureCollection",
  features: [],
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Activity routes could not be loaded.";
}

export function useActivityRoutes() {
  const [routes, setRoutes] = useState<ActivityRouteCollection>(EMPTY_ROUTES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      setRoutes(await getActivityRoutes({ signal: controller.signal }));
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  return { routes, loading, error, refresh };
}
