export type JtlSample = {
  timeStamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  responseMessage: string;
  threadName: string;
  success: boolean;
  bytes: number;
  sentBytes: number;
  grpThreads: number;
  allThreads: number;
  url: string;
  latency: number;
  connect: number;
};

export type JtlParseResult = {
  samples: JtlSample[];
  errors: string[];
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (c === "," && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1";
}

function parseNum(raw: string, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const JTL_COLUMNS = [
  "timeStamp",
  "elapsed",
  "label",
  "responseCode",
  "responseMessage",
  "threadName",
  "dataType",
  "success",
  "failureMessage",
  "bytes",
  "sentBytes",
  "grpThreads",
  "allThreads",
  "URL",
  "Latency",
  "IdleTime",
  "Connect",
] as const;

export function parseJtlCsv(text: string): JtlParseResult {
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) {
    return { samples: [], errors: ["JTL 文件为空"] };
  }

  const headerCells = parseCsvLine(lines[0]).map((c) => c.trim());
  const colIndex = new Map<string, number>();
  headerCells.forEach((name, i) => colIndex.set(name, i));

  const missing = JTL_COLUMNS.filter((c) => !colIndex.has(c));
  if (missing.length > 4) {
    errors.push(`未识别的 JTL 表头（需 JMeter CSV）：${headerCells.slice(0, 8).join(", ")}…`);
  }

  const idx = (name: string, fallback: number) => colIndex.get(name) ?? fallback;

  const samples: JtlSample[] = [];
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const cells = parseCsvLine(lines[lineNo]);
    if (!cells.length || cells.every((c) => !c.trim())) continue;

    const get = (name: string) => cells[idx(name, -1)] ?? "";

    const label = get("label").trim();
    if (!label) continue;

    samples.push({
      timeStamp: parseNum(get("timeStamp")),
      elapsed: parseNum(get("elapsed")),
      label,
      responseCode: get("responseCode").trim(),
      responseMessage: get("responseMessage").trim(),
      threadName: get("threadName").trim(),
      success: parseBool(get("success")),
      bytes: parseNum(get("bytes")),
      sentBytes: parseNum(get("sentBytes")),
      grpThreads: parseNum(get("grpThreads"), 1),
      allThreads: parseNum(get("allThreads"), 1),
      url: get("URL").trim(),
      latency: parseNum(get("Latency"), parseNum(get("elapsed"))),
      connect: parseNum(get("Connect")),
    });
  }

  if (!samples.length) {
    errors.push("未解析到任何样本行");
  }
  return { samples, errors };
}

export function inferHttpMethodFromLabel(label: string): string {
  const m = label.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i);
  return m ? m[1].toUpperCase() : "POST";
}

/** 从 JMeter 标签里提取路径片段，如「… POST /quote」→ /quote */
export function pathHintFromLabel(label: string): string | null {
  const m = label.match(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)/i);
  return m?.[1] ?? null;
}