/** 尝试将响应体解析为 JSON（含 content-type 缺失时的启发式） */
export function parseResponseJson(bodyText: string, contentType?: string): unknown | null {
  const text = bodyText?.trim();
  if (!text) return null;
  const looksJson = text.startsWith("{") || text.startsWith("[");
  const ctJson = contentType ? /json/i.test(contentType) : false;
  if (!looksJson && !ctJson) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}