import { getWindowsProxyStatus, isLikelyAtpCaptureProxy, isPortListening } from "./windowsProxy";
import { getMitmStatus, resolveMitmBinary } from "./captureService";
import { getIngestStatus } from "./captureService";

export async function runCaptureDiagnostics(mitmPort = 8888): Promise<{
  mitmBinary: string | null;
  mitmRunning: boolean;
  portListening: boolean;
  proxy: { enabled: boolean; server: string; autoConfigUrl?: string };
  ingestRunning: boolean;
  issues: string[];
  fixes: string[];
}> {
  const mitmBinary = await resolveMitmBinary();
  const mitmRunning = getMitmStatus().running;
  const portListening = await isPortListening(mitmPort);
  const proxy = getWindowsProxyStatus();
  const ingest = getIngestStatus();
  const issues: string[] = [];
  const fixes: string[] = [];

  if (!mitmBinary) {
    issues.push("未安装 mitmproxy（.venv 内无 mitmdump）");
    fixes.push("在项目根目录执行: .\\.venv\\Scripts\\pip install -r requirements-capture.txt");
  }
  const atpProxy = isLikelyAtpCaptureProxy(
    { enabled: proxy.enabled, server: proxy.server, autoConfigUrl: proxy.autoConfigUrl ?? "" },
    mitmPort,
  );

  if (!mitmRunning) {
    issues.push("MITM 未运行");
    fixes.push("抓包页点「开始抓包」，或点「仅恢复上网」关闭残留代理");
  }
  if (!portListening && atpProxy && (proxy.enabled || (proxy.autoConfigUrl ?? "").trim())) {
    issues.push("系统代理/PAC 仍指向抓包，但 8888 无监听（浏览器或南财等客户端可能一直 Connecting）");
    fixes.push("点侧栏「恢复上网」或抓包页「仅恢复上网」；完全退出南财后重开");
  } else if (!portListening && mitmRunning) {
    issues.push(`本机 ${mitmPort} 端口无监听（mitm 可能已闪退）`);
    fixes.push("查看终端 mitmdump 报错；重装 requirements-capture.txt");
  }
  if (!ingest.running && mitmRunning) {
    issues.push("Ingest 未启动（流量无法写入会话）");
    fixes.push("先停止再重新「开始抓包」");
  }
  if (!proxy.enabled && mitmRunning) {
    issues.push("系统代理未开：浏览器不会走 8888，列表仅有「测试写入」");
    fixes.push("勾选「自动设置系统代理」后重新开始抓包");
  }

  fixes.push("Chrome：chrome://flags 搜索 QUIC → 已禁用，否则百度等站点不经 8888");
  fixes.push("装证书会自动软重启 Chrome；失败时点「软重启 Chrome」");
  if (mitmRunning && portListening && ingest.running) {
    fixes.push("访问 www.baidu.com 后仍无记录：确认未用 360/小浏览器，且抓包时状态为 MITM 开");
  }

  return {
    mitmBinary,
    mitmRunning,
    portListening,
    proxy,
    ingestRunning: ingest.running,
    issues,
    fixes,
  };
}