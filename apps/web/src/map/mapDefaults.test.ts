import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE_URL, GLOBE_PROJECTION, INITIAL_MAP_VIEW } from "./mapDefaults";

describe("initial map presentation", () => {
  it("starts on the complete dark globe instead of fitting activity routes", () => {
    expect(DEFAULT_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(INITIAL_MAP_VIEW.center).toEqual([0, 20]);
    expect(INITIAL_MAP_VIEW.zoom).toBeCloseTo(Math.log2(1.4));
    expect(INITIAL_MAP_VIEW.pitch).toBe(0);
    expect(INITIAL_MAP_VIEW.bearing).toBe(0);
    expect(GLOBE_PROJECTION).toEqual({ type: "globe" });
  });
});
