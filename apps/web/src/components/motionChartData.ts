import type { ActivitySample } from "@vatove/contracts";
import type { MetricChartData, MetricChartPoint } from "./metricChartData";

export type MotionMetric = "pace" | "speed";

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Derives segment pace/speed from the persisted distance and elapsed-time
 * streams. Invalid, stationary, reversed, and zero-duration intervals are
 * omitted instead of creating spikes or infinite pace values.
 */
export function buildMotionChartData(
  samples: readonly ActivitySample[],
  metric: MotionMetric,
): MetricChartData {
  const points: MetricChartPoint[] = [];
  let previous: ActivitySample | null = null;

  for (const sample of samples) {
    if (!finite(sample.distanceMeters) || !finite(sample.elapsedSeconds)) {
      previous = null;
      continue;
    }

    if (
      previous &&
      finite(previous.distanceMeters) &&
      finite(previous.elapsedSeconds)
    ) {
      const distanceDelta = sample.distanceMeters - previous.distanceMeters;
      const timeDelta = sample.elapsedSeconds - previous.elapsedSeconds;
      if (distanceDelta > 0 && timeDelta > 0) {
        points.push({
          sampleIndex: sample.index,
          x: sample.distanceMeters,
          value:
            metric === "pace"
              ? (timeDelta / distanceDelta) * 1_000
              : (distanceDelta / timeDelta) * 3.6,
        });
      }
    }

    previous = sample;
  }

  return { points, usesDistance: true };
}
