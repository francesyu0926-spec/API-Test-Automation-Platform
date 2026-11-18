export type KeyValueRow = {
  key: string;
  value: string;
  enabled: boolean;
};

export type SavedApiRequest = {
  id: string;
  name: string;
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
};

export type HttpBenchmarkReport = {
  id: string;
  startedAt: string;
  request: { method: string; url: string; name?: string };
  options: HttpBenchmarkOptions;
  stats: HttpBenchmarkStats;
  samples: HttpBenchmarkSample[];
  cancelled?: boolean;
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