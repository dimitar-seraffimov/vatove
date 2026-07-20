import type { ActivitySample, HeartRateZone } from "@vatove/contracts";

function finiteBoundary(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function containsHeartRate(zone: HeartRateZone, heartRateBpm: number): boolean {
  const minimum = finiteBoundary(zone.minBpm);
  const maximum = finiteBoundary(zone.maxBpm);
  return (minimum === null || heartRateBpm >= minimum) &&
    (maximum === null || heartRateBpm <= maximum);
}

/**
 * Resolves the dynamic sport zone for a sample.
 *
 * New rows normally contain a persisted zone index. Older or partially
 * aligned samples can still be recovered from their BPM and the persisted
 * Intervals.icu zone boundaries. No fallback boundaries are hardcoded.
 */
export function resolveSampleHeartRateZone(
  sample: Pick<ActivitySample, "heartRateBpm" | "heartRateZone">,
  zones: readonly HeartRateZone[],
): HeartRateZone | null {
  const indexed =
    sample.heartRateZone === null
      ? undefined
      : zones.find((zone) => zone.index === sample.heartRateZone);
  if (indexed) return indexed;

  const heartRateBpm = sample.heartRateBpm;
  if (heartRateBpm === null || !Number.isFinite(heartRateBpm) || zones.length === 0) {
    return null;
  }

  const bounded = zones.find((zone) => containsHeartRate(zone, heartRateBpm));
  if (bounded) return bounded;

  // Intervals clamps values outside its outer configured thresholds into the
  // first/last zone. Mirror that behavior for legacy rows without zone indices.
  const ordered = [...zones].sort((left, right) => left.index - right.index);
  const first = ordered[0];
  const last = ordered.at(-1);
  const firstMinimum = first ? finiteBoundary(first.minBpm) : null;
  const lastMaximum = last ? finiteBoundary(last.maxBpm) : null;
  if (first && firstMinimum !== null && heartRateBpm < firstMinimum) return first;
  if (last && lastMaximum !== null && heartRateBpm > lastMaximum) return last;
  return null;
}
