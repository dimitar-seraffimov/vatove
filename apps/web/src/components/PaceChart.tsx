import { useMemo } from "react";
import type { ActivitySample } from "@vatove/contracts";
import { paceDistanceForSport, type PaceDistance } from "../utils/activitySport";
import { MetricChart } from "./MetricChart";
import { buildMotionChartData } from "./motionChartData";

export interface PaceChartProps {
  samples: readonly ActivitySample[];
  sport: string;
}

function formatPace(value: number, distance: PaceDistance): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} /${distance === 100 ? "100m" : "km"}`;
}

export function PaceChart({ samples, sport }: PaceChartProps) {
  const paceDistance = paceDistanceForSport(sport);
  const data = useMemo(
    () => buildMotionChartData(samples, "pace", paceDistance ?? 1_000),
    [paceDistance, samples],
  );
  const formatValue = useMemo(
    () => (value: number) => formatPace(value, paceDistance ?? 1_000),
    [paceDistance],
  );

  if (paceDistance === null) return null;

  return (
    <MetricChart
      points={data.points}
      usesDistance={data.usesDistance}
      eyebrow="Motion trace"
      title="Pace"
      description="Pace profile from the Intervals speed stream. Move across the chart to inspect the route."
      yPadding={10}
      reverseY
      formatValue={formatValue}
      className="pace-chart"
      svgClassName="pace-svg"
      lineClassName="pace-line"
      lineShadowClassName="pace-line-shadow"
    />
  );
}
