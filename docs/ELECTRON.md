# Electron 桌面端架构

## 分层

| 层 | 职责 |
|----|------|
| **Renderer**（React） | 项目/用例浏览、执行记录、触发运行 |
| **Preload** | `contextBridge` 暴露 `window.atp`，禁止渲染进程直接访问 Node |
| **Main** | 读写信件库文件、spawn `python -m atp.cli` |

不引入数据库：与 CLI 相同，只读写 `projects/`、`runs/`。

## IPC 一览

- `atp:getWorkspace` / `atp:setRepoRoot`
- `atp:listProjects` / `atp:listProjectAssets` / `atp:readFile`
- `atp:listRuns` / `atp:getRunDetail`
- `atp:runSuite`

## 工作区路径

1. 环境变量 `ATP_REPO_ROOT`
2. 主进程启动时从 `out/main` 所在位置、`process.cwd()` 及其上级等多候选路径查找含 `atp/cli.py` 的目录（兼容在仓库根或 `desktop` 下执行 `npm run dev`）

## 抓包（已实现）

- 渲染进程 `CapturePanel`：新建会话、启停 ingest、浏览 `index.json`、查看 `tx/*.json`、生成用例 YAML 草案
- 主进程 `captureService.ts`：spawn `capture-serve`，退出时杀子进程

## 后续扩展

- mitmproxy addon 一键配置
- 用例编辑：写回 YAML 后 Git 提交
- 打包：`electron-builder` + 内置 Python 或要求本机 `.venv`