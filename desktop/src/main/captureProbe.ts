import { execFileSync } from "node:child_process";

/** 经本机 mitm 访问 HTTPS，验证代理与证书是否可用 */
export function probeHttpsViaMitm(
  url: string,
  port = 8888,
): { ok: boolean; detail: string } {
  try {
    const code = execFileSync(
      "curl.exe",
      [
        "-x",
        `http://127.0.0.1:${port}`,
        "-k",
        "-sS",
        "-o",
        "NUL",
        "-w",
        "%{http_code}",
        "--max-time",
        "20",
        url,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 25000 },
    ).trim();
    const n = Number(code);
    const ok = !Number.isNaN(n) && n >= 200 && n < 400;
    return { ok, detail: `HTTP ${code}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg.includes("curl") ? "未找到 curl.exe" : msg.slice(0, 120) };
  }
}