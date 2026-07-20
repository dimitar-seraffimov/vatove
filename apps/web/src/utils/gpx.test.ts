import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "@vatove/contracts";
import { serializeActivityToGpx } from "./gpx";

function activity(): ActivityDetail {
  return {
    id: "activity-1",
    source: "intervals",
    sourceActivityId: "i123",
    name: "Hill & Dale <tempo>",
    sport: "Run",
    startAt: "2026-07-20T08:00:00.000Z",
    movingTimeSeconds: 600,
    distanceMeters: 2_000,
    hasRoute: true,
    hasHeartRate: true,
    hasElevation: true,
    averageHeartRateBpm: 145,
    maxHeartRateBpm: 162,
    route: {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[-1.123456789, 52.987654321]] },
      properties: { activityId: "activity-1" },
    },
    samples: [
      {
        index: 0,
        sourceIndex: 5,
        longitude: -1.123456789,
        latitude: 52.987654321,
        elapsedSeconds: 5.5,
        distanceMeters: 0,
        elevationMeters: 123.45678,
        heartRateBpm: 145,
        heartRateZone: 2,
      },
    ],
    heartRateZones: [],
  };
}

describe("serializeActivityToGpx", () => {
  it("escapes XML and caps coordinate and elevation precision", () => {
    const gpx = serializeActivityToGpx(activity());
    expect(gpx).toContain("Hill &amp; Dale &lt;tempo&gt;");
    expect(gpx).toContain('lat="52.9876543" lon="-1.1234568"');
    expect(gpx).toContain("<ele>123.457</ele>");
    expect(gpx).toContain("<time>2026-07-20T08:00:05.500Z</time>");
  });

  it("can omit derived track timestamps", () => {
    const gpx = serializeActivityToGpx(activity(), { includeTimestamps: false });
    const trackPoint = gpx.match(/<trkpt[\s\S]*?<\/trkpt>/)?.[0];
    expect(trackPoint).not.toContain("<time>");
  });
});
