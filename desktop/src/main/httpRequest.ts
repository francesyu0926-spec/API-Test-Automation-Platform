import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import zlib from "node:zlib";

import type { HttpSendPayload, HttpSendResult } from "../shared/apiWorkbenchTypes";
import { getWindowsProxyStatus, isLikelyAtpCaptureProxy } from "./windowsProxy";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

const httpsAgentDefault = new https.Agent({ keepAlive: true });
const httpsAgentInsecure = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

export async function sendHttpRequest(payload: HttpSendPayload): Promise<HttpSendResult> {
  const started = performance.now();
  const method = (payload.method || "GET").toUpperCase();
  const url = payload.url?.trim();
  if (!url) {
    return {
      ok: false,
      status: 0,
      statusText: "",
      durationMs: 0,
      headers: {},
      bodyText: "",
      bodySize: 0,
      error: "URL 为空",
    };
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload.headers ?? {})) {
    if (!k.trim() || HOP_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }

  const hasBody =
    payload.body != null &&
    payload.body !== "" &&
    method !== "GET" &&
    method !== "HEAD";
  if (hasBody) {
    const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (!hasCt) headers["Content-Type"] = "text/plain";
  }

  const timeoutMs = payload.timeoutMs ?? 60_000;

  try {
    const insecureTls = payload.insecureTls === true;
    const res = await followRedirects(
      url,
      method,
      headers,
      hasBody ? payload.body : undefined,
      timeoutMs,
      insecureTls,
    );
    const durationMs = Math.round(performance.now() - started);
    const bodyBuf = decompressBody(res.body, res.headers["content-encoding"]);
    const contentType = res.headers["content-type"] ?? null;
    const decoded = payload.lite
      ? { bodyText: "", bodyBase64: undefined, bodyMime: undefined }
      : decodeBody(bodyBuf, contentType);
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      ok,
      status: res.statusCode,
      statusText: res.statusMessage,
      durationMs,
      headers: res.headers,
      bodyText: decoded.bodyText,
      bodyBase64: decoded.bodyBase64,
      bodyMime: decoded.bodyMime,
      bodySize: bodyBuf.byteLength,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    const error = message.includes("请求超时") ? message : enrichNetworkError(message);
    return {
      ok: false,
      status: 0,
      statusText: "",
      durationMs,
      headers: {},
      bodyText: error,
      bodySize: 0,
      error,
    };
  }
}

type RawResponse = {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Buffer;
};

function flattenIncomingHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

function collectResponseBody(res: http.IncomingMessage, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(chunk as Buffer));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
    res.setTimeout(timeoutMs, () => {
      res.destroy();
      reject(new Error(`请求超时（${timeoutMs}ms）`));
    });
  });
}

function httpOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  insecureTls: boolean,
): Promise<RawResponse> {
  const lib = url.protocol === "https:" ? https : http;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const agent =
    url.protocol === "https:" ? (insecureTls ? httpsAgentInsecure : httpsAgentDefault) : undefined;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: timeoutMs,
        agent,
      },
      (res) => {
        void collectResponseBody(res, timeoutMs)
          .then((body) =>
            resolve({
              statusCode: res.statusCode ?? 0,
              statusMessage: res.statusMessage ?? "",
              headers: flattenIncomingHeaders(res.headers),
              body,
            }),
          )
          .catch(reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`请求超时（${timeoutMs}ms）`));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function followRedirects(
  startUrl: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  insecureTls: boolean,
): Promise<RawResponse> {
  let currentUrl = new URL(startUrl);
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await httpOnce(currentUrl, currentMethod, headers, currentBody, timeoutMs, insecureTls);
    if (!REDIRECT_STATUS.has(res.statusCode)) return res;

    const location = res.headers.location;
    if (!location) return res;

    currentUrl = new URL(location, currentUrl);
    if (
      (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) &&
      currentMethod !== "GET" &&
      currentMethod !== "HEAD"
    ) {
      currentMethod = "GET";
      currentBody = undefined;
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === "content-length" || key.toLowerCase() === "content-type") {
          delete headers[key];
        }
      }
    }
  }

  throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次`);
}

function decompressBody(buf: Buffer, encoding: string | undefined): Buffer {
  const enc = encoding?.toLowerCase() ?? "";
  if (!enc || buf.length === 0) return buf;
  try {
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

function enrichNetworkError(message: string): string {
  const base = message.trim() || "网络请求失败";
  const lower = base.toLowerCase();
  const proxy = getWindowsProxyStatus();
  const lines = [base];

  if (
    lower === "fetch failed" ||
    /econnrefused|econnreset|socket hang up|etimedout|enotfound|certificate|cert|unable to verify|tls connection was established/i.test(
      lower,
    )
  ) {
    if (isLikelyAtpCaptureProxy(proxy)) {
      lines.push("系统仍指向本机抓包代理（mitm/PAC），但代理可能未在运行。请在「抓包」点「仅恢复上网」后重试。");
    } else if (proxy.enabled || proxy.autoConfigUrl) {
      const detail = proxy.server?.trim() || proxy.autoConfigUrl?.trim() || "已开启";
      lines.push(`检测到 Windows 系统代理：${detail}。工作台已尝试直连；若仍失败，请暂时关闭系统代理后重试。`);
    } else if (lower === "fetch failed") {
      lines.push("无法建立连接（DNS、TLS 或服务器拒绝）。请确认 URL、网络与证书是否可用。");
    }
  }

  const code = (message.match(/\b(E[A-Z]+)\b/) || [])[1];
  if (code === "ENOTFOUND") {
    lines.push("域名无法解析，请检查主机名或 DNS。");
  } else if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    lines.push("连接超时，请检查网络或增大超时时间。");
  } else if (/certificate|cert|ssl|tls/i.test(base)) {
    lines.push("TLS 证书校验失败；可在错误卡片中开启「忽略证书校验」后重新 Send。");
  } else if (/econnreset/i.test(lower) && /tls|secure/i.test(lower)) {
    lines.push(
      "TLS 握手被中断（常见于出口防火墙、需专用网络/VPN，或需在公司内网访问）。可用浏览器打开同一 URL 对比是否正常。",
    );
  }

  return lines.join("\n\n");
}

type DecodedBody = {
  bodyText: string;
  bodyBase64?: string;
  bodyMime?: string;
};

function imageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  }
  return null;
}

function resolveImageMime(contentType: string | null, bytes: Uint8Array): string | null {
  const raw = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (raw.startsWith("image/")) return raw;
  return imageMimeFromBytes(bytes);
}

function decodeBody(buf: Buffer, contentType: string | null): DecodedBody {
  if (buf.byteLength === 0) return { bodyText: "" };
  const bytes = new Uint8Array(buf);
  const imageMime = resolveImageMime(contentType, bytes);
  if (imageMime) {
    const bodyBase64 = buf.toString("base64");
    return {
      bodyText: `[图片 ${imageMime}，${buf.byteLength} 字节]`,
      bodyBase64,
      bodyMime: imageMime,
    };
  }
  const isText =
    !contentType ||
    /json|text|xml|html|javascript|yaml|csv|form-urlencoded/i.test(contentType);
  if (!isText) {
    return { bodyText: `[二进制 ${buf.byteLength} 字节，未显示]` };
  }
  try {
    return { bodyText: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
  } catch {
    return { bodyText: `[无法解码为 UTF-8，${buf.byteLength} 字节]` };
  }
}