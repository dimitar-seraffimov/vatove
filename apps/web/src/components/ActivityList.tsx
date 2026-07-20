import { useEffect, useRef } from "react";
import type { ActivitySummary } from "@vatove/contracts";
import { formatActivityDate, formatDistance, formatDuration } from "../utils/format";

export interface ActivityListProps {
  activities: readonly ActivitySummary[];
  selectedId: string | null;
  selectionRevision: number;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onPrefetch?: (id: string) => void;
  onRetry: () => void;
}

function SportMark({ sport }: { sport: string }) {
  const label = sport.trim() || "Activity";
  return (
    <span className="sport-mark" aria-hidden="true">
      {label.slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

function ActivitySkeleton() {
  return (
    <div className="activity-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ActivityList({
  activities,
  selectedId,
  selectionRevision,
  loading,
  error,
  onSelect,
  onPrefetch,
  onRetry,
}: ActivityListProps) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [selectedId, selectionRevision]);

  return (
    <section className="activity-panel" aria-label="Activities">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Intervals.icu</span>
          <h2>Recent efforts</h2>
        </div>
        {!loading && <span className="count-badge">{activities.length}</span>}
      </div>

      {error && (
        <div className="inline-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={onRetry}>Retry</button>
        </div>
      )}

      <div className="activity-list" aria-busy={loading}>
        {loading && activities.length === 0 && (
          <>
            <ActivitySkeleton />
            <ActivitySkeleton />
            <ActivitySkeleton />
          </>
        )}
        {!loading && activities.length === 0 && !error && (
          <div className="empty-list">
            <strong>No activities yet.</strong>
            <span>Sync your latest 60 days to begin exploring.</span>
          </div>
        )}
        {activities.map((activity) => (
          <button
            type="button"
            key={activity.id}
            ref={(node) => {
              if (node) rowRefs.current.set(activity.id, node);
              else rowRefs.current.delete(activity.id);
            }}
            className={`activity-row${selectedId === activity.id ? " is-selected" : ""}`}
            aria-current={selectedId === activity.id ? "true" : undefined}
            onClick={() => onSelect(activity.id)}
            onFocus={() => onPrefetch?.(activity.id)}
            onPointerEnter={() => onPrefetch?.(activity.id)}
          >
            <SportMark sport={activity.sport} />
            <span className="activity-copy">
              <strong>{activity.name}</strong>
              <span>{formatActivityDate(activity.startAt)}</span>
              <span className="activity-metrics">
                <span>{formatDistance(activity.distanceMeters)}</span>
                <i aria-hidden="true" />
                <span>{formatDuration(activity.movingTimeSeconds)}</span>
              </span>
            </span>
            <span className="route-availability" title={activity.hasRoute ? "GPS route available" : "No GPS route"}>
              {activity.hasRoute ? "↗" : "—"}
            </span>
          </button>
        ))}
      </div>

      {loading && activities.length > 0 && (
        <div className="feed-progress" role="status">
          Loading the complete 60-day window…
        </div>
      )}
    </section>
  );
}
