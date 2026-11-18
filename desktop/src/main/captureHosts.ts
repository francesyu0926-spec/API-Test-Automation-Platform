/** 常用站点域名预设（PAC 仅把这些域名路由到 mitm） */
export const CAPTURE_HOST_PRESETS: Record<string, string[]> = {
  deepseek: ["deepseek.com", "chat.deepseek.com", "api.deepseek.com", "www.deepseek.com"],
  baidu: ["baidu.com", "www.baidu.com", "m.baidu.com", "sp0.baidu.com", "sp1.baidu.com"],
  httpbin: ["httpbin.org"],
};

function tokenToHost(token: string): string {
  let t = token.trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) {
    t = `http://${t}`;
  }
  try {
    return new URL(t).hostname.toLowerCase();
  } catch {
    return token
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0]
      .replace(/:\d+$/, "");
  }
}

/** 支持完整 URL、带 path 的 host、逗号分隔多域 */
export function parseCaptureHostList(input: string): string[] {
  const parts = input.split(/[,;\n]+/).flatMap((chunk) => chunk.split(/\s+/));
  return [...new Set(parts.map(tokenToHost).filter(Boolean))];
}

/** 无输入时不注入默认域名，由调用方校验或提示用户填写 */
export function hostsForPac(input: string): string[] {
  return parseCaptureHostList(input);
}