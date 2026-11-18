export function jmeterErrorPctClass(pct: number): string {
  if (pct <= 0) return "jmeter-metric--ok";
  if (pct > 10) return "jmeter-metric--fail";
  return "jmeter-metric--warn";
}

export function jmeterFailCountClass(count: number): string {
  if (count <= 0) return "jmeter-metric--ok";
  return "jmeter-metric--fail";
}

/** 与图例一致：优 ≥0.94，中 ≥0.70，差 <0.70（0.70–0.85 为可接受区间，不归入「差」） */
export const APDEX_TIER_GOOD = 0.94;
export const APDEX_TIER_FAIR = 0.7;

export function apdexScoreClass(score: number): string {
  if (score >= APDEX_TIER_GOOD) return "jmeter-apdex-pill jmeter-apdex-pill--good";
  if (score >= APDEX_TIER_FAIR) return "jmeter-apdex-pill jmeter-apdex-pill--fair";
  return "jmeter-apdex-pill jmeter-apdex-pill--poor";
}

/** HTTP 200 但断言失败等「伪 200」错误提示 */
export function isMisleading200Error(message: string): boolean {
  const t = message.trim();
  return /^200\b/i.test(t) && /\bOK\b/i.test(t);
}

/** 错误汇总表中「占全部错误 %」列上色 */
export function jmeterErrorsSharePctClass(pct: number): string {
  if (pct > 50) return "jmeter-errors-share--high";
  if (pct >= 10) return "jmeter-errors-share--mid";
  return "jmeter-errors-share--low";
}

export function formatJmeterCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function formatErrorDisplayMessage(message: string): string {
  const text = message.trim();
  if (isMisleading200Error(text) && !text.includes("断言失败")) {
    return `${text} (断言失败)`;
  }
  return text;
}

/** 左侧异常摘要：200 OK + 断言失败徽章行 */
export function isAssertionFailDisplay(message: string): boolean {
  const text = message.trim();
  if (isMisleading200Error(text)) return true;
  const display = formatErrorDisplayMessage(text);
  return /\bOK\b/i.test(display) && display.includes("断言失败");
}

export function assertionFailLeadLabel(message: string): string {
  const display = formatErrorDisplayMessage(message.trim());
  const lead = display.replace(/\s*[\(（]断言失败[\)）]\s*$/u, "").trim();
  return lead || "200 OK";
}

const ASSERTION_200_TIP = "注：HTTP 状态码为 200，但业务断言判定为失败";

/** Top 5 表 Error 列：仅展示差异化短标签，完整文案见 title / 悬停 */
export function errorBriefLabel(message: string): string {
  const text = message.trim();
  if (!text) return "—";
  if (isMisleading200Error(text) || (/\bOK\b/i.test(text) && text.includes("断言失败"))) {
    return "200 OK (断言失败)";
  }
  if (/JSONPath/i.test(text)) return "JSONPath 断言";
  if (/login biz/i.test(text)) {
    const m = text.match(/login biz code\s*\d+/i);
    return m ? m[0]! : "登录业务码";
  }
  if (/^200\s+Failed/i.test(text)) return "断言失败";
  if (text.length <= 40) return text;
  return `${text.slice(0, 37)}…`;
}

export function assertion200TooltipText(): string {
  return ASSERTION_200_TIP;
}

export function statisticsToCsv(
  rows: Array<{
    transaction: string;
    sampleCount: number;
    errorCount: number;
    errorPct: number;
    meanResTime: number;
    minResTime: number;
    maxResTime: number;
    medianResTime: number;
    pct1ResTime: number;
    pct2ResTime: number;
    pct3ResTime: number;
    throughput: number;
    receivedKBytesPerSec: number;
    sentKBytesPerSec: number;
  }>,
): string {
  const header = [
    "Transactions",
    "#Samples",
    "FAIL",
    "Error %",
    "Average",
    "Min",
    "Max",
    "Median",
    "90th",
    "95th",
    "99th",
    "Throughput",
    "Recv KB/s",
    "Sent KB/s",
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.transaction,
        r.sampleCount,
        r.errorCount,
        r.errorPct.toFixed(2),
        r.meanResTime.toFixed(0),
        r.minResTime.toFixed(0),
        r.maxResTime.toFixed(0),
        r.medianResTime.toFixed(0),
        r.pct1ResTime.toFixed(0),
        r.pct2ResTime.toFixed(0),
        r.pct3ResTime.toFixed(0),
        r.throughput.toFixed(2),
        r.receivedKBytesPerSec.toFixed(2),
        r.sentKBytesPerSec.toFixed(2),
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}