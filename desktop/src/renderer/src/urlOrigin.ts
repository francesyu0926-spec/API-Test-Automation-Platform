/** 从完整请求 URL 提取 dev 环境常用的 base_url（scheme + host，无尾斜杠） */
export function originFromRequestUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed) && !/^wss?:\/\//i.test(trimmed)) return null;
  try {
    const normalized = trimmed.replace(/^ws(s?):\/\//i, "http$1://");
    const u = new URL(normalized);
    if (!u.host) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}