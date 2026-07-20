import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityDetail, SyncRun } from "@vatove/contracts";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createSyncRun, getActivity, getSyncRun } from "./api/client";
import { ActivityDetails } from "./components/ActivityDetails";
import { ActivityList } from "./components/ActivityList";
import { BrandLink } from "./components/BrandLink";
import { ElevationChart } from "./components/ElevationChart";
import { HeartRateChart } from "./components/HeartRateChart";
import { HomePanel } from "./components/HomePanel";
import { PaceChart } from "./components/PaceChart";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { SpeedChart } from "./components/SpeedChart";
import { useTooltip } from "./context/TooltipContext";
import { useActivityFeed } from "./hooks/useActivityFeed";
import { useActivityRoutes } from "./hooks/useActivityRoutes";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { ActivityMap } from "./map/ActivityMap";

const COMPLETION_NOTICE_MS = 3_000;
const PANEL_TRANSITION_MS = 260;

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

function pageTitle(pathname: string): string {
  const label =
    pathname === "/analyse"
      ? "Analyse"
      : pathname === "/account"
        ? "Account"
        : pathname === "/plan"
          ? "Plan"
          : pathname === "/settings"
            ? "Settings"
            : "Home";
  return `vatove · ${label}`;
}

export default function App() {
  const location = useLocation();
  const analysing = location.pathname === "/analyse";
  const feed = useActivityFeed();
  const routeFeed = useActivityRoutes();
  const online = useOnlineStatus();
  const { setActiveSampleIndex } = useTooltip();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState<SyncRun | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  const detailCacheRef = useRef(new Map<string, ActivityDetail>());
  const detailRequestsRef = useRef(new Map<string, Promise<ActivityDetail>>());

  const loadActivityDetail = useCallback((id: string): Promise<ActivityDetail> => {
    const cached = detailCacheRef.current.get(id);
    if (cached) return Promise.resolve(cached);

    const pending = detailRequestsRef.current.get(id);
    if (pending) return pending;

    const request = getActivity(id).then(
      (activity) => {
        detailCacheRef.current.set(id, activity);
        detailRequestsRef.current.delete(id);
        return activity;
      },
      (error: unknown) => {
        detailRequestsRef.current.delete(id);
        throw error;
      },
    );
    detailRequestsRef.current.set(id, request);
    return request;
  }, []);

  const prefetchActivity = useCallback(
    (id: string) => {
      void loadActivityDetail(id).catch(() => undefined);
    },
    [loadActivityDetail],
  );

  useEffect(() => {
    document.title = pageTitle(location.pathname);
  }, [location.pathname]);

  useEffect(
    () => () => {
      if (fitTimerRef.current !== null) window.clearTimeout(fitTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (
      selectedId &&
      !feed.loading &&
      !feed.activities.some((activity) => activity.id === selectedId)
    ) {
      setSelectedId(null);
      setMobileDetailOpen(false);
      setDetailsExpanded(false);
    }
  }, [feed.activities, feed.loading, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    const cached = detailCacheRef.current.get(selectedId) ?? null;
    setDetail(cached);
    setDetailLoading(cached === null);
    setDetailError(null);
    void loadActivityDetail(selectedId)
      .then((activity) => {
        if (active) setDetail(activity);
      })
      .catch((error: unknown) => {
        if (active) setDetailError(messageFrom(error));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadActivityDetail, selectedId]);

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

  useEffect(() => {
    if (syncRun?.status !== "completed" || syncError) return;
    const completedId = syncRun.id;
    const timer = window.setTimeout(() => {
      setSyncRun((current) =>
        current?.id === completedId && current.status === "completed" ? null : current,
      );
    }, COMPLETION_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [syncError, syncRun]);

  const startSync = useCallback(async () => {
    setSyncError(null);
    try {
      setSyncRun(await createSyncRun());
    } catch (error) {
      setSyncError(messageFrom(error));
    }
  }, []);

  const reviseSelection = useCallback((delay = 0) => {
    if (fitTimerRef.current !== null) window.clearTimeout(fitTimerRef.current);
    if (delay === 0) {
      fitTimerRef.current = null;
      setSelectionRevision((revision) => revision + 1);
      return;
    }
    fitTimerRef.current = window.setTimeout(() => {
      fitTimerRef.current = null;
      setSelectionRevision((revision) => revision + 1);
    }, delay);
  }, []);

  const chooseActivity = useCallback(
    (id: string) => {
      const selectingDifferent = id !== selectedId;
      const waitForPanel = selectingDifferent && detailsExpanded;
      setActiveSampleIndex(null);
      if (selectingDifferent) setDetailsExpanded(false);
      setSelectedId(id);
      reviseSelection(waitForPanel ? PANEL_TRANSITION_MS : 0);
      setMobileDetailOpen(true);
    },
    [detailsExpanded, reviseSelection, selectedId, setActiveSampleIndex],
  );

  const minimiseDetails = useCallback(() => {
    setDetailsExpanded(false);
    reviseSelection(PANEL_TRANSITION_MS);
  }, [reviseSelection]);

  const toggleDetailsExpanded = useCallback(() => {
    if (detailsExpanded) minimiseDetails();
    else setDetailsExpanded(true);
  }, [detailsExpanded, minimiseDetails]);

  const returnToActivities = useCallback(() => {
    setMobileDetailOpen(false);
    if (detailsExpanded) minimiseDetails();
  }, [detailsExpanded, minimiseDetails]);

  const visibleDetail = detail?.id === selectedId ? detail : null;
  const hasElevationProfile = useMemo(
    () =>
      (visibleDetail?.samples.filter(
        (sample) => sample.elevationMeters !== null && Number.isFinite(sample.elevationMeters),
      ).length ?? 0) >= 2,
    [visibleDetail],
  );
  const hasHeartRateProfile = useMemo(
    () =>
      (visibleDetail?.samples.filter(
        (sample) => sample.heartRateBpm !== null && Number.isFinite(sample.heartRateBpm),
      ).length ?? 0) >= 2,
    [visibleDetail],
  );

  return (
    <div
      className={`app-shell${mobileDetailOpen && analysing ? " is-mobile-detail-open" : ""}${detailsExpanded && analysing ? " is-detail-expanded" : ""}`}
    >
      <ActivityMap
        activity={analysing ? visibleDetail : null}
        routes={routeFeed.routes}
        selectedId={analysing ? selectedId : null}
        selectionRevision={selectionRevision}
        loadingDetail={analysing && detailLoading}
        loadingRoutes={routeFeed.loading}
        routesError={routeFeed.error}
        routesInteractive={analysing}
        onRetryRoutes={() => void routeFeed.refresh()}
        onSelectActivity={(id) => {
          if (analysing) chooseActivity(id);
        }}
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

      <Routes>
        <Route path="/" element={<HomePanel />} />
        <Route
          path="/analyse"
          element={
            <aside className="left-overlay" data-map-overlay aria-label="Activity explorer">
              <header className="panel-header">
                <BrandLink />
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
                onPrefetch={prefetchActivity}
                onRetry={() => void feed.refresh()}
              />
            </aside>
          }
        />
        <Route
          path="/account"
          element={
            <PlaceholderPage
              title="Account"
              description="Athlete identity, connected services, and profile controls will live here."
            />
          }
        />
        <Route
          path="/plan"
          element={
            <PlaceholderPage
              title="Plan"
              description="Future sessions, training blocks, and recovery planning are on the roadmap."
            />
          }
        />
        <Route
          path="/settings"
          element={
            <PlaceholderPage
              title="Settings"
              description="Application, map, and data-source preferences will be configured here."
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {analysing && selectedId && (
        <aside
          className={`detail-overlay${mobileDetailOpen ? " is-mobile-open" : ""}${detailsExpanded ? " is-expanded" : ""}`}
          data-map-overlay
          aria-label="Selected activity"
        >
          <button type="button" className="mobile-back" onClick={returnToActivities}>
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
          {visibleDetail && (
            <ActivityDetails
              activity={visibleDetail}
              expanded={detailsExpanded}
              onToggleExpanded={toggleDetailsExpanded}
            />
          )}
          {visibleDetail && <PaceChart samples={visibleDetail.samples} />}
          {visibleDetail && <SpeedChart samples={visibleDetail.samples} />}
          {visibleDetail && hasElevationProfile && <ElevationChart samples={visibleDetail.samples} />}
          {visibleDetail && hasHeartRateProfile && (
            <HeartRateChart
              samples={visibleDetail.samples}
              zones={visibleDetail.heartRateZones}
            />
          )}
          {visibleDetail && !visibleDetail.hasHeartRate && (
            <p className="data-note">
              No heart-rate stream was recorded; the selected route uses a neutral colour.
            </p>
          )}
          {visibleDetail?.hasHeartRate && visibleDetail.heartRateZones.length === 0 && (
            <p className="data-note">
              No dynamic heart-rate zones were available for this sport; the selected route uses
              a neutral colour.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
