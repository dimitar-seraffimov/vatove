import { useEffect, useRef } from "react";
import {
  axisBottom,
  axisLeft,
  bisector,
  extent,
  line,
  pointer,
  scaleLinear,
  select,
} from "d3";
import type { ActivitySample } from "@vatove/contracts";
import { useTooltip } from "../context/TooltipContext";
import { formatChartDistance } from "../utils/format";

interface ChartPoint {
  sampleIndex: number;
  x: number;
  elevation: number;
}

function paddedDomain(values: readonly number[], padding: number): [number, number] {
  const [minimum = 0, maximum = 1] = extent(values);
  if (minimum !== maximum) return [minimum, maximum];
  return [minimum - padding, maximum + padding];
}

export interface ElevationChartProps {
  samples: readonly ActivitySample[];
}

export function ElevationChart({ samples }: ElevationChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { activeSampleIndex, setActiveSampleIndex } = useTooltip();

  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;
    const distanceAvailable = samples.some(
      (sample) => sample.distanceMeters !== null && Number.isFinite(sample.distanceMeters),
    );
    const points: ChartPoint[] = samples.flatMap((sample, position) => {
      if (sample.elevationMeters === null || !Number.isFinite(sample.elevationMeters)) return [];
      return [
        {
          sampleIndex: sample.index,
          x: distanceAvailable ? (sample.distanceMeters ?? position) : position,
          elevation: sample.elevationMeters,
        },
      ];
    });
    if (points.length < 2) return;

    const width = 760;
    const height = 220;
    const margin = { top: 18, right: 18, bottom: 34, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const xScale = scaleLinear()
      .domain(paddedDomain(points.map((item) => item.x), 1))
      .range([0, innerWidth]);
    const yScale = scaleLinear()
      .domain(paddedDomain(points.map((item) => item.elevation), 10))
      .nice()
      .range([innerHeight, 0]);
    const svg = select(svgNode);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("title").text("Elevation profile. Move across the chart to inspect the route.");
    const plot = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const areaPath = line<ChartPoint>()
      .x((point) => xScale(point.x))
      .y((point) => yScale(point.elevation));
    plot
      .append("path")
      .datum(points)
      .attr("class", "elevation-line-shadow")
      .attr("d", areaPath);
    plot
      .append("path")
      .datum(points)
      .attr("class", "elevation-line")
      .attr("d", areaPath);

    const xAxis = axisBottom(xScale)
      .ticks(5)
      .tickSizeOuter(0)
      .tickFormat((value) =>
        distanceAvailable ? formatChartDistance(Number(value)) : String(Math.round(Number(value))),
      );
    const yAxis = axisLeft(yScale)
      .ticks(4)
      .tickSize(-innerWidth)
      .tickSizeOuter(0)
      .tickFormat((value) => `${Math.round(Number(value))} m`);
    plot
      .append("g")
      .attr("class", "chart-axis chart-axis--x")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis);
    plot.append("g").attr("class", "chart-axis chart-axis--y").call(yAxis);

    const active = points.find((item) => item.sampleIndex === activeSampleIndex);
    if (active) {
      const activeGroup = plot.append("g").attr("class", "chart-active");
      activeGroup
        .append("line")
        .attr("x1", xScale(active.x))
        .attr("x2", xScale(active.x))
        .attr("y1", 0)
        .attr("y2", innerHeight);
      activeGroup
        .append("circle")
        .attr("cx", xScale(active.x))
        .attr("cy", yScale(active.elevation))
        .attr("r", 5);
      activeGroup
        .append("text")
        .attr("x", Math.min(innerWidth - 48, xScale(active.x) + 8))
        .attr("y", Math.max(14, yScale(active.elevation) - 9))
        .text(`${active.elevation.toFixed(0)} m`);
    }

    const findClosest = bisector<ChartPoint, number>((item) => item.x).center;
    const interaction = plot
      .append("rect")
      .attr("class", "chart-interaction")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .attr("tabindex", 0);
    const selectNearest = (event: PointerEvent) => {
      const mouseX = pointer(event, interaction.node() ?? svgNode)[0] ?? 0;
      const position = Math.max(0, Math.min(innerWidth, mouseX));
      const nearest = points[findClosest(points, xScale.invert(position))];
      if (nearest) setActiveSampleIndex(nearest.sampleIndex);
    };
    interaction.on("pointerdown", selectNearest).on("pointermove", selectNearest);
  }, [activeSampleIndex, samples, setActiveSampleIndex]);

  return (
    <div className="elevation-chart">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Terrain trace</span>
          <h3>Elevation</h3>
        </div>
        <span className="chart-hint">Touch or hover to inspect</span>
      </div>
      <svg ref={svgRef} role="img" className="elevation-svg" />
    </div>
  );
}
