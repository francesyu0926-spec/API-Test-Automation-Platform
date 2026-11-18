import type { WebContents } from "electron";
import WebSocket from "ws";

import type { WsConnectPayload, WsEvent, WsSendPayload } from "../shared/apiWorkbenchTypes";

type Session = { ws: WebSocket; wc: WebContents };

const sessions = new Map<string, Session>();

function emit(wc: WebContents, ev: WsEvent): void {
  if (wc.isDestroyed()) return;
  wc.send("atp:wsEvent", ev);
}

export function wsConnect(payload: WsConnectPayload, wc: WebContents): { ok: boolean; error?: string } {
  const { connectionId, url, headers } = payload;
  wsClose(connectionId);

  if (!/^wss?:\/\//i.test(url.trim())) {
    return { ok: false, error: "WebSocket URL 须以 ws:// 或 wss:// 开头" };
  }

  try {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 20_000 });
    const session: Session = { ws, wc };
    sessions.set(connectionId, session);

    ws.on("open", () => {
      emit(wc, { connectionId, type: "open" });
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        emit(wc, {
          connectionId,
          type: "message",
          data: buf.toString("utf8"),
          binary: true,
          binarySize: buf.byteLength,
        });
      } else {
        emit(wc, { connectionId, type: "message", data: data.toString() });
      }
    });

    ws.on("close", (code, reason) => {
      emit(wc, { connectionId, type: "close", code, reason: reason.toString("utf8") });
      sessions.delete(connectionId);
    });

    ws.on("error", (err) => {
      emit(wc, { connectionId, type: "error", error: err.message });
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function wsSend(payload: WsSendPayload): { ok: boolean; error?: string } {
  const session = sessions.get(payload.connectionId);
  if (!session) return { ok: false, error: "连接不存在或已关闭" };
  if (session.ws.readyState !== WebSocket.OPEN) {
    return { ok: false, error: "WebSocket 未处于 OPEN 状态" };
  }
  try {
    session.ws.send(payload.data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function wsClose(connectionId: string): { ok: boolean } {
  const session = sessions.get(connectionId);
  if (!session) return { ok: true };
  try {
    session.ws.close();
  } catch {
    /* ignore */
  }
  sessions.delete(connectionId);
  return { ok: true };
}

export function wsCloseAll(): void {
  for (const id of [...sessions.keys()]) wsClose(id);
}