import { useEffect, useRef } from "react";
import {
  axisBottom,
  axisLeft,
  extent,
  line,
  pointer,
  scaleLinear,
  select,
} from "d3";
import { useTooltip } from "../context/TooltipContext";
import { formatChartDistance } from "../utils/format";
import {
  buildMetricChartSegments,
  findNearestMetricPoint,
  type MetricChartPoint,
} from "./metricChartData";

interface MetricChartProps {
  points: readonly MetricChartPoint[];
  usesDistance: boolean;
  eyebrow: string;
  title: string;
  description: string;
  yPadding: number;
  reverseY?: boolean;
  formatValue: (value: number) => string;
  className: string;
  svgClassName: string;
  lineClassName: string;
  lineShadowClassName: string;
}

function paddedDomain(values: readonly number[], padding: number): [number, number] {
  const [minimum = 0, maximum = 1] = extent(values);
  if (minimum !== maximum) return [minimum, maximum];
  return [minimum - padding, maximum + padding];
}

export function MetricChart({
  points,
  usesDistance,
  eyebrow,
  title,
  description,
  yPadding,
  reverseY = false,
  formatValue,
  className,
  svgClassName,
  lineClassName,
  lineShadowClassName,
}: MetricChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { activeSampleIndex, setActiveSampleIndex } = useTooltip();

  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode || points.length < 2) return;

    const width = 760;
    const height = 220;
    const margin = { top: 18, right: 18, bottom: 34, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const xScale = scaleLinear()
      .domain(paddedDomain(points.map((point) => point.x), 1))
      .range([0, innerWidth]);
    const yScale = scaleLinear()
      .domain(paddedDomain(points.map((point) => point.value), yPadding))
      .nice()
      .range(reverseY ? [0, innerHeight] : [innerHeight, 0]);
    const svg = select(svgNode);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("title").text(description);
    const plot = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const linePath = line<MetricChartPoint>()
      .x((point) => xScale(point.x))
      .y((point) => yScale(point.value));
    plot
      .append("path")
      .datum(points)
      .attr("class", `metric-line-shadow ${lineShadowClassName}`)
      .attr("d", linePath);

    if (points.some((point) => point.color !== undefined)) {
      for (const segment of buildMetricChartSegments(points)) {
        const segmentPath = plot
          .append("path")
          .datum(segment.points)
          .attr("class", `metric-line ${lineClassName}`)
          .attr("d", linePath);
        if (segment.color !== undefined) segmentPath.style("stroke", segment.color);
      }
    } else {
      plot
        .append("path")
        .datum(points)
        .attr("class", `metric-line ${lineClassName}`)
        .attr("d", linePath);
    }

    const xAxis = axisBottom(xScale)
      .ticks(5)
      .tickSizeOuter(0)
      .tickFormat((value) =>
        usesDistance ? formatChartDistance(Number(value)) : String(Math.round(Number(value))),
      );
    const yAxis = axisLeft(yScale)
      .ticks(4)
      .tickSize(-innerWidth)
      .tickSizeOuter(0)
      .tickFormat((value) => formatValue(Number(value)));
    plot
      .append("g")
      .attr("class", "chart-axis chart-axis--x")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(xAxis);
    plot.append("g").attr("class", "chart-axis chart-axis--y").call(yAxis);

    const active = points.find((point) => point.sampleIndex === activeSampleIndex);
    if (active) {
      const activeGroup = plot.append("g").attr("class", "chart-active");
      activeGroup
        .append("line")
        .attr("x1", xScale(active.x))
        .attr("x2", xScale(active.x))
        .attr("y1", 0)
        .attr("y2", innerHeight);
      const activeCircle = activeGroup
        .append("circle")
        .attr("cx", xScale(active.x))
        .attr("cy", yScale(active.value))
        .attr("r", 5);
      if (active.color !== undefined) activeCircle.style("fill", active.color);
      activeGroup
        .append("text")
        .attr("x", Math.min(innerWidth - 60, xScale(active.x) + 8))
        .attr("y", Math.max(14, yScale(active.value) - 9))
        .text(formatValue(active.value));
    }

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
      const nearest = findNearestMetricPoint(points, xScale.invert(position));
      if (nearest) setActiveSampleIndex(nearest.sampleIndex);
    };
    interaction.on("pointerdown", selectNearest).on("pointermove", selectNearest);
  }, [
    activeSampleIndex,
    description,
    formatValue,
    lineClassName,
    lineShadowClassName,
    points,
    reverseY,
    setActiveSampleIndex,
    usesDistance,
    yPadding,
  ]);

  if (points.length < 2) return null;

  return (
    <div className={`metric-chart ${className}`}>
      <div className="chart-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className="chart-hint">Touch or hover to inspect</span>
      </div>
      <svg ref={svgRef} role="img" className={`metric-chart-svg ${svgClassName}`} />
    </div>
  );
}
