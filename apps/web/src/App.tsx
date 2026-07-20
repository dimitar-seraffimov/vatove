import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActivityDetail, SyncRun } from "@vatove/contracts";
import { createSyncRun, getActivity, getSyncRun } from "./api/client";
import { ActivityDetails } from "./components/ActivityDetails";
import { ActivityList } from "./components/ActivityList";
import { ElevationChart } from "./components/ElevationChart";
import { useTooltip } from "./context/TooltipContext";
import { useActivityFeed } from "./hooks/useActivityFeed";
import { useActivityRoutes } from "./hooks/useActivityRoutes";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { ActivityMap } from "./map/ActivityMap";

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function syncLabel(syncRun: SyncRun | null): string {
  if (!syncRun) return "Sync latest 60 days";
  if (syncRun.status === "queued") return "Sync queued…";
  if (syncRun.status === "running") {
    const total = Math.max(syncRun.discoveredCount, syncRun.processedCount);
    return total > 0 ? `Syncing ${syncRun.processedCount}/${total}…` : "Syncing…";
  }
  return "Sync latest 60 days";
}

export default function App() {
  const feed = useActivityFeed();
  const routeFeed = useActivityRoutes();
  const online = useOnlineStatus();
  const { setActiveSampleIndex } = useTooltip();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (
      selectedId &&
      !feed.loading &&
      !feed.activities.some((activity) => activity.id === selectedId)
    ) {
      setSelectedId(null);
      setMobileDetailOpen(false);
    }
  }, [feed.activities, feed.loading, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    void getActivity(selectedId, controller.signal)
      .then(setDetail)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(messageFrom(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  const syncing = syncRun?.status === "queued" || syncRun?.status === "running";
  const syncRunId = syncRun?.id;
  const syncRunStatus = syncRun?.status;
  const refreshActivities = feed.refresh;
  const refreshRoutes = routeFeed.refresh;
  useEffect(() => {
    if (!syncRunId || (syncRunStatus !== "queued" && syncRunStatus !== "running")) return;
    const controller = new AbortController();
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await getSyncRun(syncRunId, controller.signal);
        setSyncRun(next);
        if (next.status === "queued" || next.status === "running") {
          timer = window.setTimeout(() => void poll(), 1_250);
        } else if (next.status === "completed") {
          await Promise.all([refreshActivities(), refreshRoutes()]);
        }
      } catch (error) {
        if (!controller.signal.aborted) setSyncError(messageFrom(error));
      }
    };
    timer = window.setTimeout(() => void poll(), 900);
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refreshActivities, refreshRoutes, syncRunId, syncRunStatus]);

  const startSync = useCallback(async () => {
    setSyncError(null);
    try {
      setSyncRun(await createSyncRun());
    } catch (error) {
      setSyncError(messageFrom(error));
    }
  }, []);

  const chooseActivity = useCallback(
    (id: string) => {
      setActiveSampleIndex(null);
      setSelectedId(id);
      setSelectionRevision((revision) => revision + 1);
      setMobileDetailOpen(true);
    },
    [setActiveSampleIndex],
  );

  const visibleDetail = detail?.id === selectedId ? detail : null;
  const hasElevationProfile = useMemo(
    () =>
      (visibleDetail?.samples.filter(
        (sample) => sample.elevationMeters !== null && Number.isFinite(sample.elevationMeters),
      ).length ?? 0) >= 2,
    [visibleDetail],
  );

  return (
    <div className={`app-shell${mobileDetailOpen ? " is-mobile-detail-open" : ""}`}>
      <ActivityMap
        activity={visibleDetail}
        routes={routeFeed.routes}
        selectedId={selectedId}
        selectionRevision={selectionRevision}
        loadingDetail={detailLoading}
        loadingRoutes={routeFeed.loading}
        routesError={routeFeed.error}
        onSelectActivity={chooseActivity}
      />

      <div className="floating-messages" aria-live="polite">
        {(syncError || syncRun?.status === "failed") && (
          <div className="global-alert" role="alert">
            <strong>Sync failed.</strong>{" "}
            {syncError ?? syncRun?.error ?? "Check the worker logs and try again."}
          </div>
        )}
        {syncRun?.status === "completed" && !syncError && (
          <div className="sync-complete" role="status">
            Sync complete · {syncRun.processedCount} processed
            {syncRun.failedCount > 0 ? ` · ${syncRun.failedCount} failed` : ""}
          </div>
        )}
      </div>

      <aside className="left-overlay" data-map-overlay aria-label="Activity explorer">
        <header className="panel-header">
          <a className="brand" href="/" aria-label="vatove home">
            <span className="brand-mark" aria-hidden="true">
              <i />
            </span>
            <span>
              <strong>vatove</strong>
              <small>Activity explorer</small>
            </span>
          </a>
          <span className={`network-status${online ? "" : " is-offline"}`}>
            <i aria-hidden="true" />
            {online ? "Local stack" : "Offline"}
          </span>
        </header>

        <button
          type="button"
          className="sync-button"
          disabled={syncing || !online}
          onClick={() => void startSync()}
        >
          <span className={syncing ? "sync-icon is-spinning" : "sync-icon"} aria-hidden="true">
            ↻
          </span>
          {syncLabel(syncRun)}
        </button>

        <ActivityList
          activities={feed.activities}
          selectedId={selectedId}
          selectionRevision={selectionRevision}
          loading={feed.loading}
          error={feed.error}
          onSelect={chooseActivity}
          onRetry={() => void feed.refresh()}
        />
      </aside>

      {selectedId && (
        <aside
          className={`detail-overlay${mobileDetailOpen ? " is-mobile-open" : ""}`}
          data-map-overlay
          aria-label="Selected activity"
        >
          <button
            type="button"
            className="mobile-back"
            onClick={() => setMobileDetailOpen(false)}
          >
            <span aria-hidden="true">←</span> Back to activities
          </button>

          {detailLoading && (
            <div className="detail-loading" role="status">
              Loading activity details…
            </div>
          )}
          {detailError && (
            <div className="detail-error" role="alert">
              <strong>Activity details could not be loaded.</strong>
              <span>{detailError}</span>
            </div>
          )}
          {visibleDetail && <ActivityDetails activity={visibleDetail} />}
          {visibleDetail && hasElevationProfile && <ElevationChart samples={visibleDetail.samples} />}
          {visibleDetail && !visibleDetail.hasHeartRate && (
            <p className="data-note">
              No heart-rate stream was recorded; the selected route uses a neutral colour.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
