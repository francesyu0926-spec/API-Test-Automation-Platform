import type { HttpSendPayload, HttpSendResult } from "../shared/apiWorkbenchTypes";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

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

  const headers = new Headers();
  for (const [k, v] of Object.entries(payload.headers ?? {})) {
    if (!k.trim() || HOP_HEADERS.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }

  const hasBody =
    payload.body != null &&
    payload.body !== "" &&
    method !== "GET" &&
    method !== "HEAD";
  if (hasBody && !headers.has("content-type")) {
    headers.set("Content-Type", "text/plain");
  }

  const timeoutMs = payload.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? payload.body : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
    const durationMs = Math.round(performance.now() - started);
    const buf = await res.arrayBuffer();
    const bodyText = payload.lite ? "" : decodeBody(buf, res.headers.get("content-type"));
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      headers: outHeaders,
      bodyText,
      bodySize: buf.byteLength,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      statusText: "",
      durationMs,
      headers: {},
      bodyText: "",
      bodySize: 0,
      error: message.includes("aborted") ? `请求超时（${timeoutMs}ms）` : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  if (buf.byteLength === 0) return "";
  const bytes = new Uint8Array(buf);
  const isText =
    !contentType ||
    /json|text|xml|html|javascript|yaml|csv|form-urlencoded/i.test(contentType);
  if (!isText) {
    return `[二进制 ${buf.byteLength} 字节，未显示]`;
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return `[无法解码为 UTF-8，${buf.byteLength} 字节]`;
  }
}