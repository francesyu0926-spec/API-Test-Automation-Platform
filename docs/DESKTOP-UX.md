# 桌面端信息架构与操作路径

## 全局工作区

- **项目**在左侧边栏「工作区项目」统一选择，API 工作台、负载测试、抓包、执行记录共用同一项目上下文。
- **环境**在各模块顶栏通过 `EnvContextBar` 切换（`dev` / `staging` 等），变量写入 `environments/<env>.local.yaml`（不入 Git）。
- 创建项目：`+ 项目` → 成功后默认进入「项目与用例」。

## 模块分组

| 分组 | 模块 | 典型路径 |
|------|------|----------|
| 开发与压测 | API 工作台、负载测试 | 调试请求 → **发送到压测**（同步 env + token） |
| 资产与流量 | 抓包、项目与用例 | 抓包 → 流量列表多选 → **保存到项目用例**（可跳转用例页） |
| 自动化 | 执行记录 | 选套件 + 环境 → 运行 YAML 用例 |

快捷键：`Alt+1`～`Alt+5` 对应上表五个模块（顺序见 `navConfig.ts`）。

## 跨模块数据流

```text
抓包 / 用例 YAML ──► API 工作台（集合、环境变量）
API 工作台 ──► 负载测试（draft + envName + variables，含 token 持久化）
API 工作台 ──► cases/*.yaml（保存为用例）
执行记录 ◄── python -m atp.cli run（与桌面同一 projects/ 目录）
```

## 相关实现

- 导航与工作区：`desktop/src/renderer/src/App.tsx`、`navConfig.ts`
- 环境条：`EnvContextBar.tsx`
- 压测 token：`samplerAuth.ts`、`LoadTestPanel.tsx`