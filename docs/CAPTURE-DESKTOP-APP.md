# 抓取桌面客户端流量

浏览器（Chrome/Edge）走 **Internet 选项** 里的系统代理。许多 **金融终端 / .NET 客户端** 使用 **WinHTTP**，与浏览器设置分离。

本平台在「开始抓包」时会同时设置：

1. 系统代理（WinINet）→ `127.0.0.1:8888`
2. **WinHTTP** → `netsh winhttp set proxy 127.0.0.1:8888`

## 代理模式

| 模式 | 适用 |
|------|------|
| **PAC（按域名）** | **桌面终端（推荐）**：仅填写的 API 主机走 mitm，其它直连，不易白屏 |
| 内嵌网页（广域 PAC） | 应用内 **WebView/H5**：公网 HTTP(S) 走 mitm；「直连」仅放 CDN/壳资源 |
| 全局代理 | 易 Connecting，不推荐 |

**勿**把业务 API 域名填在「内嵌网页 → 直连」里——该模式下直连 = 不经 mitm，列表会一直是空的。

抓包页可点 **「项目 PAC 模板」**（标签可在 `project.yaml` 用 `capture.template_label` 自定义）一键填入主机。

## PAC 配置（通用）

### 项目级（推荐）

在 `projects/<id>/project.yaml`：

```yaml
capture:
  template_label: 终端 API PAC   # 可选，按钮文案
  pac_hosts:
    - api.example.com
    - cdn-client.example.com
```

未配置 `pac_hosts` 时，桌面端会从该项目环境文件（如 `environments/dev.yaml`）中的 `base_url`、`api_url` 等变量**自动推导**主机名。

### 平台级预设

在仓库根 `platform.config.yaml`：

```yaml
capture:
  pac_presets:
    - id: corp-api
      label: 公司 API
      hosts: api.example.com,www.example.com
```

抓包页「全局预设」下拉可填入，与当前项目无关。

## 推荐步骤

1. 安装 MITM 证书（并信任根证书）
2. 选 **PAC（按域名）**，填写 API 主机（或点 **项目 PAC 模板**）
3. **开始抓包**（MITM / 代理均为「开」）
4. **完全退出** 目标客户端（任务管理器确认无残留进程）
5. 重新打开客户端，在客户端内操作要抓的业务
6. 在本软件流量列表查看（可先关「仅 API」）
7. 结束后 **停止并恢复上网**（会 `winhttp reset proxy`）

## 仍无流量时

| 原因 | 说明 |
|------|------|
| 未重启客户端 | 旧进程不会重新读代理 |
| 证书未信任 | HTTPS 握手失败，mitm 无完整记录 |
| 直连 / 自定义协议 | 客户端硬编码不走系统代理 |
| SSL Pinning | 无法中间人解密，需用浏览器版或放弃 |
| 需管理员 | 少数环境 `netsh winhttp` 需以管理员运行桌面端 |

可在 PowerShell 检查：`netsh winhttp show proxy` 应显示 `127.0.0.1:8888`。

备选：用 Chrome 打开同一 **Web 版** 接口，或向厂商确认终端是否支持 HTTP 代理设置。