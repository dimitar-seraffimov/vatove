import { useMemo } from "react";
import type { ActivitySample } from "@vatove/contracts";
import { MetricChart } from "./MetricChart";
import { buildMetricChartData } from "./metricChartData";

export interface ElevationChartProps {
  samples: readonly ActivitySample[];
}

const formatElevation = (value: number) => `${Math.round(value)} m`;

export function ElevationChart({ samples }: ElevationChartProps) {
  const data = useMemo(
    () => buildMetricChartData(samples, (sample) => sample.elevationMeters),
    [samples],
  );

  return (
    <MetricChart
      points={data.points}
      usesDistance={data.usesDistance}
      eyebrow="Terrain trace"
      title="Elevation"
      description="Elevation profile. Move across the chart to inspect the route."
      yPadding={10}
      formatValue={formatElevation}
      className="elevation-chart"
      svgClassName="elevation-svg"
      lineClassName="elevation-line"
      lineShadowClassName="elevation-line-shadow"
    />
  );
}
