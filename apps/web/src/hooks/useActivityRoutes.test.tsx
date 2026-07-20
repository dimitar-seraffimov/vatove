// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ActivityRouteCollection } from "@vatove/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActivityRoutes } from "../api/client";
import { useActivityRoutes } from "./useActivityRoutes";

vi.mock("../api/client", () => ({ getActivityRoutes: vi.fn() }));

const persistedRoutes: ActivityRouteCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-0.1, 51.5],
          [-0.2, 51.6],
        ],
      },
      properties: { activityId: "activity-1" },
    },
  ],
};

describe("useActivityRoutes", () => {
  beforeEach(() => vi.mocked(getActivityRoutes).mockReset());

  it("hydrates routes on mount and retains the last successful data after a failed refresh", async () => {
    vi.mocked(getActivityRoutes).mockResolvedValueOnce(persistedRoutes);
    const { result } = renderHook(() => useActivityRoutes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.routes).toEqual(persistedRoutes);
    expect(getActivityRoutes).toHaveBeenCalledOnce();

    vi.mocked(getActivityRoutes).mockRejectedValueOnce(new Error("temporary route failure"));
    await act(async () => result.current.refresh());

    expect(result.current.routes).toEqual(persistedRoutes);
    expect(result.current.error).toBe("temporary route failure");
  });
});
