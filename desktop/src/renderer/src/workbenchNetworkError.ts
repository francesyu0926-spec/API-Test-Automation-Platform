import type { HttpSendResult } from "../../shared/apiWorkbenchTypes";

export type WorkbenchTransportKind = "tls" | "dns" | "timeout" | "proxy" | "network";

export type WorkbenchTransportErrorView = {
  kind: WorkbenchTransportKind;
  title: string;
  primaryMessage: string;
  detailLines: string[];
  guidance: string;
  statusLabel: string;
};

export function isWorkbenchTransportFailure(res: HttpSendResult): boolean {
  return res.status === 0 && Boolean(res.error?.trim());
}

export function parseWorkbenchTransportError(error: string): WorkbenchTransportErrorView {
  const trimmed = error.trim();
  const parts = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const primaryMessage = parts[0] ?? trimmed ?? "网络请求失败";
  const detailLines = parts.slice(1);
  const blob = trimmed.toLowerCase();

  let kind: WorkbenchTransportKind = "network";
  if (/certificate|cert|ssl|tls|secure tls connection/i.test(blob)) {
    kind = "tls";
  } else if (/ENOTFOUND|域名无法解析|getaddrinfo/i.test(blob)) {
    kind = "dns";
  } else if (/请求超时|ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(blob)) {
    kind = "timeout";
  } else if (/抓包代理|mitm|系统代理|windows 系统代理/i.test(blob)) {
    kind = "proxy";
  }

  const title =
    kind === "tls"
      ? "网络连接失败（TLS 握手未通过）"
      : kind === "dns"
        ? "网络连接失败（域名无法解析）"
        : kind === "timeout"
          ? "网络连接失败（超时）"
          : kind === "proxy"
            ? "网络连接失败（代理相关）"
            : "网络连接失败";

  const statusLabel = "请求失败";

  let guidance: string;
  switch (kind) {
    case "tls":
      guidance = "内网自签或不受信任的证书：可开启「忽略证书校验」后重新 Send，或在系统中安装对应 CA。";
      break;
    case "dns":
      guidance = "请检查主机名拼写、DNS 或本机 hosts；若仅内网可访问，请确认已连 VPN。";
      break;
    case "timeout":
      guidance = "服务器未在时限内响应；可检查网络、防火墙，或适当增大超时时间。";
      break;
    case "proxy":
      guidance = "若不需要走代理，请在 Windows 中关闭系统代理，或在「抓包」中使用「仅恢复上网」。";
      break;
    default:
      guidance = "请核对 URL、网络与目标服务是否可达；可用浏览器打开同一地址对比。";
  }

  return { kind, title, primaryMessage, detailLines, guidance, statusLabel };
}

export type TransportTechnicalLog = {
  english: string;
  supplement: string;
  clipboardText: string;
};

/** 展开区专用：英文栈 + 精简中文，避免与卡片引导重复 */
export function formatTransportTechnicalLog(
  fullLog: string,
  kind: WorkbenchTransportKind,
): TransportTechnicalLog {
  const parts = fullLog.trim().split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const english = parts[0] ?? fullLog.trim();

  let supplement: string;
  switch (kind) {
    case "tls":
      supplement = "TLS 证书校验失败。请尝试开启上方开关。";
      break;
    case "dns":
      supplement = "DNS 解析失败，请核对主机名与网络。";
      break;
    case "timeout":
      supplement = "连接或读取超时。";
      break;
    case "proxy":
      supplement = "可能与系统代理或抓包代理有关。";
      break;
    default:
      supplement =
        parts
          .slice(1)
          .filter((line) => /[\u4e00-\u9fff]/.test(line))
          .join(" ")
          .trim() || "见上方操作建议。";
  }

  const clipboardText = supplement ? `${english}\n${supplement}` : english;
  return { english, supplement, clipboardText };
}