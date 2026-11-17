export type TxRowLike = { url: string; path: string; method: string };

const STATIC_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|mp3)(\?|#|$)/i;

/** 常见静态目录（含上传目录里的文件） */
const STATIC_PATH =
  /\/(img|images|image|static|assets|fonts|media|admin_upload\/sys_files)(\/|$)/i;

export function isLikelyApiTransaction(t: TxRowLike): boolean {
  const u = (t.url || t.path || "").toLowerCase();
  if (!u) return false;
  if (STATIC_EXT.test(u)) return false;
  if (STATIC_PATH.test(u)) return false;

  if (/\/api(\/|$)/i.test(u)) return true;
  if (/\/graphql(\/|$|\?)/i.test(u)) return true;

  const method = (t.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;

  return false;
}

export function filterTransactions<T extends TxRowLike>(rows: T[], apiOnly: boolean): T[] {
  if (!apiOnly) return rows;
  return rows.filter(isLikelyApiTransaction);
}