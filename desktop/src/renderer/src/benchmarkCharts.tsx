import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveChartColors } from "./chartColors";
import { latencyBins } from "./perfHistogram";

const CHART_HEIGHT = 212;
const MARGIN = { top: 24, right: 12, bottom: 44, left: 52 };

function useHostWidth(hostRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [hostRef]);
  return width;
}

function styleAxis(
  selection: d3.Selection<SVGElement, unknown, null, undefined>,
  colors: ReturnType<typeof resolveChartColors>,
) {
  selection.selectAll(".domain, .tick line").attr("stroke", colors.border);
  selection
    .selectAll(".tick text")
    .attr("fill", colors.muted)
    .attr("font-size", 10)
    .attr("font-family", '"Segoe UI", "Microsoft YaHei UI", sans-serif');
}

export function formatStatusLabel(code: string): string {
  const n = Number.parseInt(code, 10);
  if (n >= 200 && n < 300) return "成功";
  if (n >= 400 && n < 500) return "客户端错误";
  if (n >= 500) return "服务端错误";
  if (n >= 300 && n < 400) return "重定向";
  return "其他";
}

export function statusColor(code: string): string {
  const n = Number.parseInt(code, 10);
  if (n >= 200 && n < 300) return "#5da87a";
  if (n >= 300 && n < 400) return "#6b8fbd";
  if (n >= 400 && n < 500) return "#c48b5c";
  if (n >= 500) return "#c75c5c";
  return "#8b93a7";
}

function latencyBarColor(loMs: number): string {
  if (loMs < 300) return "#6b9fd4";
  if (loMs < 800) return "#c4a24a";
  return "#c75c5c";
}

function drawYGrid(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  y: d3.ScaleLinear<number, number>,
  innerW: number,
  innerH: number,
  colors: ReturnType<typeof resolveChartColors>,
) {
  const ticks = y.ticks(5);
  g.selectAll("line.grid-h")
    .data(ticks)
    .join("line")
    .attr("class", "grid-h")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", (t) => y(t))
    .attr("y2", (t) => y(t))
    .attr("stroke", colors.border)
    .attr("stroke-opacity", 0.32)
    .attr("stroke-dasharray", "3 4")
    .attr("pointer-events", "none");
}

export function LatencyDistributionChart({
  durationsMs,
  bucketMs = 50,
}: {
  durationsMs: number[];
  bucketMs?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useHostWidth(hostRef);
  const bins = useMemo(() => latencyBins(durationsMs, bucketMs), [durationsMs, bucketMs]);
  const activeBins = useMemo(() => bins.filter((b) => b.count > 0), [bins]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || !width || !activeBins.length) return;

    const colors = resolveChartColors();
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const x = d3
      .scaleBand<string>()
      .domain(activeBins.map((b) => b.label))
      .range([0, innerW])
      .padding(0.12);
    const yMax = Math.max(d3.max(activeBins, (d) => d.count) ?? 0, 1);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    const g = svg
      .attr("width", width)
      .attr("height", CHART_HEIGHT)
      .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    drawYGrid(g, y, innerW, innerH, colors);

    const tickStep = Math.max(1, Math.ceil(activeBins.length / 8));
    const tickLabels = activeBins
      .filter((_, i) => i % tickStep === 0 || i === activeBins.length - 1)
      .map((b) => b.label);

    styleAxis(
      g
        .append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).tickValues(tickLabels))
        .call((sel) => sel.selectAll(".tick text").attr("fill", colors.text).attr("opacity", 0.75)),
      colors,
    );
    styleAxis(
      g
        .append("g")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")))
        .call((sel) => {
          sel.selectAll(".tick line").attr("opacity", 0);
          sel.selectAll(".tick text").attr("fill", colors.text).attr("opacity", 0.75);
        }),
      colors,
    );

    const barW = x.bandwidth();
    const bars = g
      .selectAll("rect.bar")
      .data(activeBins)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.label) ?? 0)
      .attr("y", (d) => y(d.count))
      .attr("width", barW)
      .attr("height", (d) => Math.max(0, innerH - y(d.count)))
      .attr("fill", (d) => latencyBarColor(d.lo))
      .attr("opacity", 0.88)
      .attr("rx", 3);

    bars.append("title").text((d) => `${d.lo}–${d.hi} ms · ${d.count} 次`);

    const labelRoom = innerH - y(yMax * 0.92);
    if (labelRoom > 14 || activeBins.length <= 14) {
      g.selectAll("text.bar-label")
        .data(activeBins.filter((d) => d.count > 0))
        .join("text")
        .attr("class", "bar-label")
        .attr("x", (d) => (x(d.label) ?? 0) + barW / 2)
        .attr("y", (d) => Math.max(12, y(d.count) - 4))
        .attr("text-anchor", "middle")
        .attr("fill", colors.text)
        .attr("font-size", 9)
        .attr("font-weight", 600)
        .attr("opacity", 0.88)
        .attr("pointer-events", "none")
        .text((d) => String(d.count));
    }

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 36)
      .attr("text-anchor", "middle")
      .attr("fill", colors.muted)
      .attr("font-size", 10)
      .attr("font-family", '"Segoe UI", "Microsoft YaHei UI", sans-serif')
      .text("延迟区间 (ms)");

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2)
      .attr("y", -40)
      .attr("text-anchor", "middle")
      .attr("fill", colors.muted)
      .attr("font-size", 10)
      .attr("font-family", '"Segoe UI", "Microsoft YaHei UI", sans-serif')
      .text("请求数（次）");
  }, [activeBins, width]);

  return (
    <div ref={hostRef} className="perf-chart-host perf-chart-host--latency">
      {!activeBins.length ? <p className="hint perf-chart-empty">无延迟数据</p> : null}
      <p className="perf-chart-subtitle">
        柱高 = 各时间区间内请求次数 · 桶宽 {bucketMs} ms（仅显示有样本的区间）
      </p>
      <svg ref={svgRef} className="perf-chart-svg" role="img" aria-label="延迟分布" />
    </div>
  );
}

export function StatusCodeChart({ statusCodes }: { statusCodes: Record<string, number> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useHostWidth(hostRef);

  const data = useMemo(
    () =>
      Object.entries(statusCodes)
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => Number(a.code) - Number(b.code)),
    [statusCodes],
  );
  const total = useMemo(() => d3.sum(data, (d) => d.count), [data]);

  const singleSlice = data.length === 1;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || !width || !data.length) return;

    const colors = resolveChartColors();
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const radius = Math.min(innerW, innerH) / 2 - 8;
    const cx = innerW / 2;
    const cy = innerH / 2;

    const root = svg.attr("width", width).attr("height", CHART_HEIGHT);
    const g = root
      .append("g")
      .attr("transform", `translate(${MARGIN.left + cx},${MARGIN.top + cy})`);

    const font = '"Segoe UI", "Microsoft YaHei UI", sans-serif';

    if (singleSlice) {
      const only = data[0]!;
      const tint = statusColor(only.code);
      const success = formatStatusLabel(only.code) === "成功";
      g.append("circle")
        .attr("r", radius)
        .attr("fill", "none")
        .attr("stroke", tint)
        .attr("stroke-width", Math.max(10, radius * 0.14))
        .attr("stroke-opacity", 0.78);
      g.append("circle")
        .attr("r", radius * 0.46)
        .attr("fill", success ? "rgb(93 168 122 / 0.12)" : "rgb(255 255 255 / 0.03)")
        .attr("stroke", "rgb(255 255 255 / 0.06)");
      if (success) {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "-0.55em")
          .attr("fill", tint)
          .attr("font-size", 26)
          .attr("font-weight", 800)
          .attr("font-family", font)
          .text("100%");
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.65em")
          .attr("fill", "rgb(180 220 200 / 0.95)")
          .attr("font-size", 11)
          .attr("font-weight", 600)
          .attr("font-family", font)
          .text("全部成功");
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "1.55em")
          .attr("fill", tint)
          .attr("font-size", 13)
          .attr("font-weight", 700)
          .attr("font-family", font)
          .text(`HTTP ${only.code}`);
      } else {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "-0.2em")
          .attr("fill", colors.text)
          .attr("font-size", 22)
          .attr("font-weight", 700)
          .attr("font-family", font)
          .text(`HTTP ${only.code}`);
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "1.1em")
          .attr("fill", colors.muted)
          .attr("font-size", 10)
          .attr("font-family", font)
          .text(`${only.count} 次 · ${formatStatusLabel(only.code)}`);
      }
      return;
    }

    const pie = d3
      .pie<{ code: string; count: number }>()
      .value((d) => d.count)
      .sort(null);
    const arc = d3
      .arc<d3.PieArcDatum<{ code: string; count: number }>>()
      .innerRadius(radius * 0.52)
      .outerRadius(radius);

    g.selectAll("path.slice")
      .data(pie(data))
      .join("path")
      .attr("class", "slice")
      .attr("d", arc)
      .attr("fill", (d) => statusColor(d.data.code))
      .attr("opacity", 0.9)
      .attr("stroke", "rgba(0,0,0,0.35)")
      .attr("stroke-width", 1.5)
      .append("title")
      .text((d) => `HTTP ${d.data.code} · ${d.data.count} 次`);

    const lead = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]!);
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.2em")
      .attr("fill", statusColor(lead.code))
      .attr("font-size", 20)
      .attr("font-weight", 800)
      .attr("font-family", font)
      .text(`HTTP ${lead.code}`);
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.15em")
      .attr("fill", colors.muted)
      .attr("font-size", 10)
      .attr("font-family", font)
      .text(`${total} 响应 · ${data.length} 类`);
  }, [data, singleSlice, total, width]);

  return (
    <div ref={hostRef} className="perf-chart-host">
      {!data.length ? <p className="hint perf-chart-empty">无状态码数据</p> : null}
      <svg ref={svgRef} className="perf-chart-svg" role="img" aria-label="HTTP 状态码分布" />
      {data.length > 0 ? (
        <ul className="perf-chart-legend-list perf-chart-legend-list--stacked perf-chart-legend-list--bright" aria-label="状态码图例">
          {data.map((d) => {
            const label = formatStatusLabel(d.code);
            return (
              <li key={d.code}>
                <span className="perf-chart-legend-swatch" style={{ background: statusColor(d.code) }} />
                <span className="perf-chart-legend-main">
                  HTTP {d.code}（{label}）· {d.count} 次
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}