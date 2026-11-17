# 浏览器 / App 真实流量抓包

原理：**HTTPS 代理（mitmproxy）解密流量** → addon 转成 JSON → **POST 到 ATP Ingest** → 桌面「抓包」列表展示。

## 一、准备

```powershell
cd "D:\Document\AI LAB\API-Test-Automation-Platform"
.\.venv\Scripts\activate
pip install -r requirements-capture.txt
```

桌面端：**新建会话 → 选中会话 → 启动 Ingest**（记下 `http://127.0.0.1:8765/ingest`）。

## 二、启动 mitm 代理

```powershell
$env:ATP_INGEST_URL="http://127.0.0.1:8765/ingest"
# 只收录部分域名（可选）
# $env:ATP_CAPTURE_HOSTS="api.example.com,httpbin.org"

mitmdump -s scripts/mitm_ingest_addon.py --listen-host 0.0.0.0 --listen-port 8888
```

或在桌面点 **「启动 MITM 代理」**（需已安装 mitmproxy 且在 PATH）。

## 三、浏览器（Chrome / Edge）

1. 系统或浏览器代理：`127.0.0.1` **端口 8888**
2. **证书（推荐）**：桌面「抓包」→ **一键安装 MITM 证书**（写入 `Cert:\CurrentUser\Root`，等效于 mitm.it 安装并信任）
   - 或命令行：`powershell -ExecutionPolicy Bypass -File scripts/install_mitm_ca.ps1`
   - 或备用：代理开启后访问 [http://mitm.it](http://mitm.it) 手动下载
3. **重启浏览器** 后访问 HTTPS 站点
4. 正常浏览/操作你的 Web 应用
4. 回到桌面 **抓包** 页，流量列表自动刷新

> 仅对 **测试/预发** 环境使用；勿对不明站点安装 MITM 证书。

## 四、手机 App（同 WiFi）

1. 查电脑局域网 IP：`ipconfig` → 如 `192.168.1.100`
2. 手机 Wi‑Fi → 代理 **手动**：主机 `192.168.1.100`，端口 **8888**
3. 手机浏览器打开 `http://mitm.it` 安装 **Android / iOS** 证书（iOS 还需：设置 → 通用 → 关于 → 证书信任设置）
4. 打开 App 操作；流量写入当前 Ingest 会话

部分 App 有 **证书锁定（SSL Pinning）** 无法直接 mitm，需专项绕过（仅合规测试场景）。

## 五、Windows 桌面 App / 小程序开发者工具

- 在应用或开发者工具里配置 HTTP 代理为 `127.0.0.1:8888`（若有选项）
- 无法改代理的进程：用 **Proxifier** 等把进程流量导到 8888（进阶）

## 六、结束

1. 桌面 **停止 Ingest**（或停止并关闭会话）
2. `Ctrl+C` 结束 mitmdump
3. 关闭系统/手机代理，避免上不了网

## 七、环境变量

| 变量 | 含义 |
|------|------|
| `ATP_INGEST_URL` | Ingest 地址，须与桌面一致 |
| `ATP_CAPTURE_HOSTS` | 逗号分隔域名过滤，空=全收录 |
| `ATP_CAPTURE_BODY_MAX` | addon 单条 body 预览上限（默认 16384） |

敏感头在 ingest 侧按 `platform.config.yaml` 的 `capture.redact_headers` 脱敏。