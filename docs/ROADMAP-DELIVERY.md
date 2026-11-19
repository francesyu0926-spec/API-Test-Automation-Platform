# 交付路线（客户现场减配环境）

## 最高优先级：内置 Python + JMeter

**目标**：安装包开箱即用，现场无需单独安装 Python 3、pip、JMeter。

**建议实现（分阶段）**

1. **嵌入式 Python**（Windows embeddable package 3.11+）
   - 目录：`desktop/runtime/python/`（或 `resources/runtime/python/`）
   - 安装时写入 `python311._pth`，启用 `import site`，预装 `requirements.txt` + `requirements-capture.txt` 到 `Lib/site-packages`
   - `repo.pythonExecutable()` 优先：`path.join(process.resourcesPath, 'runtime/python/python.exe')`

2. **JMeter 精简包**
   - 目录：`desktop/runtime/jmeter/`（官方 binary 分发 zip 解压，去掉 docs/ printable_docs 等）
   - `jmeterRunner.detectJmeter()` 优先：`resources/runtime/jmeter/bin/jmeter.bat`
   - 体积约 80–120 MB，建议 **独立「ATP 完整版」安装包**，与当前轻量版并存

3. **electron-builder**
   - `extraResources` 增加 `runtime/`（或 NSIS 可选组件：完整版勾选）
   - 首启向导检测：若无内置 runtime 则回退本机 PATH / `JMETER_HOME`

4. **许可与更新**
   - Python PSF、Apache JMeter 需在说明书与关于页声明
   - 大版本升级通过「官方插件包」增量下载，避免每次全量 300MB+

**当前状态（POC）**

- **标准版** `npm run pack:win`：`resources/platform/` + Electron  
- **完整版** `npm run pack:win:full`：额外打入 `resources/runtime/{python,jmeter}/`  
- 主进程：`bundledRuntime.ts` → `pythonExecutable()` / `detectJmeter()` 优先内置路径  
- 开发调试：复制到 `desktop/runtime-dev/` 后 `npm run dev` 即可验证解析  

**打完整版前准备（PowerShell）**

```powershell
cd desktop
$env:ATP_EMBED_PYTHON = "D:\runtime\python-embed-3.11"   # 含 python.exe 的目录（推荐官方 embeddable + pip 预装依赖）
$env:ATP_EMBED_JMETER  = "D:\apache-jmeter-5.6.3"        # JMETER_HOME
npm run pack:stage:runtime
npm run pack:win:full
```

产物：`release/API Test Platform Full-0.1.0-x64.exe`（体积取决于 runtime，通常 +150MB 以上）。

**生产建议**：embeddable Python 需配置 `python311._pth`、预装 `requirements.txt` + `requirements-capture.txt`；JMeter 可去掉 `docs`、`printable_docs` 减体积。

---

## 高优先级：代理防残留

**目标**：主进程退出（含崩溃）后自动恢复系统上网。

**已实现（v0.1.0+）**

| 能力 | 说明 |
|------|------|
| `capture_proxy_backup.json` | 开始抓包前备份 IE 注册表 + WinHTTP |
| `proxy-guard` 守护进程 | 主进程或 mitm 异常退出时恢复快照 |
| 冷启动自检 | 发现残留快照 → 自动恢复 + 提示 |
| 全局抓包红条 | 任意页一键停止并恢复 |
| `before-quit` / `powerMonitor.shutdown` | 正常退出与关机优先恢复代理 |

---

## 中优先级：体验打磨

| 项 | 状态 |
|----|------|
| 压测历史空列表「当前项目」提示 + 切换项目 | 已实现 |
| 工作台多栏折叠与宽度自适应 | 部分（已有上下分割 `workbench-vsplit`）；侧栏集合树折叠待迭代 |
| 抓包 4 步启动自检 + 错误码 UI | 已实现 |

---

## 参考

- 打包：`desktop/README` → `npm run pack:win`
- 产品说明：`docs/PRODUCT-MANUAL.pdf`