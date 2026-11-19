import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import ApiWorkbench from "./ApiWorkbench";
import CasesPanel from "./CasesPanel";
import CreateProjectDialog from "./CreateProjectDialog";
import CapturePanel from "./CapturePanel";
import LoadTestPanel from "./LoadTestPanel";
import ConfirmDialog from "./ConfirmDialog";
import LoadingOverlay from "./LoadingOverlay";
import PanelErrorBoundary from "./PanelErrorBoundary";
import RunDetailPanel from "./RunDetailPanel";
import RunSuitePanel from "./RunSuitePanel";
import { resolveSuiteRunCaseIds, type SuiteRunTarget } from "./resolveSuiteRunTargets";
import RunsHistoryTable from "./RunsHistoryTable";
import ProjectEmptyState from "./ProjectEmptyState";
import { SkeletonDetailPanel } from "./AppSkeleton";
import WorkspaceBootSkeleton from "./WorkspaceBootSkeleton";
import AppModuleChrome from "./AppModuleChrome";
import AppToast from "./AppToast";
import AppPreferencesDialog from "./AppPreferencesDialog";
import {
  APP_TABS,
  NAV_GROUP_LABELS,
  TAB_DESCRIPTIONS,
  loadPersistedTab,
  persistTab,
  type AppTab,
} from "./navConfig";
import { useAppNotify } from "./useAppNotify";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { normalizeRawBodyDraft } from "./apiWorkbenchModel";
import { caseYamlToWorkbenchDraft } from "./caseYaml";
import { importProjectCasesToCollection } from "./importProjectCasesToCollection";
import AppCustomSelect from "./AppCustomSelect";
import { GlobalEnvSidebar, ProjectEnvProvider, useProjectEnv } from "./ProjectEnvContext";

type Project = Awaited<ReturnType<typeof window.atp.listProjects>>[number];
type RunRow = Awaited<ReturnType<typeof window.atp.listRuns>>[number];

const EMPTY_PROJECT_CASES: string[] = [];

type AppViewModel = Record<string, unknown>;

const AppViewModelCtx = createContext<AppViewModel | null>(null);

function useAppVm(): AppViewModel {
  const ctx = useContext(AppViewModelCtx);
  if (!ctx) throw new Error("AppViewModel missing");
  return ctx;
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(() => loadPersistedTab() ?? "api");
  const { toast, notify, clearToast } = useAppNotify();
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [suite, setSuite] = useState("smoke");
  const [assets, setAssets] = useState<{
    environments: string[];
    suites: string[];
    cases: string[];
    caseTexts: Record<string, string>;
  } | null>(null);
  /** 当前 assets 属于哪个项目（切换项目时先清空，避免用例列表与读盘路径不一致） */
  const [assetsForProject, setAssetsForProject] = useState<string | null>(null);
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const [running, setRunning] = useState(false);
  const [lastSuiteRun, setLastSuiteRun] = useState<{
    summary: unknown | null;
    steps: unknown[];
    stderr?: string;
    rawLog?: string;
  } | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ summary: unknown; steps: unknown[] } | null>(null);
  const [workbenchDraft, setWorkbenchDraft] = useState<WorkbenchDraft | null>(null);
  const [workbenchOpenRequestId, setWorkbenchOpenRequestId] = useState<string | null>(null);
  const [workbenchOpenCollectionId, setWorkbenchOpenCollectionId] = useState<string | null>(null);
  /** 每次从用例/集合注入工作台时递增，通知 ApiWorkbench 灌入草稿 */
  const [workbenchInjectId, setWorkbenchInjectId] = useState(0);
  const [projectCaseContext, setProjectCaseContext] = useState<{ caseName: string | null; yaml: string }>({
    caseName: null,
    yaml: "",
  });
  const [workbenchCollectionNonce, setWorkbenchCollectionNonce] = useState(0);
  const [loadTestDraft, setLoadTestDraft] = useState<WorkbenchDraft | null>(null);
  /** 每次从工作台发到压测时递增，避免 Strict Mode 清空草稿后无法二次灌入 */
  const [loadTestInjectId, setLoadTestInjectId] = useState(0);
  const [workbenchFromLoadTest, setWorkbenchFromLoadTest] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectBaseUrlHint, setCreateProjectBaseUrlHint] = useState<string | undefined>();
  const [bootLoading, setBootLoading] = useState(true);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [pendingProjectDelete, setPendingProjectDelete] = useState(false);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [projectCollections, setProjectCollections] = useState<
    Array<{ id: string; name: string; requestCount: number }>
  >([]);
  const [suiteTargetsReload, setSuiteTargetsReload] = useState(0);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  /** 项目与用例 · YAML 列表选中（提升到 App，避免面板内 effect 抢状态） */
  const [projectsActiveCase, setProjectsActiveCase] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    const list = await window.atp.listRuns({ limit: 200 });
    setRuns(list);
  }, []);

  const refreshProjects = useCallback(async () => {
    const list = await window.atp.listProjects();
    setProjects(list);
    setSelectedProject((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
    return list;
  }, []);

  const refreshAssets = useCallback(async () => {
    if (!selectedProject) return;
    const id = selectedProject;
    setAssetsLoading(true);
    try {
      const a = await window.atp.listProjectAssets(id);
      if (selectedProjectRef.current !== id) return;
      setAssets(a);
      setAssetsForProject(id);
    } finally {
      if (selectedProjectRef.current === id) setAssetsLoading(false);
    }
  }, [selectedProject]);

  const projectCaseNames = useMemo(() => {
    if (!selectedProject || assetsForProject !== selectedProject) return EMPTY_PROJECT_CASES;
    const names = assets?.cases ?? EMPTY_PROJECT_CASES;
    return [...names].sort((a, b) => a.localeCompare(b, "zh"));
  }, [assets?.cases, assetsForProject, selectedProject]);

  const projectCaseTexts = useMemo(() => {
    if (!selectedProject || assetsForProject !== selectedProject) return {} as Record<string, string>;
    return assets?.caseTexts ?? {};
  }, [assets?.caseTexts, assetsForProject, selectedProject]);

  const projectCasesListKey = useMemo(() => projectCaseNames.join("\u001f"), [projectCaseNames]);

  useEffect(() => {
    setProjectsActiveCase(null);
  }, [selectedProject]);

  useEffect(() => {
    if (!projectCaseNames.length) {
      setProjectsActiveCase(null);
      return;
    }
    setProjectsActiveCase((cur) =>
      cur && projectCaseNames.includes(cur) ? cur : projectCaseNames[0] ?? null,
    );
  }, [selectedProject, projectCasesListKey, projectCaseNames.length]);

  /** 刷新资源时仍保留已加载的 cases/caseTexts，避免用例列表选中态被反复重置 */
  const projectCasesReady = Boolean(
    selectedProject && assetsForProject === selectedProject && assets != null,
  );

  useEffect(() => {
    void (async () => {
      setBootLoading(true);
      const timeout = (ms: number) =>
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), ms));
      try {
        const projectsBoot = refreshProjects();
        const done = await Promise.race([projectsBoot, timeout(12_000)]);
        if (done === "timeout") {
          notify("工作台加载超时，已显示界面。请检查 ATP_REPO_ROOT 或重新启动应用。");
        }
      } finally {
        setBootLoading(false);
      }
      void refreshRuns();
    })();
    // 仅启动时拉取一次；执行记录在后台加载，勿阻塞工作台空态
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional boot-only
  }, [refreshProjects]);

  useEffect(() => {
    if (tab !== "runs") return;
    void refreshRuns();
  }, [tab, refreshRuns]);

  useEffect(() => {
    const atp = window.atp;
    if (!atp?.ensureNetworkDirect) return;
    void atp.ensureNetworkDirect().then((r) => {
      if (r.messages.length) notify(r.messages.join(" "));
    });
  }, [notify]);

  useEffect(() => {
    if (tab !== "projects" || !selectedProject) {
      setProjectCollections([]);
      return;
    }
    void window.atp.listCollections(selectedProject).then(setProjectCollections);
  }, [tab, selectedProject]);

  useEffect(() => {
    setAssets(null);
    setAssetsForProject(null);
    if (!selectedProject) {
      setAssetsLoading(false);
      return;
    }
    const id = selectedProject;
    void (async () => {
      setAssetsLoading(true);
      try {
        const a = await window.atp.listProjectAssets(id);
        if (selectedProjectRef.current !== id) return;
        setAssets(a);
        setAssetsForProject(id);
        setSuite((prev) => {
          if (a.suites.length && !a.suites.includes(prev)) return a.suites[0]!;
          return prev;
        });
      } finally {
        if (selectedProjectRef.current === id) setAssetsLoading(false);
      }
    })();
  }, [selectedProject]);

  const goTab = useCallback((next: AppTab) => {
    setTab(next);
    persistTab(next);
  }, []);

  const consumeWorkbenchDraft = useCallback(() => {
    setWorkbenchOpenRequestId(null);
    setWorkbenchOpenCollectionId(null);
    // 保留 workbenchDraft，避免 remount/StrictMode 后子组件拿不到注入内容
  }, []);

  const openDraftInWorkbench = useCallback(
    (draft: WorkbenchDraft, opts?: { requestId?: string; collectionId?: string }) => {
      setWorkbenchFromLoadTest(false);
      setWorkbenchDraft(draft);
      setWorkbenchOpenRequestId(opts?.requestId ?? null);
      setWorkbenchOpenCollectionId(opts?.collectionId ?? null);
      setWorkbenchInjectId((n) => n + 1);
      goTab("api");
    },
    [goTab],
  );

  const handleCasePreviewChange = useCallback(
    (ctx: { caseName: string | null; yaml: string }) => {
      setProjectCaseContext((prev) =>
        prev.caseName === ctx.caseName && prev.yaml === ctx.yaml ? prev : ctx,
      );
    },
    [],
  );

  useEffect(() => {
    setProjectCaseContext({ caseName: null, yaml: "" });
  }, [selectedProject]);

  const openApiWorkbench = useCallback(() => {
    void (async () => {
      try {
      if (!selectedProject) {
        goTab("api");
        return;
      }
      const caseNames = assets?.cases ?? [];
      if (caseNames.length) {
        const res = await importProjectCasesToCollection(selectedProject, caseNames);
        setWorkbenchCollectionNonce((n) => n + 1);
        const openName =
          projectCaseContext.caseName && caseNames.includes(projectCaseContext.caseName)
            ? projectCaseContext.caseName
            : caseNames[0];
        if (openName) {
          const text =
            projectCaseContext.caseName === openName && projectCaseContext.yaml.trim()
              ? projectCaseContext.yaml
              : await window.atp.readFile(`projects/${selectedProject}/cases/${openName}.yaml`);
          const draft = text ? caseYamlToWorkbenchDraft(text) : null;
          if (draft) {
            setWorkbenchFromLoadTest(false);
            setWorkbenchDraft(draft);
            setWorkbenchOpenRequestId(null);
            setWorkbenchOpenCollectionId(null);
            setWorkbenchInjectId((n) => n + 1);
          }
        }
        goTab("api");
        const failHint = res.failed.length ? `，${res.failed.length} 个解析失败` : "";
        notify(
          `已将 ${res.imported}/${caseNames.length} 个用例导入「默认模块 · 项目用例」${failHint}；编辑器打开「${openName ?? ""}」`,
        );
        void window.atp.listCollections(selectedProject).then(setProjectCollections);
        return;
      }
      goTab("api");
      notify("本项目暂无用例；工作台可新建集合请求或导入 cURL");
      } catch (err) {
        console.error("[openApiWorkbench]", err);
        notify(err instanceof Error ? err.message : "打开工作台失败");
        goTab("api");
      }
    })();
  }, [assets?.cases, goTab, notify, projectCaseContext, selectedProject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const hit = APP_TABS.find((t) => t.shortcut === e.key);
      if (!hit) return;
      e.preventDefault();
      goTab(hit.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTab]);

  const selectedProjectName =
    projects.find((p) => p.id === selectedProject)?.name ?? selectedProject;

  const openCreateProject = (hint?: string) => {
    setCreateProjectBaseUrlHint(hint);
    setCreateProjectOpen(true);
  };

  const needsProject = tab === "api" || tab === "load" || tab === "capture";
  const projectReady = Boolean(selectedProject);

  const deleteCurrentProject = async () => {
    if (!selectedProject) return;
    const name = projects.find((p) => p.id === selectedProject)?.name ?? selectedProject;
    setProjectDeleteBusy(true);
    const res = await window.atp.deleteProject(selectedProject);
    setProjectDeleteBusy(false);
    setPendingProjectDelete(false);
    if (!res.ok) {
      notify(res.error ?? "删除项目失败");
      return;
    }
    const list = await window.atp.listProjects();
    setProjects(list);
    setSelectedProject(list[0]?.id ?? "");
    setAssets(null);
    setAssetsForProject(null);
    notify(`已删除项目「${name}」`);
    if (list[0]) await refreshAssets();
  };

  const openRun = async (id: string) => {
    setSelectedRunId(id);
    setRunDetailLoading(true);
    goTab("runs");
    try {
      const detail = await window.atp.getRunDetail(id);
      setRunDetail(detail);
    } finally {
      setRunDetailLoading(false);
    }
  };

  const clearRunSelection = useCallback(() => {
    setSelectedRunId(null);
    setRunDetail(null);
  }, []);

  const onRunsDeleted = (deletedIds: string[]) => {
    void (async () => {
      const list = await window.atp.listRuns({ limit: 200 });
      setRuns(list);
      if (
        selectedRunId &&
        (deletedIds.includes(selectedRunId) || !list.some((r) => r.id === selectedRunId))
      ) {
        setSelectedRunId(null);
        setRunDetail(null);
      }
    })();
  };

  const submitCreateProject = (opts: { id: string; name: string; baseUrl: string }) => {
    void (async () => {
      const res = await window.atp.createProject(opts);
      setCreateProjectOpen(false);
      if (!res.ok || !res.projectId) {
        notify(res.error ?? "创建项目失败");
        return;
      }
      await refreshProjects();
      setSelectedProject(res.projectId);
      await refreshAssets();
      const label = opts.name.trim() || res.projectId;
      notify(`已创建项目「${label}」`);
      goTab("projects");
    })();
  };

  const appVm: AppViewModel = {
    tab,
    goTab,
    notify,
    clearToast,
    toast,
    projects,
    selectedProject,
    setSelectedProject,
    selectedProjectName,
    suite,
    setSuite,
    assets,
    assetsLoading,
    projectCasesReady,
    projectCaseNames,
    projectCaseTexts,
    projectsActiveCase,
    setProjectsActiveCase,
    handleCasePreviewChange,
    running,
    setRunning,
    lastSuiteRun,
    setLastSuiteRun,
    selectedRunId,
    runDetail,
    runDetailLoading,
    openRun,
    clearRunSelection,
    onRunsDeleted,
    refreshAssets,
    refreshRuns,
    suiteTargetsReload,
    setSuiteTargetsReload,
    workbenchDraft,
    workbenchInjectId,
    workbenchOpenRequestId,
    workbenchOpenCollectionId,
    workbenchCollectionNonce,
    consumeWorkbenchDraft,
    openDraftInWorkbench,
    openApiWorkbench,
    workbenchFromLoadTest,
    loadTestDraft,
    loadTestInjectId,
    setLoadTestInjectId,
    setLoadTestDraft,
    setWorkbenchFromLoadTest,
    bootLoading,
    needsProject,
    projectReady,
    openCreateProject,
    createProjectOpen,
    setCreateProjectOpen,
    createProjectBaseUrlHint,
    setCreateProjectBaseUrlHint,
    preferencesOpen,
    setPreferencesOpen,
    projectCollections,
    pendingProjectDelete,
    setPendingProjectDelete,
    projectDeleteBusy,
    deleteCurrentProject,
    submitCreateProject,
    runs,
  };

  return (
    <AppViewModelCtx.Provider value={appVm}>
      <ProjectEnvProvider projectId={selectedProject}>
        <AppShell />
      </ProjectEnvProvider>
    </AppViewModelCtx.Provider>
  );
}

function AppShell() {
  const vm = useAppVm();
  const {
    tab,
    goTab,
    notify,
    clearToast,
    toast,
    projects,
    selectedProject,
    setSelectedProject,
    selectedProjectName,
    suite,
    setSuite,
    assets,
    assetsLoading,
    projectCasesReady,
    projectCaseNames,
    projectCaseTexts,
    projectsActiveCase,
    setProjectsActiveCase,
    handleCasePreviewChange,
    running,
    setRunning,
    lastSuiteRun,
    setLastSuiteRun,
    selectedRunId,
    runDetail,
    runDetailLoading,
    openRun,
    clearRunSelection,
    onRunsDeleted,
    refreshAssets,
    refreshRuns,
    suiteTargetsReload,
    setSuiteTargetsReload,
    workbenchDraft,
    workbenchInjectId,
    workbenchOpenRequestId,
    workbenchOpenCollectionId,
    workbenchCollectionNonce,
    consumeWorkbenchDraft,
    openDraftInWorkbench,
    openApiWorkbench,
    workbenchFromLoadTest,
    loadTestDraft,
    loadTestInjectId,
    setLoadTestInjectId,
    setLoadTestDraft,
    setWorkbenchFromLoadTest,
    bootLoading,
    needsProject,
    projectReady,
    openCreateProject,
    createProjectOpen,
    setCreateProjectOpen,
    createProjectBaseUrlHint,
    setCreateProjectBaseUrlHint,
    preferencesOpen,
    setPreferencesOpen,
    projectCollections,
    pendingProjectDelete,
    setPendingProjectDelete,
    projectDeleteBusy,
    deleteCurrentProject,
    submitCreateProject,
    runs,
  } = vm as {
    tab: AppTab;
    goTab: (next: AppTab) => void;
    notify: (text: string, kind?: import("./useAppNotify").NotifyKind) => void;
    clearToast: () => void;
    toast: { text: string; kind: import("./useAppNotify").NotifyKind } | null;
    projects: Project[];
    selectedProject: string;
    setSelectedProject: (id: string) => void;
    selectedProjectName: string;
    suite: string;
    setSuite: (s: string) => void;
    assets: {
      environments: string[];
      suites: string[];
      cases: string[];
      caseTexts: Record<string, string>;
    } | null;
    assetsLoading: boolean;
    projectCasesReady: boolean;
    projectCaseNames: string[];
    projectCaseTexts: Record<string, string>;
    projectsActiveCase: string | null;
    setProjectsActiveCase: (name: string | null) => void;
    handleCasePreviewChange: (ctx: { caseName: string | null; yaml: string }) => void;
    running: boolean;
    setRunning: (v: boolean) => void;
    lastSuiteRun: {
      summary: unknown | null;
      steps: unknown[];
      stderr?: string;
      rawLog?: string;
    } | null;
    setLastSuiteRun: (v: {
      summary: unknown | null;
      steps: unknown[];
      stderr?: string;
      rawLog?: string;
    } | null) => void;
    selectedRunId: string | null;
    runDetail: { summary: unknown; steps: unknown[] } | null;
    runDetailLoading: boolean;
    openRun: (id: string) => Promise<void>;
    clearRunSelection: () => void;
    onRunsDeleted: (deletedIds: string[]) => void;
    refreshAssets: () => Promise<void>;
    refreshRuns: () => Promise<void>;
    suiteTargetsReload: number;
    workbenchDraft: WorkbenchDraft | null;
    workbenchInjectId: number;
    workbenchOpenRequestId: string | null;
    workbenchOpenCollectionId: string | null;
    workbenchCollectionNonce: number;
    consumeWorkbenchDraft: () => void;
    openDraftInWorkbench: (draft: WorkbenchDraft, opts?: { requestId?: string; collectionId?: string }) => void;
    openApiWorkbench: () => void;
    workbenchFromLoadTest: boolean;
    loadTestDraft: WorkbenchDraft | null;
    loadTestInjectId: number;
    setLoadTestInjectId: (updater: number | ((n: number) => number)) => void;
    setLoadTestDraft: (d: WorkbenchDraft | null) => void;
    setWorkbenchFromLoadTest: (v: boolean) => void;
    bootLoading: boolean;
    needsProject: boolean;
    projectReady: boolean;
    openCreateProject: (hint?: string) => void;
    createProjectOpen: boolean;
    setCreateProjectOpen: (o: boolean) => void;
    createProjectBaseUrlHint: string | undefined;
    setCreateProjectBaseUrlHint: (h: string | undefined) => void;
    preferencesOpen: boolean;
    setPreferencesOpen: (o: boolean) => void;
    projectCollections: Array<{ id: string; name: string; requestCount: number }>;
    pendingProjectDelete: boolean;
    setPendingProjectDelete: (v: boolean) => void;
    projectDeleteBusy: boolean;
    deleteCurrentProject: () => Promise<void>;
    submitCreateProject: (opts: { id: string; name: string; baseUrl: string }) => void;
    runs: RunRow[];
  };

  const { envName: env, setEnvName: setEnv, variablesLoading } = useProjectEnv();
  const workspacePending = Boolean(selectedProject && (assetsLoading || variablesLoading));

  const onRun = async (targets: SuiteRunTarget[]) => {
    if (!selectedProject) return;
    if (!targets.length) {
      notify("请至少选择一个用例");
      return;
    }
    setRunning(true);
    setLastSuiteRun(null);
    const caseIds = await resolveSuiteRunCaseIds(selectedProject, suite, targets);
    if (!caseIds.length) {
      notify("无法解析所选请求，请检查集合数据");
      setRunning(false);
      return;
    }
    const result = await window.atp.runSuite({
      project: selectedProject,
      suite,
      env,
      cases: caseIds,
    });
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim() ?? "";
    let runView: typeof lastSuiteRun = null;
    try {
      if (stdout.startsWith("{")) {
        const brief = JSON.parse(stdout) as { id?: string; status?: string };
        if (brief.id) {
          const detail = await window.atp.getRunDetail(brief.id);
          if (detail.summary) {
            runView = {
              summary: detail.summary,
              steps: detail.steps,
              stderr: stderr || undefined,
            };
          } else {
            runView = { summary: brief, steps: [], stderr: stderr || undefined };
          }
        }
      }
    } catch {
      // 非 JSON 输出，走下方降级展示
    }
    if (!runView) {
      const raw = [stdout, stderr].filter(Boolean).join("\n");
      runView = {
        summary: null,
        steps: [],
        stderr: stderr || undefined,
        rawLog: raw || (result.code === 0 ? "执行成功" : "执行失败"),
      };
    } else if (runView.summary && typeof runView.summary === "object") {
      const st = (runView.summary as { status?: string }).status;
      if (st === "passed") notify("套件执行通过");
      else if (st === "failed") notify("套件执行完成，存在失败用例");
    }
    setLastSuiteRun(runView);
    setRunning(false);
    await refreshAssets();
    setSuiteTargetsReload((n: number) => n + 1);
    await refreshRuns();
  };

  return (
    <div className="layout">
      <a className="skip-to-main" href="#app-main">
        跳到主内容
      </a>
      <aside className="sidebar sidebar--fin">
        <div className="sidebar-brand-head">
          <span className="sidebar-brand-mark" aria-hidden>
            ATP
          </span>
          <div className="sidebar-brand-copy">
            <span className="sidebar-brand-title">API Test Platform</span>
            <span className="sidebar-brand-sub">接口与压测工作台</span>
          </div>
        </div>

        <GlobalEnvSidebar />

        <div className="sidebar-workspace">
            <div className="sidebar-workspace-row">
              <AppCustomSelect
                className="sidebar-workspace-select"
                value={selectedProject}
                disabled={bootLoading || !projects.length}
                ariaLabel="当前项目"
                placeholder={bootLoading ? "加载中…" : "暂无项目"}
                title={
                  selectedProject
                    ? `项目 ID：${selectedProject}`
                    : "选择或新建工作区项目"
                }
                options={projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  title: `${p.name} · ID：${p.id}`,
                }))}
                onChange={setSelectedProject}
              />
              <button
                type="button"
                className="workbench-icon-btn sidebar-workspace-icon"
                title="新建项目"
                aria-label="新建项目"
                onClick={() => openCreateProject()}
              >
                +
              </button>
              <button
                type="button"
                className="workbench-icon-btn workbench-icon-btn--muted sidebar-workspace-icon"
                disabled={!selectedProject}
                title="管理项目"
                aria-label="管理项目"
                onClick={() => goTab("projects")}
              >
                ⚙
              </button>
            </div>
        </div>

        <nav className="sidebar-nav sidebar-nav--fin" aria-label="主功能">
          {(["dev", "assets", "auto"] as const).map((group) => {
            const groupActive = APP_TABS.some((t) => t.group === group && t.id === tab);
            return (
            <div key={group} className="sidebar-nav-group">
              <div className={`nav-section nav-section--fin${groupActive ? " nav-section--active" : ""}`}>
                {NAV_GROUP_LABELS[group]}
              </div>
              <div className="sidebar-nav-items sidebar-nav-items--fin">
                {APP_TABS.filter((t) => t.group === group).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`nav-btn nav-btn--module${tab === t.id ? " active" : ""}`}
                    onClick={() => goTab(t.id)}
                    title={`快捷键 Alt+${t.shortcut}`}
                    aria-current={tab === t.id ? "page" : undefined}
                  >
                    <span className="nav-btn-label">{t.label}</span>
                    <span className="nav-btn-kbd" aria-hidden>
                      <kbd>Alt+{t.shortcut}</kbd>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
          })}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="sidebar-foot-link"
            onClick={() => setPreferencesOpen(true)}
          >
            <span className="sidebar-foot-link-icon" aria-hidden>
              ⚙
            </span>
            偏好设置
          </button>
          <button
            type="button"
            className="sidebar-foot-link"
            title="桌面客户端卡在 Connecting 时：关闭残留抓包代理并重置 WinHTTP"
            onClick={() => {
              void window.atp.restoreNetworkOnly().then((r) => notify(r.message));
            }}
          >
            <span className="sidebar-foot-link-icon" aria-hidden>
              🔌
            </span>
            恢复上网
          </button>
        </div>
      </aside>

      <main
        id="app-main"
        className={`main loading-host${tab === "api" ? " main--workbench" : ""}${tab === "load" ? " main--workbench" : ""}${
          workspacePending ? " main--workspace-pending" : ""
        }`}
      >
        {workspacePending ? (
          <div className="workspace-pending-indicator" role="status" aria-live="polite" aria-busy="true">
            <span className="workspace-pending-line" aria-hidden />
            <span className="hint workspace-pending-label">切换工作区…</span>
          </div>
        ) : null}
        {bootLoading && needsProject && !projectReady ? (
          <WorkspaceBootSkeleton layout={tab === "api" || tab === "load" ? "workbench" : "plain"} />
        ) : null}
        {!bootLoading && needsProject && !projectReady ? (
          <ProjectEmptyState
            fullscreen={!projects.length}
            title={projects.length ? "未选择项目" : "暂无项目"}
            hint={
              projects.length
                ? "请在左侧项目下拉框中选择项目，或前往「项目与用例」管理资产。"
                : "新建项目后，即可使用 API 调试、抓包与压测功能。"
            }
            onCreateProject={() => openCreateProject()}
            onGoProjects={projects.length ? () => goTab("projects") : undefined}
          />
        ) : null}
        {tab === "suite" && (
          <>
            <AppModuleChrome tab="suite" description={false} />
            <Card title="套件与用例">
              <RunSuitePanel
                projects={projects}
                selectedProject={selectedProject}
                onProject={setSelectedProject}
                suite={suite}
                env={env}
                assets={assets}
                onSuite={setSuite}
                onEnv={setEnv}
                running={running}
                reloadKey={suiteTargetsReload}
                onRun={(items) => void onRun(items)}
              />
            </Card>

            {lastSuiteRun ? (
              <Card title="本次执行结果">
                {lastSuiteRun.summary ? (
                  <>
                    <RunDetailPanel
                      summary={lastSuiteRun.summary}
                      steps={lastSuiteRun.steps}
                      projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
                    />
                    <div className="run-suite-result-footer">
                      {typeof lastSuiteRun.summary === "object" &&
                      lastSuiteRun.summary &&
                      "id" in lastSuiteRun.summary &&
                      typeof (lastSuiteRun.summary as { id: string }).id === "string" ? (
                        <button
                          type="button"
                          className="nav-btn"
                          onClick={() => void openRun((lastSuiteRun.summary as { id: string }).id)}
                        >
                          在执行记录中打开
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="hint run-suite-run-fallback-title">无法解析结构化结果，以下为原始输出。</p>
                )}
                {lastSuiteRun.stderr ? (
                  <pre className="run-suite-run-stderr" role="alert">
                    {lastSuiteRun.stderr}
                  </pre>
                ) : null}
                {!lastSuiteRun.summary && lastSuiteRun.rawLog ? (
                  <pre className="run-suite-run-fallback">{lastSuiteRun.rawLog}</pre>
                ) : null}
              </Card>
            ) : null}
          </>
        )}

        {tab === "runs" && (
          <>
            <AppModuleChrome tab="runs" description={false} />
            <Card title="最近执行">
              <RunsHistoryTable
                runs={runs}
                projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                selectedRunId={selectedRunId}
                onSelect={(id) => void openRun(id)}
                onClearSelection={clearRunSelection}
                onRunsDeleted={onRunsDeleted}
                onNotify={notify}
              />
            </Card>

            {selectedRunId && (
              <Card title={`详情 · ${selectedRunId}`}>
                <div className="loading-host run-detail-host">
                  {runDetailLoading ? (
                    <div className="run-detail-skeleton-host">
                      <SkeletonDetailPanel />
                    </div>
                  ) : null}
                  {runDetail?.summary && !runDetailLoading ? (
                    <RunDetailPanel
                      summary={runDetail.summary}
                      steps={runDetail.steps}
                      projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))}
                    />
                  ) : null}
                </div>
              </Card>
            )}
          </>
        )}

        {tab === "projects" && (
          <div className="projects-tab-host">
            {bootLoading ? (
              <WorkspaceBootSkeleton layout="plain" />
            ) : projects.length === 0 ? (
              <>
                <h2 className="page-head">项目与用例</h2>
                <ProjectEmptyState
                fullscreen
                title="暂无项目"
                hint="新建项目后，即可使用 API 调试、抓包与压测功能。"
                onCreateProject={() => {
                  setCreateProjectBaseUrlHint(undefined);
                  setCreateProjectOpen(true);
                }}
              />
              </>
            ) : (
              <>
                <AppModuleChrome
                  tab="projects"
                  descriptionInline
                  shortcutPlain
                  description={
                    selectedProject
                      ? [
                          selectedProject,
                          assets ? `环境 ${assets.environments.length}` : null,
                          assets ? `套件 ${assets.suites.length}` : null,
                          assets ? `用例 ${assets.cases.length}` : null,
                          ...projectCollections.map((c) => `${c.name} ${c.requestCount} 请求`),
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : TAB_DESCRIPTIONS.projects
                  }
                  actions={
                    <div className="app-module-chrome-actions app-module-chrome-actions--projects">
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost"
                        onClick={() => {
                          setCreateProjectBaseUrlHint(undefined);
                          setCreateProjectOpen(true);
                        }}
                      >
                        新建项目
                      </button>
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost"
                        disabled={!selectedProject || projectDeleteBusy}
                        onClick={() => setPendingProjectDelete(true)}
                      >
                        删除项目
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={!selectedProject}
                        title="打开 API 工作台"
                        onClick={() => openApiWorkbench()}
                      >
                        打开工作台
                      </button>
                    </div>
                  }
                />
                <div className="projects-panel-host">
                  <CasesPanel
                    project={selectedProject}
                    projectDisplayName={projects.find((p) => p.id === selectedProject)?.name}
                    cases={projectCaseNames}
                    caseTexts={projectCaseTexts}
                    casesReady={projectCasesReady || projectCaseNames.length > 0}
                    assetsLoading={assetsLoading && !bootLoading && !projectCasesReady}
                    activeCaseName={projectsActiveCase}
                    onActiveCaseNameChange={setProjectsActiveCase}
                    onRefresh={() => void refreshAssets()}
                    onNotify={notify}
                    onCasePreviewChange={handleCasePreviewChange}
                    onOpenInWorkbench={(draft, opts) => openDraftInWorkbench(draft, opts)}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === "capture" && projectReady && (
          <PanelErrorBoundary name="capture">
            <AppModuleChrome tab="capture" description={false} />
            <CapturePanel
              project={selectedProject}
              projectName={selectedProjectName}
              onCaseSaved={() => void refreshAssets()}
              onGoToProjects={() => goTab("projects")}
              onOpenInWorkbench={(draft, opts) => openDraftInWorkbench(draft, opts)}
            />
          </PanelErrorBoundary>
        )}

        {tab === "api" && projectReady && (
          <PanelErrorBoundary name="api-workbench">
            <div className="workbench-page-stack">
              <AppModuleChrome tab="api" description={false} />
              <ApiWorkbench
              project={selectedProject}
              projectName={selectedProjectName}
              externalDraft={workbenchDraft}
              externalInjectGeneration={workbenchInjectId}
              externalOpenRequestId={workbenchOpenRequestId}
              externalOpenCollectionId={workbenchOpenCollectionId}
              collectionReloadNonce={workbenchCollectionNonce}
              onConsumeExternalDraft={consumeWorkbenchDraft}
              onCaseSaved={() => void refreshAssets()}
              onRequestCreateProject={(hint) => openCreateProject(hint)}
              applyToLoadTest={workbenchFromLoadTest}
              onSendToLoadTest={({ draft }) => {
                setWorkbenchFromLoadTest(false);
                setLoadTestDraft(normalizeRawBodyDraft(draft));
                setLoadTestInjectId((n) => n + 1);
                goTab("load");
                notify("已应用当前请求到负载测试");
              }}
            />
            </div>
          </PanelErrorBoundary>
        )}

        {tab === "load" && projectReady && (
          <div className="workbench-page-stack">
            <LoadTestPanel
            project={selectedProject}
            projectName={selectedProjectName}
            onNotify={notify}
            externalDraft={loadTestDraft}
            externalInjectGeneration={loadTestInjectId}
            onConsumeExternalDraft={() => {
              setLoadTestDraft(null);
            }}
            onEditInWorkbench={({ draft }) => {
              setWorkbenchFromLoadTest(true);
              openDraftInWorkbench(draft);
              notify("已在工作台打开；编辑 Headers/Params 后点「应用到压测」");
            }}
          />
          </div>
        )}
      </main>

      {toast ? <AppToast text={toast.text} kind={toast.kind} onDismiss={clearToast} /> : null}

      <AppPreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        onToast={(msg) => notify(msg)}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        suggestedBaseUrl={createProjectBaseUrlHint}
        onCancel={() => setCreateProjectOpen(false)}
        onCreate={submitCreateProject}
      />

      <ConfirmDialog
        open={pendingProjectDelete}
        title="删除项目"
        message={`将永久删除项目「${
          projects.find((p) => p.id === selectedProject)?.name ?? selectedProject
        }」（${selectedProject}）下的用例、环境、集合、抓包等全部目录，不可恢复。`}
        confirmLabel={projectDeleteBusy ? "删除中…" : "删除"}
        danger
        onCancel={() => !projectDeleteBusy && setPendingProjectDelete(false)}
        onConfirm={() => void deleteCurrentProject()}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3 className="card-title">{title}</h3>
      {children}
    </section>
  );
}
