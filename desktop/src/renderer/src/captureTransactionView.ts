export type CaptureTxResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  duration_ms?: number;
};

export type CaptureTxRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type CaptureTransaction = {
  id?: string;
  request?: CaptureTxRequest;
  response?: CaptureTxResponse;
  websocket?: {
    from_client?: boolean;
    type?: string;
    body?: string;
  };
};

export function asCaptureTransaction(tx: unknown): CaptureTransaction | null {
  if (!tx || typeof tx !== "object") return null;
  return tx as CaptureTransaction;
}

function isBinaryBodyObject(body: Record<string, unknown>): boolean {
  return body._encoding === "base64" && typeof body._base64 === "string";
}

export function sniffImageMime(
  body: unknown,
  headers?: Record<string, string>,
): string | undefined {
  const fromHdr = pickContentType(headers)?.toLowerCase();
  if (fromHdr?.startsWith("image/")) return fromHdr;

  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if (typeof o.content_type === "string" && o.content_type.toLowerCase().startsWith("image/")) {
      return o.content_type.split(";")[0]?.trim().toLowerCase();
    }
    if (isBinaryBodyObject(o)) {
      try {
        const head = atob(String(o._base64).slice(0, 32));
        if (head.startsWith("GIF8")) return "image/gif";
        if (head.charCodeAt(0) === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
      } catch {
        /* ignore */
      }
    }
  }

  if (typeof body === "string" && body.length >= 4) {
    if (body.startsWith("GIF8")) return "image/gif";
    if (body.charCodeAt(0) === 0x89 && body.slice(1, 4) === "PNG") return "image/png";
    if (body.startsWith("RIFF") && body.includes("WEBP")) return "image/webp";
    if (body.charCodeAt(0) === 0xff && body.charCodeAt(1) === 0xd8) return "image/jpeg";
  }
  return undefined;
}

function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function bytesFromLatin1String(s: string): Uint8Array | null {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255) return null;
    out[i] = c;
  }
  return out;
}

/** 抓包响应体 → 图片 data URL（base64 存储或 latin1 遗留格式） */
export function captureBodyImageSrc(
  headers: Record<string, string> | undefined,
  body: unknown,
): string | null {
  const mimeHint = sniffImageMime(body, headers) ?? "image/*";

  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if (isBinaryBodyObject(o)) {
      const b64 = String(o._base64);
      const mime =
        pickContentType(headers)?.toLowerCase() ??
        (typeof o.content_type === "string" ? o.content_type.split(";")[0]?.trim().toLowerCase() : null) ??
        sniffImageMime(body, headers) ??
        "application/octet-stream";
      if (!mime.startsWith("image/")) return null;
      return `data:${mime};base64,${b64}`;
    }
    return null;
  }

  if (typeof body !== "string" || !body.length || body.length > 4_000_000) return null;

  const mime = sniffImageMime(body, headers);
  if (!mime?.startsWith("image/")) return null;

  try {
    const bytes = bytesFromLatin1String(body);
    if (!bytes) {
      const fallback = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) fallback[i] = body.charCodeAt(i) & 0xff;
      return uint8ToDataUrl(fallback, mime);
    }
    return uint8ToDataUrl(bytes, mime);
  } catch {
    return null;
  }
}

export function formatCaptureBodyText(
  body: unknown,
  headers?: Record<string, string>,
): string {
  if (body == null || body === "") return "(无响应体)";
  if (typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (isBinaryBodyObject(o)) {
      const len = typeof o.length === "number" ? o.length : undefined;
      const mime =
        (typeof o.content_type === "string" ? o.content_type : pickContentType(headers)) ?? "二进制";
      const tail = o.truncated ? "（抓包预览已截断）" : "";
      if (mime.toLowerCase().startsWith("image/")) {
        return `[图片 ${mime}，${len ?? "?"} 字节${tail}，见上方预览]`;
      }
      return `[二进制 ${mime}，${len ?? "?"} 字节${tail}]`;
    }
    if (typeof o._base64_note === "string") {
      const len = typeof o.length === "number" ? o.length : undefined;
      return `[二进制内容，${len ?? "未知"} 字节；旧版抓包未内联数据，请重新抓包]`;
    }
    return JSON.stringify(body, null, 2);
  }
  const text = String(body);
  const img = sniffImageMime(text, headers);
  if (img) {
    return `[${img}，${text.length} 字节；若未显示预览请重新抓包以使用 base64 存储]`;
  }
  const trim = text.trim();
  if ((trim.startsWith("{") || trim.startsWith("[")) && trim.length < 512_000) {
    try {
      return JSON.stringify(JSON.parse(trim), null, 2);
    } catch {
      /* plain text */
    }
  }
  if (isLikelyBinaryString(text)) {
    return `[二进制文本 ${text.length} 字节，不宜直接阅读]`;
  }
  return text;
}

export function formatCaptureHeaders(headers: Record<string, string> | undefined): string {
  if (!headers || !Object.keys(headers).length) return "(无)";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function headerEntries(headers: Record<string, string> | undefined): Array<[string, string]> {
  if (!headers) return [];
  return Object.entries(headers).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function pickContentType(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "content-type") return v.split(";")[0]?.trim();
  }
  return undefined;
}

export function estimateBodyBytes(body: unknown): number | undefined {
  if (body == null || body === "") return 0;
  if (typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.length === "number") return o.length;
    return new TextEncoder().encode(JSON.stringify(body)).length;
  }
  return new TextEncoder().encode(String(body)).length;
}

export function isLikelyBinaryString(s: string): boolean {
  if (s.length < 8) return false;
  if (s.startsWith("GIF8")) return true;
  const sample = Math.min(s.length, 400);
  let control = 0;
  for (let i = 0; i < sample; i++) {
    const c = s.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 127) control += 1;
  }
  return control / sample > 0.08;
}

export function responseStatusTone(status: number | undefined): "ok" | "warn" | "err" | "muted" {
  if (!status) return "muted";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400) return "err";
  if (status >= 300) return "warn";
  return "muted";
}