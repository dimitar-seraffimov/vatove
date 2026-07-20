import { afterEach, describe, expect, it, vi } from "vitest";
import { getActivityRoutes } from "./client";

describe("API client caching", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("always hydrates persisted routes without the browser HTTP cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
        status: 200,
        headers: { "content-type": "application/geo+json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getActivityRoutes();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/activity-routes",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
