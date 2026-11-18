export type TxRowLike = { url: string; path: string; method: string };

const STATIC_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|mp3)(\?|#|$)/i;

/** 常见静态目录（含上传目录里的文件） */
const STATIC_PATH =
  /\/(img|images|image|static|assets|fonts|media|admin_upload\/sys_files)(\/|$)/i;

/** 常见业务路径（无 /api 前缀的 JSON / 终端接口） */
const BUSINESS_PATH =
  /\/(api|graphql|center|terminal|personal|account|bidding|gym|login|auth|service|rest|rpc|gateway|gw)(\/|$|\?)/i;

/** 常见第三方 H5 / 课程 SaaS API 域名 */
const API_HOST =
  /(\.sfccn\.com|\.xeknow\.com|\.xiaoe-tech\.com|shanxiguandian\.com|learn\.|h5api\.|openapi\.)/i;

function urlHostPath(raw: string): { host: string; pathname: string } | null {
  const u = raw.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u.includes("://") ? u : `https://${u}`);
    return { host: parsed.hostname.toLowerCase(), pathname: parsed.pathname.toLowerCase() };
  } catch {
    return null;
  }
}

export function isLikelyApiTransaction(t: TxRowLike): boolean {
  const u = (t.url || t.path || "").toLowerCase();
  if (!u) return false;
  if (u.startsWith("ws://") || u.startsWith("wss://")) return true;
  if (STATIC_EXT.test(u)) return false;
  if (STATIC_PATH.test(u)) return false;

  if (/\/api(\/|$)/i.test(u)) return true;
  if (/\/graphql(\/|$|\?)/i.test(u)) return true;
  if (BUSINESS_PATH.test(u)) return true;
  if (/\.json(\?|#|$)/i.test(u)) return true;

  const hp = urlHostPath(t.url || u);
  if (hp && API_HOST.test(hp.host)) return true;

  const method = (t.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;

  const pathOnly = (t.path || hp?.pathname || u).toLowerCase();
  if (pathOnly.includes("/") && !/\.\w{2,5}(\?|#|$)/.test(pathOnly)) {
    return true;
  }

  return false;
}

/** 启动抓包时的 MITM 自检请求，不应与业务流量混淆 */
export function isCaptureSelfTestRow(t: TxRowLike): boolean {
  const u = (t.url || "").trim().toLowerCase();
  if (!u) return false;
  if (u.includes("httpbin.org") && u.includes("from=atp-desktop")) return true;
  if (/^https?:\/\/www\.baidu\.com\/?$/i.test(u)) return true;
  return false;
}

export function filterTransactions<T extends TxRowLike>(rows: T[], apiOnly: boolean): T[] {
  const withoutProbe = rows.filter((t) => !isCaptureSelfTestRow(t));
  if (!apiOnly) return withoutProbe;
  return withoutProbe.filter(isLikelyApiTransaction);
}