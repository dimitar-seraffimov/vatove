import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import { resolveSampleHeartRateZone } from "../utils/heartRateZones";
import { buildMetricChartData, type MetricChartData } from "./metricChartData";

export const HEART_RATE_CHART_NEUTRAL_COLOR = "#9ba8a3";

export function buildHeartRateChartData(
  samples: readonly ActivitySample[],
  zones: readonly HeartRateZone[],
): MetricChartData {
  return buildMetricChartData(
    samples,
    (sample) => sample.heartRateBpm,
    (sample) => {
      const color = resolveSampleHeartRateZone(sample, zones)?.color.trim();
      return color || HEART_RATE_CHART_NEUTRAL_COLOR;
    },
  );
}
