import type { HttpBenchmarkSample } from "./apiWorkbenchTypes";
import type { JtlSample } from "./jtl";
import { jtlSampleErrorMessage } from "./jtlTextRepair";
import {
  JMETER_APDEX_SATISFIED_MS,
  JMETER_APDEX_TOLERATED_MS,
  type JmeterApdexRow,
  type JmeterErrorRow,
  type JmeterSamplerErrorRow,
  type JmeterStatRow,
  buildJmeterStatistics,
  globalWallMs,
} from "./jmeterStatistics";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function pushReservoir<T>(arr: T[], item: T, max: number, seen: { n: number }): void {
  seen.n += 1;
  if (arr.length < max) {
    arr.push(item);
    return;
  }
  const j = Math.floor(Math.random() * seen.n);
  if (j < max) arr[j] = item;
}

type LabelBucket = {
  count: number;
  errorCount: number;
  sumElapsed: number;
  bytesRecv: number;
  bytesSent: number;
  tsMin: number;
  tsMax: number;
  durations: number[];
  durationSeen: number;
  apdexSatisfied: number;
  apdexTolerating: number;
};

function freshBucket(): LabelBucket {
  return {
    count: 0,
    errorCount: 0,
    sumElapsed: 0,
    bytesRecv: 0,
    bytesSent: 0,
    tsMin: 0,
    tsMax: 0,
    durations: [],
    durationSeen: 0,
    apdexSatisfied: 0,
    apdexTolerating: 0,
  };
}

function pushDuration(bucket: LabelBucket, elapsed: number, maxDurations: number): void {
  bucket.durationSeen += 1;
  if (bucket.durations.length < maxDurations) {
    bucket.durations.push(elapsed);
    return;
  }
  const j = Math.floor(Math.random() * bucket.durationSeen);
  if (j < maxDurations) bucket.durations[j] = elapsed;
}

function bucketWallMs(bucket: LabelBucket, globalMs: number): number {
  if (bucket.tsMin > 0 && bucket.tsMax > bucket.tsMin) {
    return Math.max(1, bucket.tsMax - bucket.tsMin);
  }
  return Math.max(1, globalMs);
}

function statFromBucket(label: string, bucket: LabelBucket, wallMs: number): JmeterStatRow {
  const durations = [...bucket.durations].sort((a, b) => a - b);
  const n = bucket.count;
  const wallSec = wallMs / 1000;
  return {
    transaction: label,
    sampleCount: n,
    errorCount: bucket.errorCount,
    errorPct: n ? (bucket.errorCount / n) * 100 : 0,
    meanResTime: n ? bucket.sumElapsed / n : 0,
    medianResTime: percentile(durations, 0.5),
    minResTime: durations[0] ?? 0,
    maxResTime: durations[durations.length - 1] ?? 0,
    pct1ResTime: percentile(durations, 0.9),
    pct2ResTime: percentile(durations, 0.95),
    pct3ResTime: percentile(durations, 0.99),
    throughput: wallSec > 0 ? n / wallSec : 0,
    receivedKBytesPerSec: wallSec > 0 ? bucket.bytesRecv / 1024 / wallSec : 0,
    sentKBytesPerSec: wallSec > 0 ? bucket.bytesSent / 1024 / wallSec : 0,
  };
}

function apdexFromBucket(label: string, bucket: LabelBucket): JmeterApdexRow {
  const score =
    bucket.count > 0
      ? (bucket.apdexSatisfied + 0.5 * bucket.apdexTolerating) / bucket.count
      : 0;
  return {
    label,
    apdex: score,
    satisfiedMs: JMETER_APDEX_SATISFIED_MS,
    toleratedMs: JMETER_APDEX_TOLERATED_MS,
  };
}

export type JtlStreamAggregateOptions = {
  /** 分位数估计用的响应时间蓄水池（每标签 + Total） */
  maxDurationsPerLabel?: number;
  /** 写入 perf/*.json 的明细样本上限 */
  maxArchiveSamples?: number;
  /** JTL 报告页预览样本上限 */
  maxPreviewSamples?: number;
};

export type PercentileApproxMeta = {
  /** P90/P95/P99 来自蓄水池估计，非全量排序 */
  approximate: boolean;
  /** 参与分位数估计的样本槽位数（不超过 cap） */
  reservoirUsed: number;
  /** 实际解析的总行数 */
  totalSamples: number;
  cap: number;
};

export type JtlStreamAggregateResult = {
  errors: string[];
  totalRows: number;
  samples: JtlSample[];
  percentileMeta: PercentileApproxMeta;
  statistics: JmeterStatRow[];
  apdex: JmeterApdexRow[];
  errorsSummary: JmeterErrorRow[];
  top5BySampler: JmeterSamplerErrorRow[];
  archiveSamples: HttpBenchmarkSample[];
  threadPeak: number;
  startedAt: string;
  endedAt: string;
  wallMs: number;
  statusCodes: Record<string, number>;
  httpBytesReceived: number;
  httpBytesSent: number;
  httpSampleCount: number;
  /** 每个 HTTP 标签首次见到的 URL（用于历史「按接口」） */
  httpUrlByLabel: Record<string, string>;
  streamed: true;
};

export function createJtlStreamAggregator(options?: JtlStreamAggregateOptions) {
  const maxDur = options?.maxDurationsPerLabel ?? 50_000;
  const maxArchive = options?.maxArchiveSamples ?? 800;
  const maxPreview = options?.maxPreviewSamples ?? 5_000;

  const errors: string[] = [];
  const byLabel = new Map<string, LabelBucket>();
  const total = freshBucket();
  let totalRows = 0;
  let threadPeak = 1;
  let headerChecked = false;

  const previewSamples: JtlSample[] = [];
  const previewSeen = { n: 0 };
  const httpArchiveRows: JtlSample[] = [];
  const archiveSeen = { n: 0 };

  const errorMessages = new Map<string, number>();
  const samplerErrors = new Map<string, JmeterSamplerErrorRow>();
  const httpUrlByLabel = new Map<string, string>();
  const statusCodes: Record<string, number> = {};
  let httpBytesReceived = 0;
  let httpBytesSent = 0;
  let httpSampleCount = 0;

  const touchTs = (bucket: LabelBucket, ts: number) => {
    if (ts <= 0) return;
    if (!bucket.tsMin || ts < bucket.tsMin) bucket.tsMin = ts;
    if (!bucket.tsMax || ts > bucket.tsMax) bucket.tsMax = ts;
  };

  const pushApdex = (bucket: LabelBucket, s: JtlSample) => {
    if (!s.success) return;
    const t = s.elapsed;
    if (t <= JMETER_APDEX_SATISFIED_MS) bucket.apdexSatisfied += 1;
    else if (t <= JMETER_APDEX_TOLERATED_MS) bucket.apdexTolerating += 1;
  };

  const isHttp = (s: JtlSample): boolean => {
    const url = s.url.trim().toLowerCase();
    return url !== "" && url !== "null";
  };

  return {
    noteHeader(cells: string[]) {
      if (headerChecked) return;
      headerChecked = true;
      const names = cells.map((c) => c.trim());
      const missing = ["timeStamp", "elapsed", "label"].filter(
        (c) => !names.includes(c) && !names.includes(c === "URL" ? "URL" : c),
      );
      if (!names.includes("timeStamp") || !names.includes("elapsed") || !names.includes("label")) {
        errors.push(`未识别的 JTL 表头（需 JMeter CSV）：${names.slice(0, 8).join(", ")}…`);
      } else if (missing.length) {
        /* ok */
      }
    },

    push(sample: JtlSample) {
      totalRows += 1;
      threadPeak = Math.max(threadPeak, sample.allThreads || sample.grpThreads || 1);

      const addTo = (bucket: LabelBucket, s: JtlSample) => {
        bucket.count += 1;
        bucket.sumElapsed += s.elapsed;
        if (!s.success) bucket.errorCount += 1;
        bucket.bytesRecv += s.bytes;
        bucket.bytesSent += s.sentBytes;
        touchTs(bucket, s.timeStamp);
        pushDuration(bucket, s.elapsed, maxDur);
        pushApdex(bucket, s);
      };

      addTo(total, sample);

      let labelBucket = byLabel.get(sample.label);
      if (!labelBucket) {
        labelBucket = freshBucket();
        byLabel.set(sample.label, labelBucket);
      }
      addTo(labelBucket, sample);

      if (!sample.success) {
        const msg = jtlSampleErrorMessage(sample);
        errorMessages.set(msg, (errorMessages.get(msg) ?? 0) + 1);
        const key = `${sample.label}\0${msg}`;
        const cur = samplerErrors.get(key);
        if (cur) cur.count += 1;
        else samplerErrors.set(key, { sampler: sample.label, message: msg, count: 1 });
      }

      pushReservoir(previewSamples, sample, maxPreview, previewSeen);

      if (isHttp(sample)) {
        httpSampleCount += 1;
        if (!httpUrlByLabel.has(sample.label)) {
          httpUrlByLabel.set(sample.label, sample.url.trim());
        }
        const code = sample.responseCode || "0";
        statusCodes[code] = (statusCodes[code] ?? 0) + 1;
        httpBytesReceived += sample.bytes;
        httpBytesSent += sample.sentBytes;
        pushReservoir(httpArchiveRows, sample, maxArchive, archiveSeen);
      }
    },

    finalize(): JtlStreamAggregateResult {
      if (!totalRows) {
        errors.push("未解析到任何样本行");
      }

      const proxySamples: JtlSample[] = previewSamples.length ? previewSamples : [];
      const wallMs = proxySamples.length ? globalWallMs(proxySamples) : bucketWallMs(total, 1);
      const globalMs = total.tsMin && total.tsMax ? Math.max(1, total.tsMax - total.tsMin) : wallMs;

      const statistics: JmeterStatRow[] = [];
      for (const [label, bucket] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        statistics.push(statFromBucket(label, bucket, bucketWallMs(bucket, globalMs)));
      }
      statistics.push(statFromBucket("Total", total, globalMs));

      const apdex: JmeterApdexRow[] = [apdexFromBucket("Total", total)];
      for (const [label, bucket] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        apdex.push(apdexFromBucket(label, bucket));
      }

      const failed = total.errorCount;
      const errorsSummary: JmeterErrorRow[] = [...errorMessages.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([message, count]) => ({
          message,
          count,
          pct: failed ? (count / failed) * 100 : 0,
        }));

      const top5BySampler = [...samplerErrors.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const minTs = total.tsMin;
      const maxTs = total.tsMax;
      const startedAt = minTs ? new Date(minTs).toISOString() : new Date().toISOString();
      const endedAt = maxTs ? new Date(maxTs).toISOString() : startedAt;

      const archiveSamples: HttpBenchmarkSample[] = httpArchiveRows.map((s, i) => ({
        index: i + 1,
        warmup: false,
        ok: s.success,
        status: Number(s.responseCode) || 0,
        durationMs: s.elapsed,
        bodySize: s.bytes,
        error: s.success ? undefined : jtlSampleErrorMessage(s),
      }));

      const percentileMeta: PercentileApproxMeta = {
        approximate: total.durationSeen > maxDur,
        reservoirUsed: Math.min(total.durationSeen, maxDur),
        totalSamples: total.count,
        cap: maxDur,
      };

      return {
        errors,
        totalRows,
        samples: previewSamples,
        percentileMeta,
        statistics:
          statistics.length > 1
            ? statistics
            : proxySamples.length
              ? buildJmeterStatistics(proxySamples)
              : statistics,
        apdex,
        errorsSummary,
        top5BySampler,
        archiveSamples,
        threadPeak,
        startedAt,
        endedAt,
        wallMs: globalMs,
        statusCodes,
        httpBytesReceived,
        httpBytesSent,
        httpSampleCount,
        httpUrlByLabel: Object.fromEntries(httpUrlByLabel),
        streamed: true,
      };
    },
  };
}