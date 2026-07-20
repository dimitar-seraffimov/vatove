import type { ActivitySummary } from "@vatove/contracts";
import { formatActivityDate, formatDistance, formatDuration } from "../utils/format";

export interface ActivityListProps {
  activities: readonly ActivitySummary[];
  selectedId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
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
  loading,
  loadingMore,
  hasMore,
  error,
  onSelect,
  onLoadMore,
  onRetry,
}: ActivityListProps) {
  return (
    <aside className="activity-panel" aria-label="Activities">
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
            <span>Sync your latest 30 days to begin exploring.</span>
          </div>
        )}
        {activities.map((activity) => (
          <button
            type="button"
            key={activity.id}
            className={`activity-row${selectedId === activity.id ? " is-selected" : ""}`}
            aria-current={selectedId === activity.id ? "true" : undefined}
            onClick={() => onSelect(activity.id)}
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

      {hasMore && (
        <button
          type="button"
          className="load-more"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading…" : "Load older activities"}
        </button>
      )}
    </aside>
  );
}
