import type { HttpBenchmarkReport } from "./apiWorkbenchTypes";
import { jtlEndpointsFromAggregate } from "./jtlEndpoints";
import type { JtlStreamAggregateResult } from "./jtlStreamAggregator";

function basenamePath(p: string): string {
  return p.replace(/^.*[\\/]/, "");
}

export function jtlAggregateToRunBenchmarkReport(
  agg: JtlStreamAggregateResult,
  meta: { sourceJtl: string; jmxPath?: string; projectId?: string },
): HttpBenchmarkReport | null {
  if (agg.httpSampleCount === 0 && agg.totalRows === 0) return null;
  const total = agg.statistics.find((r) => r.transaction === "Total") ?? agg.statistics[0];
  if (!total?.sampleCount) return null;

  const jmxBase = meta.jmxPath
    ? meta.jmxPath.replace(/^.*[\\/]/, "").replace(/\.jmx$/i, "")
    : meta.sourceJtl.replace(/^.*[\\/]/, "").replace(/\.jtl$/i, "");

  const wallSec = agg.wallMs / 1000;
  const success = total.sampleCount - total.errorCount;
  const stamp = agg.startedAt.replace(/[:.]/g, "-").slice(0, 19);

  return {
    id: `jmeter-${stamp}-${Math.random().toString(36).slice(2, 9)}`,
    startedAt: agg.startedAt,
    request: {
      method: "JMX",
      url: meta.sourceJtl,
      name: `JMeter · ${jmxBase}`,
    },
    options: {
      concurrency: agg.threadPeak,
      loops: Math.max(1, Math.round(total.sampleCount / Math.max(1, agg.threadPeak))),
      rampUpSec: 0,
      warmup: 0,
    },
    stats: {
      samples: total.sampleCount,
      success,
      failed: total.errorCount,
      wallMs: agg.wallMs,
      rps: wallSec > 0 ? Math.round((total.throughput + Number.EPSILON) * 100) / 100 : 0,
      latency: {
        min: Math.round(total.minResTime),
        max: Math.round(total.maxResTime),
        avg: Math.round(total.meanResTime),
        p50: Math.round(total.medianResTime),
        p90: Math.round(total.pct1ResTime),
        p95: Math.round(total.pct2ResTime),
        p99: Math.round(total.pct3ResTime),
      },
      statusCodes: agg.statusCodes,
      bytesReceived: agg.httpBytesReceived,
      bytesSent: agg.httpBytesSent,
    },
    samples: agg.archiveSamples,
    cancelled: false,
    provenance: {
      sourceJtl: meta.sourceJtl,
      jmxPath: meta.jmxPath,
      jmxRelative:
        meta.jmxPath && meta.projectId
          ? `projects/${meta.projectId}/jmx/${basenamePath(meta.jmxPath)}`
          : undefined,
    },
    jtlEndpoints: jtlEndpointsFromAggregate(agg),
  };
}