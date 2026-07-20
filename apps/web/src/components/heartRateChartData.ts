import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import { buildMetricChartData, type MetricChartData } from "./metricChartData";

export const HEART_RATE_CHART_NEUTRAL_COLOR = "#9ba8a3";

export function buildHeartRateChartData(
  samples: readonly ActivitySample[],
  zones: readonly HeartRateZone[],
): MetricChartData {
  const zonesByIndex = new Map(zones.map((zone) => [zone.index, zone]));
  return buildMetricChartData(
    samples,
    (sample) => sample.heartRateBpm,
    (sample) => {
      if (sample.heartRateZone === null) return HEART_RATE_CHART_NEUTRAL_COLOR;
      const color = zonesByIndex.get(sample.heartRateZone)?.color.trim();
      return color || HEART_RATE_CHART_NEUTRAL_COLOR;
    },
  );
}
