import { buildUrl } from "./apiWorkbenchModel";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

/** 将 https/http 转为 wss/ws，保留 path 与 query */
export function httpUrlToWsUrl(url: string): string {
  const trimmed = url.trim();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

/** 路径或参数像行情/推送 WebSocket，但用了 HTTP 方法时易 404 */
export function looksLikeWebSocketOverHttp(url: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "POST") return false;
  const u = url.toLowerCase();
  if (/\/ws(\/|$|\?|&)/.test(u)) return true;
  if (/[?&](l|type|channel)=ws[-_]/.test(u)) return true;
  if (u.includes("websocket") || u.includes("/socket")) return true;
  return false;
}

export function resolvedUrlLooksLikeWs(draft: WorkbenchDraft): boolean {
  try {
    const url = buildUrl(draft.url, draft.query);
    return looksLikeWebSocketOverHttp(url, draft.method);
  } catch {
    return false;
  }
}

export function shouldSuggestWsAfterHttp(status: number, url: string, method: string): boolean {
  if (!looksLikeWebSocketOverHttp(url, method)) return false;
  return status === 404 || status === 400 || status === 405 || status === 426;
}