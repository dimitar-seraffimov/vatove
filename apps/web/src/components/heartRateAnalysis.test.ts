import { describe, expect, it } from "vitest";
import type { HeartRateZone } from "@vatove/contracts";
import { formatZoneRange, summarizeZoneTiming } from "./heartRateAnalysis";

function zone(index: number, durationSeconds: number | null): HeartRateZone {
  return {
    index,
    label: `Z${index}`,
    color: "#123456",
    minBpm: index === 1 ? null : 120,
    maxBpm: index === 2 ? null : 119,
    durationSeconds,
  };
}

describe("summarizeZoneTiming", () => {
  it("calculates percentages from the available dynamic zone durations", () => {
    const summary = summarizeZoneTiming([zone(1, 120), zone(2, 180)]);
    expect(summary.totalSeconds).toBe(300);
    expect(summary.hasTiming).toBe(true);
    expect(summary.entries.map((entry) => entry.percentage)).toEqual([40, 60]);
  });

  it("keeps missing and invalid durations unavailable", () => {
    const summary = summarizeZoneTiming([zone(1, null), zone(2, -1)]);
    expect(summary.totalSeconds).toBe(0);
    expect(summary.hasTiming).toBe(false);
    expect(summary.entries.map((entry) => entry.percentage)).toEqual([null, null]);
  });
});

describe("formatZoneRange", () => {
  it("formats open and bounded sport-zone ranges", () => {
    expect(formatZoneRange(null, 119)).toBe("≤ 119 bpm");
    expect(formatZoneRange(120, 149)).toBe("120–149 bpm");
    expect(formatZoneRange(150, null)).toBe("≥ 150 bpm");
  });
});
