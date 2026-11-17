# 纯文件存储规范（无 SQLite）

## 设计原则

- **Git 是配置与用例的真源**；`runs/`、`captures/` 为运行时产物（默认不提交）。
- **查询不靠 SQL**：列表读 `runs/index.json`；趋势读 `runs/by-month/YYYY-MM.json`；抓包读 `captures/.../index.json`。
- **规模控制**：按月归档 `runs/` 到 `archive/runs/YYYY-MM/`，月度索引保留在 `runs/by-month/`。

## 写入顺序（一次执行）

```text
runs/<run-id>/steps/0001.json  …  N.json
runs/<run-id>/summary.json
runs/index.json                  # atomic replace
runs/by-month/YYYY-MM.json       # atomic replace
```

## 抓包会话

```text
projects/<p>/captures/<session-id>/
  session.json
  index.json
  tx/<tx-id>.json
```

Ingest：`POST /ingest`，body 含 `request` / `response`（mitmproxy addon 或 HAR 转换器推送）。

## 与 SQLite 能力的对齐

| 能力 | 实现 |
|------|------|
| 最近执行列表 | `runs/index.json` |
| 按状态筛选 | CLI 过滤 index 数组 |
| 月度通过率 | 聚合 `runs/by-month/*.json`（可后续加 `stats/rollup.json` 脚本） |
| 抓包检索 | `captures/.../index.json` 的 method/path/url |
| 并发执行 | 各 run 独立目录；index 由调度器单进程更新 |

## 禁止项

- 不使用 SQLite / MySQL / Redis 作为平台状态存储。
- 不在 index 中存大 body；正文在 `steps/` 或 `tx/`。