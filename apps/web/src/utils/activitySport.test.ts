import { describe, expect, it } from "vitest";
import { paceDistanceForSport } from "./activitySport";

describe("paceDistanceForSport", () => {
  it.each(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "IndoorCycling"])(
    "does not show pace for cycling sport %s",
    (sport) => expect(paceDistanceForSport(sport)).toBeNull(),
  );

  it.each(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"])(
    "uses minutes per kilometre for %s",
    (sport) => expect(paceDistanceForSport(sport)).toBe(1_000),
  );

  it.each(["Swim", "OpenWaterSwim", "PoolSwim"])(
    "uses minutes per 100 metres for %s",
    (sport) => expect(paceDistanceForSport(sport)).toBe(100),
  );
});
