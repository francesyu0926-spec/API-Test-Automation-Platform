export type JsonPreviewParse = {
  value: unknown | null;
  /** 文本被截断或非完整 JSON，仅用于可视化/格式化 */
  partial: boolean;
};

function closeOpenJsonBrackets(slice: string): string {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;
  for (const ch of slice) {
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" && stack[stack.length - 1] === "{") stack.pop();
    else if (ch === "]" && stack[stack.length - 1] === "[") stack.pop();
  }
  let out = slice.replace(/,\s*$/, "");
  while (stack.length) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

/** 从可能被截断的预览文本中尽量解析出完整 JSON 子树（如 4KB body_preview） */
export function parseJsonPreview(bodyText: string): JsonPreviewParse {
  const text = bodyText?.trim() ?? "";
  if (!text) return { value: null, partial: false };

  try {
    return { value: JSON.parse(text), partial: false };
  } catch {
    // fall through
  }

  if (!text.startsWith("{") && !text.startsWith("[")) {
    return { value: null, partial: false };
  }

  const cuts: number[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "}" || ch === "]") cuts.push(i);
  }

  for (let ci = cuts.length - 1; ci >= 0; ci--) {
    const end = cuts[ci]!;
    const slice = closeOpenJsonBrackets(text.slice(0, end + 1).trimEnd());
    try {
      return { value: JSON.parse(slice), partial: true };
    } catch {
      continue;
    }
  }

  return { value: null, partial: false };
}

/** 尝试将响应体解析为 JSON（含 content-type 缺失时的启发式与截断修复） */
export function parseResponseJson(bodyText: string, contentType?: string): unknown | null {
  const text = bodyText?.trim();
  if (!text) return null;
  const looksJson = text.startsWith("{") || text.startsWith("[");
  const ctJson = contentType ? /json/i.test(contentType) : false;
  if (!looksJson && !ctJson) return null;

  return parseJsonPreview(text).value;
}

/** 南财等业务层 HTTP 200 但 JSON code=401「未登录」 */
export function businessLoginHintFromBody(bodyText: string): string | null {
  const parsed = parseResponseJson(bodyText);
  if (!parsed || typeof parsed !== "object" || parsed === null) return null;
  const code = (parsed as { code?: unknown }).code;
  const msg = String((parsed as { msg?: unknown }).msg ?? "");
  if (code !== 401 && code !== "401") return null;
  if (!msg.includes("未登录") && !msg.toLowerCase().includes("login")) return null;
  return `业务未登录（JSON code=401）：会话 token 可能已过期。请点「配置变量」更新 token，或在抓包选中请求后「保存为用例」以同步鉴权。`;
}