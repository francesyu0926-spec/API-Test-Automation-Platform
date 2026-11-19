export type KeyValueRow = {
  key: string;
  value: string;
  enabled: boolean;
};

export type SavedApiRequest = {
  id: string;
  name: string;
  /** 用例文件名 stem（OpenAPI 导入等）；不落盘时由 URL/名称推导 */
  caseStem?: string;
  folder?: string;
  method: string;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  bodyMode: "none" | "raw";
  body: string;
  bodyContentType?: string;
};

export type ApiCollectionFile = {
  id: string;
  name: string;
  folders: string[];
  requests: SavedApiRequest[];
};

export type HttpSendPayload = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** 压测时跳过响应体解码，仅统计耗时 */
  lite?: boolean;
  /** 跳过 TLS 证书校验（等同 curl -k） */
  insecureTls?: boolean;
};

export type HttpBenchmarkOptions = {
  /** 总样本数；若设置 loops 则由 threads × loops 计算 */
  total?: number;
  /** 线程数（并发用户），对应 JMeter Number of Threads */
  concurrency: number;
  /** 每线程循环次数（JMeter Loop Count） */
  loops?: number;
  /** 拉起全部线程的秒数（JMeter Ramp-Up） */
  rampUpSec?: number;
  warmup?: number;
  timeoutMs?: number;
};

export type HttpBenchmarkSample = {
  index: number;
  warmup: boolean;
  durationMs: number;
  status: number;
  ok: boolean;
  error?: string;
  bodySize: number;
};

export type HttpBenchmarkLatencyStats = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
};

export type HttpBenchmarkStats = {
  samples: number;
  success: number;
  failed: number;
  wallMs: number;
  rps: number;
  latency: HttpBenchmarkLatencyStats;
  statusCodes: Record<string, number>;
  /** 响应体累计字节（不含预热） */
  bytesReceived?: number;
  /** 请求发送侧估算字节（不含预热） */
  bytesSent?: number;
};

export type PerfReportProvenance = {
  /** JMX 绝对路径（执行当时） */
  jmxPath?: string;
  /** 仓库内相对路径，如 projects/{id}/jmx/foo.jmx */
  jmxRelative?: string;
  sourceJtl?: string;
};

/** JTL 归档中的 HTTP 采样点（按 label 聚合） */
export type HttpBenchmarkJtlEndpoint = {
  label: string;
  method: string;
  url: string;
  samples: number;
};

export type HttpBenchmarkReport = {
  id: string;
  startedAt: string;
  request: { method: string; url: string; name?: string };
  options: HttpBenchmarkOptions;
  stats: HttpBenchmarkStats;
  samples: HttpBenchmarkSample[];
  cancelled?: boolean;
  provenance?: PerfReportProvenance;
  /** 由 JTL 解析的接口列表（JMeter 批量压测归档） */
  jtlEndpoints?: HttpBenchmarkJtlEndpoint[];
};

export type HttpSendResult = {
  ok: boolean;
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodySize: number;
  /** 图片等二进制预览（data URL 用） */
  bodyBase64?: string;
  bodyMime?: string;
  error?: string;
};

export type WorkbenchDraft = {
  name?: string;
  folder?: string;
  method: string;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  bodyMode: "none" | "raw";
  body: string;
  bodyContentType?: string;
};

export type WsConnectPayload = {
  connectionId: string;
  url: string;
  headers: Record<string, string>;
};

export type WsSendPayload = {
  connectionId: string;
  data: string;
};

export type WsEvent = {
  connectionId: string;
  type: "open" | "message" | "close" | "error";
  data?: string;
  binary?: boolean;
  binarySize?: number;
  code?: number;
  reason?: string;
  error?: string;
};