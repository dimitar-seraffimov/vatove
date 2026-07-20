export const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export const INITIAL_MAP_VIEW = {
  center: [0, 20] as [number, number],
  zoom: Math.log2(1.4),
  pitch: 0,
  bearing: 0,
} as const;

export const GLOBE_PROJECTION = { type: "globe" } as const;
