// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ActivityDetail,
  ActivityPage,
  ActivityRouteCollection,
  ActivitySummary,
  SyncRun,
} from "@vatove/contracts";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createSyncRun,
  getActivity,
  getActivityRoutes,
  getSyncRun,
  listActivities,
} from "./api/client";
import { TooltipProvider } from "./context/TooltipContext";

vi.mock("./api/client", () => ({
  createSyncRun: vi.fn(),
  getActivity: vi.fn(),
  getActivityRoutes: vi.fn(),
  getSyncRun: vi.fn(),
  listActivities: vi.fn(),
}));

vi.mock("./map/ActivityMap", () => ({
  ActivityMap: ({ routes }: { routes: ActivityRouteCollection }) => (
    <div data-testid="activity-map" data-route-count={routes.features.length} />
  ),
}));

const summaries: ActivitySummary[] = [
  {
    id: "activity-1",
    source: "intervals",
    sourceActivityId: "i1",
    name: "Morning Ride",
    sport: "Ride",
    startAt: "2026-07-20T08:00:00.000Z",
    movingTimeSeconds: 3600,
    distanceMeters: 25_000,
    hasRoute: true,
    hasHeartRate: false,
    hasElevation: false,
  },
  {
    id: "activity-2",
    source: "intervals",
    sourceActivityId: "i2",
    name: "Evening Run",
    sport: "Run",
    startAt: "2026-07-19T18:00:00.000Z",
    movingTimeSeconds: 1800,
    distanceMeters: 5_000,
    hasRoute: true,
    hasHeartRate: false,
    hasElevation: false,
  },
];

const routeCollection: ActivityRouteCollection = {
  type: "FeatureCollection",
  features: summaries.map((summary, index) => ({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [-0.2 + index, 51.5],
        [-0.1 + index, 51.6],
      ],
    },
    properties: { activityId: summary.id },
  })),
};

function detailFor(summary: ActivitySummary): ActivityDetail {
  return {
    ...summary,
    averageHeartRateBpm: null,
    maxHeartRateBpm: null,
    route: routeCollection.features.find(
      (feature) => feature.properties.activityId === summary.id,
    ) ?? null,
    samples: [],
    heartRateZones: [],
  };
}

function syncRun(status: SyncRun["status"]): SyncRun {
  return {
    id: "sync-1",
    status,
    oldest: "2026-05-22",
    newest: "2026-07-20",
    discoveredCount: status === "completed" ? 2 : 0,
    processedCount: status === "completed" ? 2 : 0,
    failedCount: 0,
    error: null,
    createdAt: "2026-07-20T12:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-07-20T12:00:01.000Z",
    completedAt: status === "completed" ? "2026-07-20T12:00:02.000Z" : null,
  };
}

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("application navigation and analysis state", () => {
  beforeEach(() => {
    const page: ActivityPage = { items: summaries, nextCursor: null };
    vi.mocked(listActivities).mockReset().mockResolvedValue(page);
    vi.mocked(getActivityRoutes).mockReset().mockResolvedValue(routeCollection);
    vi.mocked(getActivity)
      .mockReset()
      .mockImplementation(async (id) => detailFor(summaries.find((item) => item.id === id)!));
    vi.mocked(createSyncRun).mockReset().mockResolvedValue(syncRun("queued"));
    vi.mocked(getSyncRun).mockReset().mockResolvedValue(syncRun("completed"));
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("provides real Home destinations and the shared brand returns from Analyse", async () => {
    renderApp();

    expect(screen.getByRole("heading", { name: "Where do you want to go?" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("activity-map").getAttribute("data-route-count")).toBe("2"),
    );
    for (const [label, path] of [
      ["Account", "/account"],
      ["Analyse", "/analyse"],
      ["Plan", "/plan"],
      ["Settings", "/settings"],
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`) }).getAttribute("href")).toBe(path);
    }

    fireEvent.click(screen.getByRole("link", { name: /^Analyse/ }));
    expect(await screen.findByRole("heading", { name: "Recent efforts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Go to the vatove home page" }));
    expect(await screen.findByRole("heading", { name: "Where do you want to go?" })).toBeTruthy();
  });

  it.each([
    ["/account", "Account"],
    ["/plan", "Plan"],
    ["/settings", "Settings"],
  ])("renders the direct placeholder route %s", (path, heading) => {
    renderApp(path);
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Analyse" }).getAttribute("href")).toBe("/analyse");
  });

  it("redirects unknown routes to Home", async () => {
    renderApp("/not-a-page");
    expect(await screen.findByRole("heading", { name: "Where do you want to go?" })).toBeTruthy();
  });

  it("expands details, minimises explicitly, and collapses when another activity is selected", async () => {
    renderApp("/analyse");
    fireEvent.click(await screen.findByRole("button", { name: /Morning Ride/ }));
    expect(await screen.findByRole("heading", { name: "Morning Ride" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Minimise" }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Evening Run/ }));
    expect(await screen.findByRole("heading", { name: "Evening Run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand" }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimise" }));
    expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
  });

  it("shares prefetched detail requests and reuses completed selections", async () => {
    renderApp("/analyse");
    const firstActivity = await screen.findByRole("button", { name: /Morning Ride/ });

    fireEvent.pointerEnter(firstActivity);
    fireEvent.click(firstActivity);
    expect(await screen.findByRole("heading", { name: "Morning Ride" })).toBeTruthy();
    expect(vi.mocked(getActivity).mock.calls.filter(([id]) => id === "activity-1")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Evening Run/ }));
    expect(await screen.findByRole("heading", { name: "Evening Run" })).toBeTruthy();
    fireEvent.click(firstActivity);
    expect(await screen.findByRole("heading", { name: "Morning Ride" })).toBeTruthy();
    expect(vi.mocked(getActivity).mock.calls.filter(([id]) => id === "activity-1")).toHaveLength(1);
  });

  it("renders pace immediately above speed when motion samples are available", async () => {
    vi.mocked(getActivity).mockImplementation(async (id) => {
      const summary = summaries.find((item) => item.id === id)!;
      return {
        ...detailFor(summary),
        sport: "Run",
        samples: [0, 1, 2].map((index) => ({
          index,
          sourceIndex: index,
          longitude: -0.2 + index / 100,
          latitude: 51.5 + index / 100,
          elapsedSeconds: index * 30,
          distanceMeters: index * 100,
          elevationMeters: null,
          speedMetersPerSecond: 3.3,
          heartRateBpm: null,
          heartRateZone: null,
        })),
      };
    });
    renderApp("/analyse");
    fireEvent.click(await screen.findByRole("button", { name: /Morning Ride/ }));

    const pace = await screen.findByRole("heading", { name: "Pace" });
    const speed = screen.getByRole("heading", { name: "Speed" });
    expect(pace.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dismisses the completed sync notice after three seconds", async () => {
    vi.useFakeTimers();
    renderApp("/analyse");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync latest 60 days" }));
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(900));

    expect(screen.getByText("Sync complete · 2 processed")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2_999));
    expect(screen.getByText("Sync complete · 2 processed")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.queryByText("Sync complete · 2 processed")).toBeNull();
  });
});
