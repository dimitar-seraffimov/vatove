import type { HeartRateZone } from "@vatove/contracts";
import { describe, expect, it } from "vitest";
import {
  normalizeHeartRateZoneIndex,
  resolveSampleHeartRateZone,
} from "./heartRateZones";

const zones: HeartRateZone[] = [
  { index: 1, label: "Easy", color: "#1", minBpm: null, maxBpm: 130, durationSeconds: null },
  { index: 2, label: "Tempo", color: "#2", minBpm: 131, maxBpm: 160, durationSeconds: null },
  { index: 3, label: "Hard", color: "#3", minBpm: 161, maxBpm: 180, durationSeconds: null },
];

describe("resolveSampleHeartRateZone", () => {
  it("uses the persisted zone index when it is valid", () => {
    expect(resolveSampleHeartRateZone({ heartRateBpm: 150, heartRateZone: 1 }, zones)?.index).toBe(1);
  });

  it("normalizes integer-like zone indices from runtime JSON", () => {
    const runtimeZones = zones.map((zone) => ({
      ...zone,
      index: String(zone.index),
    })) as unknown as HeartRateZone[];
    const runtimeSample = {
      heartRateBpm: null,
      heartRateZone: "2",
    } as unknown as Parameters<typeof resolveSampleHeartRateZone>[0];

    expect(normalizeHeartRateZoneIndex("2")).toBe(2);
    expect(resolveSampleHeartRateZone(runtimeSample, runtimeZones)?.index).toBe("2");
  });

  it("recovers a missing or unmatched index from dynamic BPM boundaries", () => {
    expect(resolveSampleHeartRateZone({ heartRateBpm: 150, heartRateZone: null }, zones)?.index).toBe(2);
    expect(resolveSampleHeartRateZone({ heartRateBpm: 170, heartRateZone: 99 }, zones)?.index).toBe(3);
  });

  it("mirrors Intervals clamping above the last configured threshold", () => {
    expect(resolveSampleHeartRateZone({ heartRateBpm: 195, heartRateZone: null }, zones)?.index).toBe(3);
  });

  it("does not invent zones when BPM or dynamic settings are unavailable", () => {
    expect(resolveSampleHeartRateZone({ heartRateBpm: null, heartRateZone: null }, zones)).toBeNull();
    expect(resolveSampleHeartRateZone({ heartRateBpm: 150, heartRateZone: null }, [])).toBeNull();
  });
});
