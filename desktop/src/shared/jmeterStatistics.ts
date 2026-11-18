import type { JtlSample } from "./jtl";
import { jtlSampleErrorMessage } from "./jtlTextRepair";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export type JmeterStatRow = {
  transaction: string;
  sampleCount: number;
  errorCount: number;
  errorPct: number;
  meanResTime: number;
  medianResTime: number;
  minResTime: number;
  maxResTime: number;
  pct1ResTime: number;
  pct2ResTime: number;
  pct3ResTime: number;
  throughput: number;
  receivedKBytesPerSec: number;
  sentKBytesPerSec: number;
};

/** JTL Dashboard 展示用时间：`YYYY-MM-DD HH:mm:ss` */
export function formatJmeterReportTime(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

export type JmeterTestInfo = {
  sourceFile: string;
  startTime: string;
  endTime: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
};

export type JmeterErrorRow = {
  message: string;
  count: number;
  pct: number;
};

export type JmeterSamplerErrorRow = {
  sampler: string;
  message: string;
  count: number;
};

/** 与 jmeter.report.apdex_* 默认一致 */
export const JMETER_APDEX_SATISFIED_MS = 500;
export const JMETER_APDEX_TOLERATED_MS = 1500;

export type JmeterApdexRow = {
  label: string;
  apdex: number;
  satisfiedMs: number;
  toleratedMs: number;
};

export function formatApdexThresholdMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const sec = Math.floor(ms / 1000);
  const rem = ms % 1000;
  if (rem === 0) return `${sec} sec`;
  return `${sec} sec ${rem} ms`;
}

function apdexScore(group: JtlSample[], satisfiedMs: number, toleratedMs: number): number {
  if (!group.length) return 0;
  let satisfied = 0;
  let tolerating = 0;
  for (const s of group) {
    if (!s.success) continue;
    const t = s.elapsed;
    if (t <= satisfiedMs) satisfied += 1;
    else if (t <= toleratedMs) tolerating += 1;
  }
  return (satisfied + 0.5 * tolerating) / group.length;
}

/** 对齐 JMeter Dashboard APDEX 表（Total 为首行） */
export function buildJmeterApdex(
  samples: JtlSample[],
  satisfiedMs = JMETER_APDEX_SATISFIED_MS,
  toleratedMs = JMETER_APDEX_TOLERATED_MS,
): JmeterApdexRow[] {
  if (!samples.length) return [];
  const byLabel = new Map<string, JtlSample[]>();
  for (const s of samples) {
    const bucket = byLabel.get(s.label) ?? [];
    bucket.push(s);
    byLabel.set(s.label, bucket);
  }
  const rows: JmeterApdexRow[] = [
    {
      label: "Total",
      apdex: apdexScore(samples, satisfiedMs, toleratedMs),
      satisfiedMs,
      toleratedMs,
    },
  ];
  for (const [label, group] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({
      label,
      apdex: apdexScore(group, satisfiedMs, toleratedMs),
      satisfiedMs,
      toleratedMs,
    });
  }
  return rows;
}

/** 与 JMeter HTML Dashboard 一致：全局用首尾 timeStamp，单标签单样本用 elapsed 作为窗口 */
export function globalWallMs(samples: JtlSample[]): number {
  const ts = samples.map((s) => s.timeStamp).filter((t) => t > 0);
  if (ts.length >= 2) return Math.max(1, Math.max(...ts) - Math.min(...ts));
  if (samples.length === 1) return Math.max(1, samples[0].elapsed);
  return 1;
}

function labelWallMs(group: JtlSample[], globalMs: number): number {
  const ts = group.map((s) => s.timeStamp).filter((t) => t > 0);
  if (ts.length >= 2) return Math.max(1, Math.max(...ts) - Math.min(...ts));
  if (group.length === 1) return Math.max(1, group[0].elapsed);
  return Math.max(1, globalMs);
}

function statRowForGroup(label: string, group: JtlSample[], wallMs: number): JmeterStatRow {
  const durations = group.map((s) => s.elapsed).sort((a, b) => a - b);
  const n = group.length;
  const errorCount = group.filter((s) => !s.success).length;
  const bytesRecv = group.reduce((a, r) => a + r.bytes, 0);
  const bytesSent = group.reduce((a, r) => a + r.sentBytes, 0);
  const wallSec = wallMs / 1000;
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    transaction: label,
    sampleCount: n,
    errorCount,
    errorPct: n ? (errorCount / n) * 100 : 0,
    meanResTime: n ? sum / n : 0,
    medianResTime: percentile(durations, 0.5),
    minResTime: durations[0] ?? 0,
    maxResTime: durations[n - 1] ?? 0,
    pct1ResTime: percentile(durations, 0.9),
    pct2ResTime: percentile(durations, 0.95),
    pct3ResTime: percentile(durations, 0.99),
    throughput: wallSec > 0 ? n / wallSec : 0,
    receivedKBytesPerSec: wallSec > 0 ? bytesRecv / 1024 / wallSec : 0,
    sentKBytesPerSec: wallSec > 0 ? bytesSent / 1024 / wallSec : 0,
  };
}

export function buildJmeterTestInfoFromRange(
  startMs: number,
  endMs: number,
  sourceFile: string,
): JmeterTestInfo {
  return {
    sourceFile,
    startTime: formatJmeterReportTime(startMs),
    endTime: formatJmeterReportTime(endMs),
    startTimeMs: startMs,
    endTimeMs: endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

export function buildJmeterTestInfo(samples: JtlSample[], sourceFile: string): JmeterTestInfo {
  const ts = samples.map((s) => s.timeStamp).filter((t) => t > 0);
  const startMs = ts.length ? Math.min(...ts) : Date.now();
  const endMs = ts.length ? Math.max(...ts) : startMs;
  return {
    sourceFile,
    startTime: formatJmeterReportTime(startMs),
    endTime: formatJmeterReportTime(endMs),
    startTimeMs: startMs,
    endTimeMs: endMs,
    durationMs: Math.max(0, endMs - startMs),
  };
}

/** 对齐 report/statistics.json（含 WS、Total） */
export function buildJmeterStatistics(samples: JtlSample[]): JmeterStatRow[] {
  if (!samples.length) return [];
  const globalMs = globalWallMs(samples);
  const byLabel = new Map<string, JtlSample[]>();
  for (const s of samples) {
    const bucket = byLabel.get(s.label) ?? [];
    bucket.push(s);
    byLabel.set(s.label, bucket);
  }
  const rows: JmeterStatRow[] = [];
  for (const [label, group] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push(statRowForGroup(label, group, labelWallMs(group, globalMs)));
  }
  rows.push(statRowForGroup("Total", samples, globalMs));
  return rows;
}

export function buildJmeterErrors(samples: JtlSample[]): JmeterErrorRow[] {
  const failed = samples.filter((s) => !s.success);
  const total = samples.length;
  const map = new Map<string, number>();
  for (const s of failed) {
    const msg = jtlSampleErrorMessage(s);
    map.set(msg, (map.get(msg) ?? 0) + 1);
  }
  const totalErr = failed.length;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => ({
      message,
      count,
      pct: totalErr ? (count / totalErr) * 100 : 0,
    }));
}

export function buildTop5ErrorsBySampler(samples: JtlSample[]): JmeterSamplerErrorRow[] {
  const failed = samples.filter((s) => !s.success);
  const map = new Map<string, JmeterSamplerErrorRow>();
  for (const s of failed) {
    const message = jtlSampleErrorMessage(s);
    const key = `${s.label}\0${message}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { sampler: s.label, message, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}