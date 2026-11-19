# 一体化交付目录结构（完整版）

安装后的逻辑布局（与 electron `resources` 对应）：

```text
安装目录/
├── API Test Platform Full.exe
└── resources/
    ├── app.asar                    # Electron 主程序
    ├── platform/                   # 数据工作区模板（等同仓库根）
    │   ├── atp/
    │   ├── schemas/
    │   ├── projects/               # 内置项目模板
    │   └── runs/
    ├── runtime/                    # 一体化内置运行环境
    │   ├── python/                 # Windows Embeddable Python
    │   │   ├── python.exe
    │   │   ├── python311._pth      # 启用 import site / site-packages
    │   │   └── Lib/site-packages/  # mitmproxy、PyYAML、pytest 等（离线预装）
    │   ├── jre/                    # 精简 JRE 17/21
    │   │   └── bin/java.exe
    │   ├── jmeter/                 # Apache JMeter 精简目录
    │   │   ├── bin/jmeter.bat
    │   │   └── lib/
    │   └── runtime-manifest.json
    └── docs/                       # 产品说明书等
        ├── PRODUCT-MANUAL.pdf
        └── PRODUCT-MANUAL.html
```

## 解析优先级（三级回退）

| 顺位 | Python | JMeter |
|------|--------|--------|
| **1 用户指定** | 负载/采集 UI（规划中）、`data/runtime-paths.json`、`ATP_PYTHON` / `ATP_PYTHON_EXE` | 负载测试页 `JMETER_HOME` 输入框、`data/runtime-paths.json` 的 `jmeterHome` |
| **2 内置 runtime** | `resources/runtime/python/python.exe`（或开发期 `desktop/runtime-dev/python`） | `resources/runtime/jmeter`（`bin/jmeter.bat`） |
| **3 系统环境** | 项目 `.venv`，再回退 PATH 上的 `python` | `JMETER_HOME`、PATH、常见安装目录 |

执行 JMeter 时若存在内置 `runtime/jre`，自动注入 `JAVA_HOME`。

示例 `data/runtime-paths.json`（可选，与 UI 等效为第一顺位）：

```json
{
  "pythonExe": "D:\\custom\\python311\\python.exe",
  "jmeterHome": "D:\\apache-jmeter-5.6.3"
}
```

开发期可将相同目录树放在 `desktop/runtime-dev/`，`npm run dev` 走同一解析逻辑。实现见 `desktop/src/main/runtimePaths.ts`。

## 一键准备内置 runtime（开发 / 打包源）

在仓库根或 `desktop` 下执行（需联网；产物在 `.gitignore` 的 `desktop/runtime-dev/`）：

```powershell
cd desktop
npm run runtime:prepare-dev
```

等价于顺序执行：

| 步骤 | 脚本 | 说明 |
|------|------|------|
| 1 | `scripts/download-embed-python.ps1` | python.org embeddable 3.11.x → `runtime-dev/python/` |
| 2 | `scripts/download-trim-jre.ps1` | Adoptium Temurin JRE 17/21，精简 → `runtime-dev/jre/` |
| 3 | `scripts/download-trim-jmeter.ps1` | Apache JMeter 5.6.3，去掉 docs → `runtime-dev/jmeter/` |
| 4 | `scripts/embed-python-offline-wheels.ps1` | 启用 `._pth`，wheel 离线灌入 `Lib/site-packages/` |

依赖清单：`requirements.txt` + `requirements-capture.txt` + `requirements-runtime-bundled.txt`（含 pytest）。  
Wheel 缓存默认：`desktop/cache/wheels`（可设 `$env:ATP_WHEELS_CACHE`）。

仅重装 Python 依赖（已有 embed 目录）：

```powershell
$env:ATP_EMBED_PYTHON = "D:\...\desktop\runtime-dev\python"
cd desktop
npm run runtime:embed-wheels
```

仅用本地 wheel 目录、禁止联网下载：

```powershell
.\scripts\embed-python-offline-wheels.ps1 -SkipDownload -WheelsCache "D:\wheel-cache"
```

JRE 21、强制重新下载：

```powershell
.\scripts\prepare-runtime-dev.ps1 -JreMajor 21 -ForceDownload
```

更小 JRE（`jlink` 定制运行时，约 40–55 MB，需多下载 JDK）：

```powershell
.\scripts\prepare-runtime-dev.ps1 -CompactJre
```

验证：`cd desktop && npm run dev`，主进程 `bundledRuntimeSummary()` 应显示 python / jre / jmeter 均为 true。

**常见问题：** `python311._pth` 勿带 UTF-8 BOM（脚本已用无 BOM 写入）；JMeter 镜像失败可单独跑 `download-trim-jmeter.ps1`；离线灌包若卡在 `pyperclip`，重跑 `embed-python-offline-wheels.ps1`（会自动 `pip wheel` 进缓存）或 `-SkipDownload`。

## 打包命令

```powershell
cd desktop
# 若已 npm run runtime:prepare-dev，可直接用 runtime-dev 路径：
$env:ATP_EMBED_PYTHON = (Resolve-Path .\runtime-dev\python).Path
$env:ATP_EMBED_JRE     = (Resolve-Path .\runtime-dev\jre).Path
$env:ATP_EMBED_JMETER  = (Resolve-Path .\runtime-dev\jmeter).Path
npm run pack:win:full
```

手工指定外部路径时：

```powershell
$env:ATP_EMBED_PYTHON = "D:\embed\python311"
$env:ATP_EMBED_JRE     = "D:\embed\jre-17"
$env:ATP_EMBED_JMETER  = "D:\embed\apache-jmeter-5.6.3"
npm run pack:win:full
```

详见 [ROADMAP-DELIVERY.md](./ROADMAP-DELIVERY.md)。