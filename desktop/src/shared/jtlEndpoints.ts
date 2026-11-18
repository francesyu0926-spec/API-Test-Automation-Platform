import type { HttpBenchmarkJtlEndpoint } from "./apiWorkbenchTypes";
import { inferHttpMethodFromLabel } from "./jtl";
import type { JtlStreamAggregateResult } from "./jtlStreamAggregator";

export function jtlEndpointsFromAggregate(agg: JtlStreamAggregateResult): HttpBenchmarkJtlEndpoint[] {
  const urls = agg.httpUrlByLabel ?? {};
  return agg.statistics
    .filter((r) => r.transaction !== "Total" && urls[r.transaction])
    .map((r) => ({
      label: r.transaction,
      method: inferHttpMethodFromLabel(r.transaction),
      url: urls[r.transaction],
      samples: r.sampleCount,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

export function jtlEndpointKey(ep: HttpBenchmarkJtlEndpoint): string {
  return `${ep.method}\t${ep.url}\t${ep.label}`;
}

export function shortenHttpUrl(raw: string, max = 72): string {
  const trimmed = raw.trim();
  if (!trimmed) return "—";
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const short = `${u.host}${u.pathname}${u.search}` || trimmed;
    return short.length > max ? `${short.slice(0, max - 1)}…` : short;
  } catch {
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
  }
}

export function formatJtlEndpointLine(ep: HttpBenchmarkJtlEndpoint): string {
  const short = shortenHttpUrl(ep.url);
  if (short && short !== "—") return short;
  return ep.label.trim() || "—";
}