# API Test Automation Platform（纯文件，无 SQLite）

所有状态落在仓库目录：`projects/` 存用例与环境，`runs/` 存执行结果，`captures/` 存抓包（默认 gitignore）。

## 约定（必须遵守）

1. **索引单写者**：仅一个进程更新 `runs/index.json`、`captures/<session>/index.json`（CLI 顺序执行；CI 每个 job 写独立 run 目录，最后在单 job 里合并 index 或接受各 job 只写子目录）。
2. **原子写**：先写 `*.tmp`，再 `os.replace` 为正式文件（见 `atp/store.py`）。
3. **先明细后摘要**：先写 `runs/<id>/steps/*`，最后写 `summary.json`，再更新 index。
4. **密钥**：只用 `environments/*.local.yaml` 或环境变量，勿提交 Git。

详细说明见 [docs/FILE-STORE.md](docs/FILE-STORE.md)。

## 快速开始

```powershell
cd "D:\Document\AI LAB\API-Test-Automation-Platform"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

python -m atp.cli run -p example-service -s smoke -e dev
python -m atp.cli runs list
```

## 浏览器 / App 真实流量

安装 mitmproxy 后见 [docs/CAPTURE-REAL-TRAFFIC.md](docs/CAPTURE-REAL-TRAFFIC.md)；桌面「抓包」页可一键启停 MITM 代理。

```powershell
pip install -r requirements-capture.txt
```

## 抓包 ingest

```powershell
python -m atp.cli capture-start -p example-service --label manual
# 记下输出的 session 目录名
python -m atp.cli capture-serve -p example-service <session-id>
# 向 http://127.0.0.1:8765/ingest POST JSON（见 schemas/capture-transaction.schema.json）
```

## Electron 前端

桌面端在 `desktop/`，通过主进程读取仓库内 JSON/YAML，并调用 `python -m atp.cli run` 执行（**仍无 SQLite**）。

```powershell
cd desktop
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # 国内下载 Electron 失败时
npm install
npm run dev
```

若安装报 `CERT_HAS_EXPIRED` 且指向 `registry.npm.taobao.org`，本目录 `desktop/.npmrc` 已改用 `registry.npmmirror.com`；全局仍指向旧源时需改用户级 npm 配置。

`npm run dev` 若报 **`Error: Electron uninstall`**，说明 Electron 二进制未装好（常见于 `npm install --ignore-scripts`）。在 `desktop` 目录执行：

```powershell
npm run electron:install
```

或手动：`node node_modules/electron/install.js`（网络不通时用 `npm run electron:install`，脚本会经 GitHub 镜像下载）。

可选环境变量 `ATP_REPO_ROOT` 指向平台仓库根目录（默认 `desktop` 的上一级）。

开发构建：`npm run build`（输出在 `desktop/out/`）。

**Windows 安装包 / 便携 exe**（在 `desktop` 目录）：

```powershell
npm install
npm run pack:win
```

产物在 `desktop/release/`：**标准版** `npm run pack:win`（`platform/` + Electron，需本机 Python/JMeter）；**完整版 POC** `npm run pack:win:full`（另打包 `runtime/python` 与 `runtime/jmeter`，见 [docs/ROADMAP-DELIVERY.md](docs/ROADMAP-DELIVERY.md)）。

桌面端模块划分、工作区与跨页面操作见 [docs/DESKTOP-UX.md](docs/DESKTOP-UX.md)。  
**产品说明书（客户版，含截图）**：Markdown [docs/PRODUCT-MANUAL.md](docs/PRODUCT-MANUAL.md) · 可直接打开 [docs/PRODUCT-MANUAL.html](docs/PRODUCT-MANUAL.html) 或交付 [docs/PRODUCT-MANUAL.pdf](docs/PRODUCT-MANUAL.pdf)（约 1.3 MB）。

## 目录结构

```text
desktop/          # Electron + React（electron-vite）
projects/<id>/{project.yaml, environments/, cases/, suites/, captures/}
runs/{index.json, by-month/, <run-id>/{summary.json, steps/}}
schemas/          # JSON Schema
atp/              # CLI 与执行引擎
```