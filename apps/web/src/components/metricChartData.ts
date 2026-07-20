import type { ActivitySample } from "@vatove/contracts";

export interface MetricChartPoint {
  sampleIndex: number;
  x: number;
  value: number;
  color?: string;
}

export interface MetricChartData {
  points: MetricChartPoint[];
  usesDistance: boolean;
}

type MetricValueAccessor = (sample: ActivitySample) => number | null;
type MetricColorAccessor = (sample: ActivitySample) => string | undefined;

interface CandidatePoint {
  sample: ActivitySample;
  position: number;
  value: number;
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Builds a chart series in route order. Distance is used only when every
 * rendered point has it; otherwise positions are used for the complete axis so
 * values from different units are never mixed.
 */
export function buildMetricChartData(
  samples: readonly ActivitySample[],
  valueFor: MetricValueAccessor,
  colorFor?: MetricColorAccessor,
): MetricChartData {
  const candidates: CandidatePoint[] = samples.flatMap((sample, position) => {
    const value = valueFor(sample);
    return isFiniteNumber(value) ? [{ sample, position, value }] : [];
  });
  const usesDistance =
    candidates.length > 0 &&
    candidates.every(({ sample }) => isFiniteNumber(sample.distanceMeters));

  return {
    usesDistance,
    points: candidates.map(({ sample, position, value }) => {
      const color = colorFor?.(sample);
      return {
        sampleIndex: sample.index,
        x: usesDistance ? (sample.distanceMeters as number) : position,
        value,
        ...(color === undefined ? {} : { color }),
      };
    }),
  };
}

export function findNearestMetricPoint(
  points: readonly MetricChartPoint[],
  x: number,
): MetricChartPoint | undefined {
  return points.reduce<MetricChartPoint | undefined>((nearest, point) => {
    if (!nearest) return point;
    return Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest;
  }, undefined);
}

export interface MetricChartSegment {
  points: readonly [MetricChartPoint, MetricChartPoint];
  color: string | undefined;
}

export function buildMetricChartSegments(
  points: readonly MetricChartPoint[],
): MetricChartSegment[] {
  return points.slice(1).map((point, index) => ({
    points: [points[index] as MetricChartPoint, point],
    color: point.color ?? points[index]?.color,
  }));
}
