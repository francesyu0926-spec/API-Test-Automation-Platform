export type AppTab = "api" | "load" | "capture" | "projects" | "runs";

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