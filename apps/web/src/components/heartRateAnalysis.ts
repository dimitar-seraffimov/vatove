import type { HeartRateZone } from "@vatove/contracts";

export interface ZoneTiming {
  zone: HeartRateZone;
  seconds: number | null;
  percentage: number | null;
}

export function summarizeZoneTiming(zones: readonly HeartRateZone[]): {
  totalSeconds: number;
  hasTiming: boolean;
  entries: ZoneTiming[];
} {
  const durations = zones.map((zone) => {
    const duration = zone.durationSeconds;
    return duration !== null && Number.isFinite(duration) && duration >= 0 ? duration : null;
  });
  const totalSeconds = durations.reduce<number>((total, duration) => total + (duration ?? 0), 0);
  const hasTiming = durations.some((duration) => duration !== null);
  return {
    totalSeconds,
    hasTiming,
    entries: zones.map((zone, index) => {
      const seconds = durations[index] ?? null;
      return {
        zone,
        seconds,
        percentage: seconds !== null && totalSeconds > 0 ? (seconds / totalSeconds) * 100 : null,
      };
    }),
  };
}

export function formatZoneRange(minimum: number | null, maximum: number | null): string {
  if (minimum === null && maximum === null) return "Range unavailable";
  if (minimum === null) return `≤ ${maximum} bpm`;
  if (maximum === null) return `≥ ${minimum} bpm`;
  return `${minimum}–${maximum} bpm`;
}
