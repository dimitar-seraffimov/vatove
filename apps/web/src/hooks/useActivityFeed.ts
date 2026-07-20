import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivitySummary } from "@vatove/contracts";
import { listActivities } from "../api/client";

interface ActivityFeedState {
  activities: ActivitySummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Activities could not be loaded.";
}

export function useActivityFeed(): ActivityFeedState {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
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
      const allActivities: ActivitySummary[] = [];
      const knownIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await listActivities({
          ...(cursor ? { cursor } : {}),
          limit: 100,
          signal: controller.signal,
        });
        for (const activity of page.items) {
          if (!knownIds.has(activity.id)) {
            knownIds.add(activity.id);
            allActivities.push(activity);
          }
        }
        setActivities([...allActivities]);
        if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (!controller.signal.aborted);
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

  return { activities, loading, error, refresh };
}
