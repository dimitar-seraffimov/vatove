import type { ActivitySample } from "@vatove/contracts";
import type { MetricChartData, MetricChartPoint } from "./metricChartData";

export type MotionMetric = "pace" | "speed";

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Converts Intervals' persisted `velocity_smooth` stream into display pace or
 * speed. Invalid and stationary samples are omitted instead of creating
 * spikes or infinite pace values.
 */
export function buildMotionChartData(
  samples: readonly ActivitySample[],
  metric: MotionMetric,
  paceDistanceMeters = 1_000,
): MetricChartData {
  const validSamples = samples.filter(
    (sample) =>
      finite(sample.speedMetersPerSecond) &&
      sample.speedMetersPerSecond > 0 &&
      finite(sample.distanceMeters),
  );
  const points: MetricChartPoint[] = validSamples.map((sample) => ({
    sampleIndex: sample.index,
    x: sample.distanceMeters as number,
    value:
      metric === "pace"
        ? paceDistanceMeters / (sample.speedMetersPerSecond as number)
        : (sample.speedMetersPerSecond as number) * 3.6,
  }));

  return { points, usesDistance: true };
}
