import { describe, expect, it } from "vitest";

import {
  calendarDateInTimeZone,
  isCalendarDate,
  resolveSyncDateRange,
} from "./dates.js";

describe("sync date ranges", () => {
  it("defaults to the inclusive 30 calendar days ending today", () => {
    expect(
      resolveSyncDateRange({}, new Date("2026-07-20T12:00:00.000Z"), "Europe/London"),
    ).toEqual({ oldest: "2026-06-21", newest: "2026-07-20" });
  });

  it("uses the configured timezone's calendar day", () => {
    const instant = new Date("2026-07-20T23:30:00.000Z");
    expect(calendarDateInTimeZone(instant, "Europe/London")).toBe("2026-07-21");
    expect(calendarDateInTimeZone(instant, "America/Los_Angeles")).toBe("2026-07-20");
  });

  it("rejects dates that match the shape but do not exist", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(() =>
      resolveSyncDateRange(
        { oldest: "2026-02-29", newest: "2026-03-01" },
        new Date("2026-07-20T12:00:00.000Z"),
        "Europe/London",
      ),
    ).toThrow("Dates must be valid");
  });
});
