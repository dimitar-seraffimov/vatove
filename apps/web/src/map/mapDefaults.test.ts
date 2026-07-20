import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE_URL, GLOBE_PROJECTION, INITIAL_MAP_VIEW } from "./mapDefaults";

describe("initial map presentation", () => {
  it("starts on the complete dark globe instead of fitting activity routes", () => {
    expect(DEFAULT_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(INITIAL_MAP_VIEW).toEqual({
      center: [0, 20],
      zoom: 0,
      pitch: 0,
      bearing: 0,
    });
    expect(GLOBE_PROJECTION).toEqual({ type: "globe" });
  });
});
