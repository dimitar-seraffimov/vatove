import { useMemo } from "react";
import type { ActivitySample, HeartRateZone } from "@vatove/contracts";
import { MetricChart } from "./MetricChart";
import { buildHeartRateChartData } from "./heartRateChartData";

export interface HeartRateChartProps {
  samples: readonly ActivitySample[];
  zones: readonly HeartRateZone[];
}

const formatHeartRate = (value: number) => `${Math.round(value)} bpm`;

export function HeartRateChart({ samples, zones }: HeartRateChartProps) {
  const data = useMemo(() => buildHeartRateChartData(samples, zones), [samples, zones]);

  return (
    <MetricChart
      points={data.points}
      usesDistance={data.usesDistance}
      eyebrow="Cardio trace"
      title="Heart rate"
      description="Heart-rate profile. Move across the chart to inspect the route."
      yPadding={5}
      formatValue={formatHeartRate}
      className="heart-rate-chart"
      svgClassName="heart-rate-svg"
      lineClassName="heart-rate-line"
      lineShadowClassName="heart-rate-line-shadow"
    />
  );
}
