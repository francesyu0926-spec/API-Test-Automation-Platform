export type AppTab = "api" | "load" | "capture" | "projects" | "suite" | "runs";

export const APP_TABS: {
  id: AppTab;
  label: string;
  group: "dev" | "assets" | "auto";
  shortcut: string;
}[] = [
  { id: "api", label: "API 工作台", group: "dev", shortcut: "1" },
  { id: "load", label: "负载测试", group: "dev", shortcut: "2" },
  { id: "capture", label: "抓包", group: "assets", shortcut: "3" },
  { id: "projects", label: "项目与用例", group: "assets", shortcut: "4" },
  { id: "runs", label: "执行记录", group: "auto", shortcut: "5" },
];

export const NAV_GROUP_LABELS: Record<(typeof APP_TABS)[number]["group"], string> = {
  dev: "开发与压测",
  assets: "资产与流量",
  auto: "自动化",
};

export const TAB_DESCRIPTIONS: Record<AppTab, string> = {
  api: "调试 HTTP / WebSocket 请求，管理集合与环境变量。",
  load: "压测配置生成 JMX，本机 JMeter 执行，JTL / Dashboard 与压测历史。",
  capture: "Mitm 抓包、生成用例并回灌到工作台或项目。",
  projects: "管理 YAML 用例、环境与 API 集合资产。",
  suite: "按套件批量执行用例并查看本次结果。",
  runs: "浏览历史执行记录与逐步断言详情。",
};

const TAB_STORAGE_KEY = "atp:lastTab";

export function loadPersistedTab(): AppTab | null {
  try {
    const raw = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (raw && APP_TABS.some((t) => t.id === raw)) return raw as AppTab;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistTab(tab: AppTab): void {
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    /* ignore */
  }
}