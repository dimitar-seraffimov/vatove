import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityPage, ActivitySummary } from "@vatove/contracts";
import { listActivities } from "../api/client";

interface ActivityFeedState {
  activities: ActivitySummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Activities could not be loaded.";
}

export function useActivityFeed(): ActivityFeedState {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await listActivities({ signal: controller.signal });
      setActivities(page.items);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page: ActivityPage = await listActivities({ cursor: nextCursor });
      setActivities((current) => {
        const known = new Set(current.map((activity) => activity.id));
        return [...current, ...page.items.filter((activity) => !known.has(activity.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  return { activities, loading, loadingMore, error, nextCursor, refresh, loadMore };
}
