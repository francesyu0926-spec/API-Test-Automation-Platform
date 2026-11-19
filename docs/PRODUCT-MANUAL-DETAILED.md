# API Test Platform（ATP）产品说明书

**版本**：0.1.0（桌面端 Electron）  
**适用对象**：测试工程师、后端开发、实施交付人员  
**文档类型**：纯文字说明（不含截图）  
**最后更新**：2026-11-19  

---

## 1. 产品概述

### 1.1 产品定位

API Test Platform（以下简称 **ATP**）是一套面向 API 接口测试与轻量压测的**桌面应用 + 文件仓库**平台。其核心特点：

- **Postman 式交互**：API 工作台调试 HTTP / WebSocket，管理集合与环境变量。
- **YAML 用例驱动**：用例、套件、环境以文件形式保存在仓库，便于 Git 评审与 CI 集成。
- **真实流量反哺**：通过 MITM 抓包将浏览器/App 流量转为用例或集合请求。
- **套件自动化**：按项目、环境批量执行用例，结果逐步落盘。
- **JMeter 压测衔接**：从工作台或集合生成 JMX，本机执行并查看 JTL / 历史。

**无关系型数据库**：状态全部落在磁盘目录（`projects/`、`runs/`、`captures/` 等），由 ATP 引擎原子写入。

### 1.2 技术架构简述

| 层级 | 说明 |
|------|------|
| 桌面壳 | Electron + React（`desktop/`） |
| 执行引擎 | Python 包 `atp`（`python -m atp.cli`） |
| 数据根目录 | 默认仓库根 `ATP_REPO_ROOT`（安装包内 `platform/` 或开发时仓库上一级） |
| 抓包 | mitmproxy（可选依赖 `requirements-capture.txt`） |
| 压测 | 本机 Apache JMeter（标准安装包需自行安装；完整版可内置 runtime） |

### 1.3 导航与快捷键

左侧主导航分为三组（**Alt+数字** 可快速切换）：

| 快捷键 | 模块 | 分组 |
|--------|------|------|
| Alt+1 | API 工作台 | 开发与压测 |
| Alt+2 | 负载测试 | 开发与压测 |
| Alt+3 | 抓包 | 资产与流量 |
| Alt+4 | 项目与用例 | 资产与流量 |
| Alt+5 | 套件执行 | 自动化 |
| Alt+6 | 执行记录 | 自动化 |

左下角 **偏好设置**：配置超大 JTL 的默认流式解析模式（极速 / 深度）。

顶栏展示当前 **工作区 / 项目** 切换（影响环境变量、用例目录、集合路径）。

---

## 2. 安装与启动

### 2.1 Windows 交付物

在 `desktop` 目录执行 `npm run pack:win` 后，在 `release/`（或自定义 `release-build/`）生成：

| 文件 | 用途 |
|------|------|
| `API Test Platform-x.x.x-x64.exe` | NSIS 安装程序（可选安装目录、桌面快捷方式） |
| `API Test Platform-x.x.x-portable-x64.exe` | 绿色便携版 |
| `win-unpacked/API Test Platform.exe` | 解压即运行的未打包目录 |

**完整版**（`npm run pack:win:full`）额外捆绑 Python / JMeter 运行时，适合无外网、无法自备依赖的客户机。

### 2.2 运行依赖（标准版）

- Windows 10/11 x64  
- **Python 3**（用于套件执行、抓包 ingest、CLI）  
- **JMeter**（仅负载测试需要，且路径需在系统或可发现位置）  
- 抓包功能需安装 mitmproxy 及受信任证书（见第 5 章）  

### 2.3 环境变量

| 变量 | 含义 |
|------|------|
| `ATP_REPO_ROOT` | 指向平台数据仓库根（含 `projects/`、`runs/`）；未设置时由安装目录 `resources/platform` 或开发目录推断 |

### 2.4 打包前注意

若 `desktop/release` 下旧版 `app.asar` 被正在运行的 ATP 占用，打包会失败。请先完全退出 ATP 与 `npm run dev`，或指定 `electron-builder` 输出到其它目录。

---

## 3. 数据模型与目录约定

### 3.1 仓库根目录结构

```text
projects/<项目ID>/
  project.yaml          # 项目元数据
  environments/         # dev.yaml、prod.yaml；密钥用 *.local.yaml（勿提交 Git）
  cases/*.yaml          # 可执行用例（请求 + 断言）
  suites/*.yaml         # 套件（用例 ID 列表）
  collections/*.json    # API 工作台集合（多请求 JSON）
  captures/             # 可选，项目级抓包配置
runs/
  index.json            # 执行索引（单写者、原子更新）
  by-month/*.json       # 按月索引
  <run-id>/
    summary.json        # 汇总：通过/失败数、环境、套件名
    steps/*.json        # 逐步请求与断言明细
captures/<session-id>/  # 抓包会话（交易索引、原始流量）
```

### 3.2 用例 YAML 要点

每个 `cases/<名称>.yaml` 通常包含：

- `name`、`description`  
- `request`：`method`、`url`（支持 `{{base_url}}` 等变量）、`headers`、`body`  
- `assertions`：`status`、`duration_ms`、`body_contains` 等  

套件 `suites/<名称>.yaml` 中的 `cases` 数组引用用例文件名（不含扩展名）。

### 3.3 环境与变量

- 公共变量写在 `environments/<env>.yaml` 的 `variables` 段。  
- 敏感值（token、cookie）写入同名 **`*.local.yaml`**，与公共文件合并后参与替换。  
- 工作台 Send、套件执行、负载测试采样器均解析 `{{变量名}}`；未定义时 ATP 会提示打开环境变量面板。

### 3.4 集合 JSON

`collections/<模块ID>.json` 保存 Postman 风格请求列表：`id`、`name`、`method`、`url`、`headers`、`body`、**`preRequestScript` / `testScript`**（工作台 Scripts 页）等。  
保存到集合时可同步写出对应 YAML 用例（便于套件执行）。

---

## 4. API 工作台（Alt+1）

### 4.1 功能总览

API 工作台用于单请求调试与集合管理，支持：

- HTTP 全部常见方法；**WebSocket**（`wss://` Connect / Send / 消息日志）  
- Params、Headers、Body（raw + Content-Type）  
- **Scripts**：Before request / After response（Postman 式 `pm.*`）  
- 响应：**Body**（可视化表格 / JSON 文本）、**Headers**、**Tests**（脚本断言 + Console）  
- 环境变量解析、TLS 忽略、业务登录提示（根据响应体引导配置 token）  
- **保存到集合**、同步 YAML 用例、导入 **cURL**、删除请求/分组  
- 响应 JSON **可视化勾选导出**（CSV / Excel 等）  

### 4.2 布局说明

- **左侧**：集合模块选择、请求列表（按文件夹分组）、新建/删除集合。  
- **中部上方**：协议切换（HTTP / WS）、方法、URL、Send。  
- **元信息行**：请求名称、分组；保存、更多操作（生成 cURL、删除等）。  
- **请求区标签**：Params · Headers · Body · **Scripts**（仅 HTTP）。  
- **可拖动分隔条**：调整请求区与响应区高度。  
- **响应区**：状态码、耗时、大小；Body 可视化与格式化开关。  

### 4.3 Params 与 Headers

- 表格编辑键值对，支持启用/禁用行、批量编辑、拖拽排序。  
- Headers 计数显示在标签上。  
- URL 与 Query 联动；Send 前合并生效。  

### 4.4 Body

- 模式：`none` / `raw`。  
- Raw 支持 Content-Type 选择（JSON、表单、XML 等）。  
- WebSocket 下 Body 标签为 **Message**（发送内容）。  

### 4.5 Scripts（HTTP）

#### 4.5.1 入口

打开 **Scripts** 标签后，左侧为 **Before request** / **After response**（样式与主侧栏菜单一致），右侧为 **带语法高亮的 JavaScript 编辑器**（行号、关键字与字符串着色）。

#### 4.5.2 执行时机

1. 点击 **Send** 后，若存在 Before request 脚本，先执行；失败则中止请求并提示。  
2. 发送 HTTP 请求。  
3. 若存在 After response 脚本，在收到响应后执行。  

脚本可修改请求 URL/Method/Body/Headers，以及环境变量（仅当次 Send 与后续变量合并逻辑以实际实现为准）。

#### 4.5.3 `pm` 与 `console` API（子集）

| 对象 / 方法 | 阶段 | 说明 |
|-------------|------|------|
| `pm.environment.get/set/unset` | 两阶段 | 读写当前环境变量 |
| `pm.variables.*` | 两阶段 | 同上（别名） |
| `pm.request.url/method/body` | Before | 读写请求草稿 |
| `pm.request.headers.add/upsert/remove` | Before | 增删改 Header |
| `pm.response.code/status/responseTime` | After | 响应元数据 |
| `pm.response.json()` / `text()` | After | 响应体 |
| `pm.test(name, fn)` | After | 注册测试项 |
| `pm.expect(x).to.eql(y)` 等 | After | 简单断言 |
| `console.log/info/warn/error` | 两阶段 | 输出到 Tests 页 **Console** |

#### 4.5.4 Tests 与 Console 展示

- 响应区 **Tests** 标签：列出 `pm.test` 通过/失败；若有日志或测试，Send 后自动切到该标签。  
- **Console** 区块：`console.*` 输出；若内容为 JSON，支持 **可视化表格** 与 **JSON 文本** 切换。  
- 标签角标示例：`Tests (1/1)` 或 `Tests · 2 log`。  

### 4.6 响应 Body

- **可视化**：嵌套 JSON 展平为可浏览表格，可选行导出。  
- **JSON / Raw**：语法高亮代码块；可切换压缩/格式化。  
- 图片响应内联预览；传输错误卡片（TLS、DNS、超时）支持重试与「忽略证书」选项。  

### 4.7 保存与用例同步

- **保存**：写入当前集合 JSON；若请求已关联用例 stem，可同时更新 `cases/*.yaml`。  
- 需填写 **请求名称**；可选 **分组**（文件夹）。  
- 支持从 **项目与用例** 注入草稿到工作台（打开工作台编辑）。  

### 4.8 导入 cURL

从剪贴板或对话框粘贴 cURL，解析为草稿；若解析出 Authorization，可提示写入环境变量。

### 4.9 WebSocket

- URL 使用 `wss://`；Connect 后下方为 **Messages** 日志（入站/出站/系统）。  
- HTTP 探测返回 404 等时，可提示切换 WS 模式。  

---

## 5. 抓包（Alt+3）

### 5.1 用途

在真实浏览器或 App 代理下录制 HTTPS 流量，筛选 API 调用，生成 **YAML 用例** 或 **推送到 API 工作台**。

### 5.2 代理模式

| 模式 | 行为 |
|------|------|
| PAC（按域名） | 仅配置的 API 域名走 MITM，其余直连 |
| 内嵌网页 | 广域 PAC，适合 WebView / 壳应用 |
| 全局代理 | 全部流量经代理（部分客户端易白屏） |

需安装 mitmproxy 根证书；界面提供证书安装与自检指引。

### 5.3 会话与交易列表

- 按 **抓包会话** 列出已录制交易（时间、方法、URL、状态）。  
- 支持搜索、分页、多选。  
- 详情标签：**Response**、**Request**、**cURL**、**YAML**、**Raw**。  

### 5.4 生成资产

- **单条保存为用例**：写入当前项目的 `cases/`。  
- **批量保存**：多选交易，统一环境/命名规则。  
- **发送到工作台**：将单条转为草稿立即调试。  
- 可从抓包响应中 **提取鉴权** 写入环境（与采样器逻辑一致）。  

### 5.5 运维提示

- 抓包自测行（mitm 自身）可过滤。  
- 启动失败时展示 **CaptureStartupIssue** 检查项（端口占用、二进制缺失等）。  

---

## 6. 项目与用例（Alt+4）

### 6.1 功能总览

管理测试资产：**项目**、**YAML 用例**、**API 集合**、环境与 OpenAPI 导入/导出。

顶栏操作：**新建项目**、**OpenAPI 导入**、**OpenAPI 导出**、**删除项目**、**打开工作台**。

### 6.2 列表双模式

| 标签 | 内容 |
|------|------|
| YAML | `cases/*.yaml` 文件名列表，选中后右侧编辑/预览 YAML |
| 集合 | 各集合模块中的请求行（方法标签 + 名称） |

**集合列表去重**：与已有 YAML 同 stem、同 URL 指纹、或 `case:` 镜像请求不再重复展示；计数为去重后数量。若全部为 YAML 镜像，显示「与 YAML 用例重复」说明。

### 6.3 用例编辑

- 右侧 YAML 编辑器（语法高亮预览区可选）。  
- 新建用例、删除用例、保存。  
- **在工作台编辑**：将用例转为工作台草稿。  
- 从集合行可 **编辑**（工作台）或 **从集合移除**。  

### 6.4 导出 JMX

可将当前用例、全部用例或集合请求导出为 JMeter **JMX** 文件（对话框配置线程组等）。

### 6.5 OpenAPI

- **导入**：从 OpenAPI 3 创建项目或往项目写入请求/用例（与对话框选项相关）。  
- **导出**：多选项目下 YAML 与集合请求（自动去重），生成 OpenAPI 3.0 文档。  

### 6.6 刷新

侧栏或页内 **刷新** 会重新加载用例与集合；缺失时可用 API 集合 **回写 YAML**（与后端 backfill 逻辑联动）。

---

## 7. 套件执行（Alt+5）

### 7.1 用途

按 **项目 + 套件 + 环境** 批量运行用例，结果写入 `runs/` 并在 **执行记录** 中查看。

### 7.2 配置项

- **项目**、**套件**、**环境** 下拉（自定义选择器样式）。  
- **OpenAPI 导入** 按钮：快速为套件准备用例/集合（与工具栏一致）。  

### 7.3 运行目标列表

引擎合并两类目标：

1. **YAML 用例**（套件 `cases` 列表中的 ID）  
2. **集合请求**（不在套件 YAML 中、且 URL/用例 stem 与套件用例不重复的集合项）

列表支持 **全选/反选**、按条勾选；可仅运行所选子集。  
集合专属项可能标有「集合」标签；运行前若仅集合无 YAML，可能自动保存为用例。

### 7.4 执行与结果

- 点击 **运行套件**（或「运行所选（N）」）调用 Python `atp` 引擎。  
- 单条失败不致使整批崩溃；错误步骤写入友好 `error` 字段。  
- 完成后可跳转 **执行记录** 查看详情。  

### 7.5 CLI 等价

```powershell
python -m atp.cli run -p <项目ID> -s <套件名> -e <环境名>
```

---

## 8. 执行记录（Alt+6）

### 8.1 列表

展示历史 run：`runs/index.json` 与按月索引；可按项目筛选。

### 8.2 详情

- **摘要**：通过率、开始/结束时间、环境、套件。  
- **步骤列表**：每用例请求方法、URL、状态、断言结果。  
- **响应预览**：JSON 可视化或原始文本；失败步骤展示 error 与上下文。  

原则：**先写步骤明细，再写 summary，最后更新索引**（与引擎一致）。

---

## 9. 负载测试（Alt+2）

### 9.1 主标签

| 标签 | 功能 |
|------|------|
| 压测配置 | 编辑测试计划、线程组、HTTP 采样器；生成 JMX |
| 执行 JMX | 选择 JMX、启动本机 JMeter、实时日志 |
| JTL 报告 | 加载 JTL，图表与聚合（支持流式解析模式） |
| 压测历史 | 按项目归档历史 run，对比、合并摘要 |

### 9.2 压测配置

- 树形配置：**测试计划 → 线程组 → HTTP 请求**。  
- 线程组预设：冒烟 / 轻量 / 默认 / 压测（线程数、Ramp-Up、循环）。  
- HTTP 采样器可从 **集合** 或 **YAML 用例** 导入 URL、Header、Body。  
- 请求体编辑器：**JSON 语法高亮叠加编辑**（与负载测试采样器一致）。  
- **保存 JMX**：导出到项目 `jmx/` 或用户选择路径。  

### 9.3 执行 JMeter

- 检测 JMeter 可执行文件；配置 JVM / 额外参数（以界面为准）。  
- 运行中可停止；输出 JTL 路径。  

### 9.4 JTL 报告

- **流式解析模式**（极速 / 深度）：大文件（>500MB）默认策略见偏好设置。  
- 图表与指标：吞吐量、响应时间分布等（D3 可视化）。  
- 支持导出 PDF 报告（若已配置导出流程）。  

### 9.5 压测历史

- 按项目查看归档 run 目录；列表支持筛选、合并视图、单条摘要。  

---

## 10. 全局能力

### 10.1 项目与工作区

- 多项目并存于 `projects/`；切换项目刷新环境与用例列表。  
- 新建项目时可选默认 `base_url`（从当前工作台 URL 推断）。  

### 10.2 偏好设置

- **JTL 流式解析默认模式**：影响负载测试页超大 JTL 的打开策略。  
- 可勾选「同时应用到当前负载测试页」。  

### 10.3 通知与错误边界

- 顶栏 Toast 提示操作结果。  
- 各主面板包裹 **PanelErrorBoundary**，避免单页崩溃拖垮整应用。  

### 10.4 复制与导出

- 多处 **复制到剪贴板**（cURL、JSON、响应体）。  
- 工作台 JSON 可视化 **导出选中行** 为 CSV/XLSX 等。  

---

## 11. 命令行（CLI）补充

与桌面共享同一仓库根：

| 命令 | 说明 |
|------|------|
| `python -m atp.cli run -p … -s … -e …` | 运行套件 |
| `python -m atp.cli runs list` | 列出执行记录 |
| `python -m atp.cli capture-start …` | 创建抓包会话 |
| `python -m atp.cli capture-serve …` | 启动 ingest 服务 |

详见仓库 `README.md` 与 `docs/FILE-STORE.md`（若随交付附带）。

---

## 12. 安全与合规建议

1. **勿将 `*.local.yaml`、token、Cookie 提交版本库**。  
2. 抓包证书仅用于测试环境；生产流量需合规审批。  
3. 安装包未签名时，Windows SmartScreen 可能提示——需企业侧白名单或代码签名。  
4. `insecureTls`（忽略证书错误）仅用于内网调试。  

---

## 13. 常见问题（FAQ）

| 现象 | 处理建议 |
|------|----------|
| 套件执行失败 `base_url` 为示例域名 | 编辑 `environments/dev.yaml` 或 `dev.local.yaml` 设置真实 `base_url` 与 `{{token}}` |
| 打包提示 `app.asar` 被占用 | 退出 ATP 与 Electron 开发进程，删除 `desktop/release` 或换输出目录 |
| 抓包无 HTTPS 解密 | 安装并信任 mitm 根证书；检查 PAC 域名是否包含目标 API |
| Send 提示未定义变量 | 打开环境变量面板补全 `{{变量}}` |
| 集合与 YAML 看起来重复 | 集合页已去重；维护以 YAML 为准，集合保存会自动同步 |
| Scripts 区高度异常 | 拖动请求/响应分隔条；Scripts 页会自动扩展请求区 |
| JMeter 找不到 | 安装 JMeter 并配置 PATH，或使用 `pack:win:full` |

---

## 14. 版本与文档

- 本产品说明书为 **无截图详细版**，文件名：`docs/PRODUCT-MANUAL-DETAILED.md`。  
- 若仓库另有带截图的 `PRODUCT-MANUAL.md` / PDF，可与本文件互为补充：本文件侧重全功能文字说明与操作逻辑，彼者侧重界面导引。  
- 功能以当前 **main** 分支桌面端为准；Scripts、`pm.*`、Console 可视化、OpenAPI 导出、集合去重等为 0.1.0 后期增量能力。  

---

## 15. 术语表

| 术语 | 含义 |
|------|------|
| 用例（Case） | `cases/*.yaml`，含 request + assertions |
| 套件（Suite） | `suites/*.yaml`，用例 ID 列表 |
| 集合（Collection） | 工作台 JSON 模块，多请求 |
| 环境（Environment） | `environments/*.yaml` + optional `.local.yaml` |
| Run | 一次套件执行产物目录 `runs/<id>/` |
| 抓包会话（Session） | `captures/<id>/` 下索引与流量 |
| JMX | JMeter 测试计划文件 |
| JTL | JMeter 结果日志 |

---

**版权声明**：API Test Automation Platform © 随交付包授权使用。未经授权不得剥离品牌后二次分发安装包。