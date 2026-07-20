import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration } from "./format";

describe("display formatters", () => {
  it("formats short and long distances", () => {
    expect(formatDistance(842)).toBe("842 m");
    expect(formatDistance(5_260)).toBe("5.26 km");
    expect(formatDistance(42_195)).toBe("42.2 km");
  });

  it("formats durations without wrapping past an hour", () => {
    expect(formatDuration(3599)).toBe("59m 59s");
    expect(formatDuration(3661)).toBe("1h 01m");
  });
});
