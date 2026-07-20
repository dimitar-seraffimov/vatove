import { useMemo } from "react";
import type { ActivitySample } from "@vatove/contracts";
import { MetricChart } from "./MetricChart";
import { buildMotionChartData } from "./motionChartData";

export interface SpeedChartProps {
  samples: readonly ActivitySample[];
}

const formatSpeed = (value: number) => `${value.toFixed(1)} km/h`;

export function SpeedChart({ samples }: SpeedChartProps) {
  const data = useMemo(() => buildMotionChartData(samples, "speed"), [samples]);

  return (
    <MetricChart
      points={data.points}
      usesDistance={data.usesDistance}
      eyebrow="Motion trace"
      title="Speed"
      description="Speed profile from the Intervals speed stream. Move across the chart to inspect the route."
      yPadding={1}
      formatValue={formatSpeed}
      className="speed-chart"
      svgClassName="speed-svg"
      lineClassName="speed-line"
      lineShadowClassName="speed-line-shadow"
    />
  );
}
