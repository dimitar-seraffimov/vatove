import { useMemo } from "react";
import type { ActivitySample } from "@vatove/contracts";
import { MetricChart } from "./MetricChart";
import { buildMotionChartData } from "./motionChartData";

export interface PaceChartProps {
  samples: readonly ActivitySample[];
}

function formatPace(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
}

export function PaceChart({ samples }: PaceChartProps) {
  const data = useMemo(() => buildMotionChartData(samples, "pace"), [samples]);

  return (
    <MetricChart
      points={data.points}
      usesDistance={data.usesDistance}
      eyebrow="Motion trace"
      title="Pace"
      description="Pace profile derived from distance and elapsed time. Move across the chart to inspect the route."
      yPadding={10}
      reverseY
      formatValue={formatPace}
      className="pace-chart"
      svgClassName="pace-svg"
      lineClassName="pace-line"
      lineShadowClassName="pace-line-shadow"
    />
  );
}
