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
  if (n >= 200 && n < 300) return "#9ca3af";
  if (n >= 300 && n < 400) return "#94a3b8";
  if (n >= 400 && n < 500) return "#c48e4d";
  if (n >= 500) return "#a8763a";
  return "#6b7280";
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

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || !width || !bins.length) return;

    const colors = resolveChartColors();
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

    const x = d3
      .scaleBand<string>()
      .domain(bins.map((b) => b.label))
      .range([0, innerW])
      .padding(0.12);
    const yMax = Math.max(d3.max(bins, (d) => d.count) ?? 0, 1);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    const g = svg
      .attr("width", width)
      .attr("height", CHART_HEIGHT)
      .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    const tickStep = Math.max(1, Math.ceil(bins.length / 8));
    const tickLabels = bins.filter((_, i) => i % tickStep === 0 || i === bins.length - 1).map((b) => b.label);

    styleAxis(
      g.append("g").attr("transform", `translate(0,${innerH})`).call(d3.axisBottom(x).tickValues(tickLabels)),
      colors,
    );
    styleAxis(g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d"))), colors);

    g.selectAll("rect.bar")
      .data(bins)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.label) ?? 0)
      .attr("y", (d) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d) => Math.max(0, innerH - y(d.count)))
      .attr("fill", colors.accent)
      .attr("opacity", 0.9)
      .attr("rx", 3)
      .append("title")
      .text((d) => `${d.lo}–${d.hi} ms · ${d.count} 次`);

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
  }, [bins, width]);

  const accent = resolveChartColors().accent;

  return (
    <div ref={hostRef} className="perf-chart-host">
      {!bins.length ? <p className="hint perf-chart-empty">无延迟数据</p> : null}
      <svg ref={svgRef} className="perf-chart-svg" role="img" aria-label="延迟分布" />
      {bins.length > 0 ? (
        <ul className="perf-chart-legend-list" aria-hidden>
          <li>
            <span className="perf-chart-legend-swatch" style={{ background: accent }} />
            柱高 = 各时间区间内请求次数 · 桶宽 {bucketMs} ms
          </li>
        </ul>
      ) : null}
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
      .attr("stroke", "rgba(0,0,0,0.35)")
      .attr("stroke-width", 1.5)
      .append("title")
      .text((d) => `HTTP ${d.data.code} · ${d.data.count} 次`);

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.15em")
      .attr("fill", colors.text)
      .attr("font-size", 20)
      .attr("font-weight", 600)
      .attr("font-family", '"Segoe UI", "Microsoft YaHei UI", sans-serif')
      .text(String(total));
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1.25em")
      .attr("fill", colors.muted)
      .attr("font-size", 10)
      .attr("font-family", '"Segoe UI", "Microsoft YaHei UI", sans-serif')
      .text("响应");
  }, [data, total, width]);

  return (
    <div ref={hostRef} className="perf-chart-host">
      {!data.length ? <p className="hint perf-chart-empty">无状态码数据</p> : null}
      <svg ref={svgRef} className="perf-chart-svg" role="img" aria-label="HTTP 状态码分布" />
      {data.length > 0 ? (
        <ul className="perf-chart-legend-list perf-chart-legend-list--stacked" aria-label="状态码图例">
          {data.map((d) => {
            const pct = total > 0 ? ((d.count / total) * 100).toFixed(0) : "0";
            return (
              <li key={d.code}>
                <span className="perf-chart-legend-swatch" style={{ background: statusColor(d.code) }} />
                <span className="perf-chart-legend-main">
                  HTTP {d.code}
                  <span className="hint">
                    {" "}
                    · {d.count} 次 ({pct}%) · {formatStatusLabel(d.code)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}