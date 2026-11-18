import { useCallback, useEffect, useState, type ReactNode } from "react";

import ApiWorkbench from "./ApiWorkbench";
import CasesPanel from "./CasesPanel";
import CreateProjectDialog from "./CreateProjectDialog";
import CapturePanel from "./CapturePanel";
import LoadTestPanel from "./LoadTestPanel";
import ConfirmDialog from "./ConfirmDialog";
import LoadingOverlay from "./LoadingOverlay";
import PanelErrorBoundary from "./PanelErrorBoundary";
import ProjectEmptyState from "./ProjectEmptyState";
import { APP_TABS, NAV_GROUP_LABELS, loadPersistedTab, persistTab, type AppTab } from "./navConfig";
import { useAppNotify } from "./useAppNotify";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { caseYamlToWorkbenchDraft } from "./caseYaml";
import { importProjectCasesToCollection } from "./importProjectCasesToCollection";

type Project = Awaited<ReturnType<typeof window.atp.listProjects>>[number];
type RunRow = Awaited<ReturnType<typeof window.atp.listRuns>>[number];

export default function App() {
  const [tab, setTab] = useState<AppTab>(() => loadPersistedTab() ?? "api");
  const { toast, notify } = useAppNotify();
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [suite, setSuite] = useState("smoke");
  const [env, setEnv] = useState("dev");
  const [assets, setAssets] = useState<{ environments: string[]; suites: string[]; cases: string[] } | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ summary: unknown; steps: unknown[] } | null>(null);
  const [workbenchDraft, setWorkbenchDraft] = useState<WorkbenchDraft | null>(null);
  const [projectCaseContext, setProjectCaseContext] = useState<{ caseName: string | null; yaml: string }>({
    caseName: null,
    yaml: "",
  });
  const [workbenchCollectionNonce, setWorkbenchCollectionNonce] = useState(0);
  const [loadTestDraft, setLoadTestDraft] = useState<WorkbenchDraft | null>(null);
  const [loadTestEnv, setLoadTestEnv] = useState<string>("dev");
  const [loadTestVars, setLoadTestVars] = useState<Record<string, string> | null>(null);
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

  const refreshRuns = useCallback(async () => {
    const list = await window.atp.listRuns({ limit: 30 });
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
    setAssetsLoading(true);
    try {
      const a = await window.atp.listProjectAssets(selectedProject);
      setAssets(a);
    } finally {
      setAssetsLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    void (async () => {
      setBootLoading(true);
      const timeout = (ms: number) =>
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), ms));
      try {
        const boot = Promise.all([refreshProjects(), refreshRuns()]);
        const done = await Promise.race([boot, timeout(12_000)]);
        if (done === "timeout") {
          notify("工作台加载超时，已显示界面。请检查 ATP_REPO_ROOT 或重新启动应用。");
        }
      } finally {
        setBootLoading(false);
      }
    })();
    // 仅启动时拉取一次，避免 selectedProject 变化反复全屏 loading
  }, [refreshProjects, refreshRuns, notify]);

  useEffect(() => {
    void window.atp.ensureNetworkDirect().then((r) => {
      if (r.messages.length) notify(r.messages.join(" "));
    });
  }, [notify]);

  useEffect(() => {
    if (tab !== "projects") return;
    void (async () => {
      await refreshProjects();
      if (selectedProject) await refreshAssets();
    })();
  }, [tab, refreshProjects, refreshAssets, selectedProject]);

  useEffect(() => {
    if (tab !== "projects" || !selectedProject) {
      setProjectCollections([]);
      return;
    }
    void window.atp.listCollections(selectedProject).then(setProjectCollections);
  }, [tab, selectedProject, assets]);

  useEffect(() => {
    if (!selectedProject) return;
    void (async () => {
      setAssetsLoading(true);
      try {
        const a = await window.atp.listProjectAssets(selectedProject);
        setAssets(a);
        if (a.suites.length && !a.suites.includes(suite)) setSuite(a.suites[0]);
        if (a.environments.length && !a.environments.includes(env)) setEnv(a.environments[0]);
      } finally {
        setAssetsLoading(false);
      }
    })();
  }, [selectedProject, suite, env]);

  const goTab = useCallback((next: AppTab) => {
    setTab(next);
    persistTab(next);
  }, []);

  const consumeWorkbenchDraft = useCallback(() => setWorkbenchDraft(null), []);

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
          if (draft) setWorkbenchDraft(draft);
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

  const onRun = async () => {
    if (!selectedProject) return;
    setRunning(true);
    setRunLog("");
    const result = await window.atp.runSuite({ project: selectedProject, suite, env });
    setRunLog(
      [result.stdout, result.stderr].filter(Boolean).join("\n") ||
        (result.code === 0 ? "执行成功" : "执行失败"),
    );
    setRunning(false);
    await refreshRuns();
  };

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

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">API Test Platform</div>

        <div className="sidebar-workspace">
            <span className="sidebar-workspace-label">工作区项目</span>
            <select
              className="sidebar-workspace-select"
              value={selectedProject}
              disabled={!projects.length}
              onChange={(e) => setSelectedProject(e.target.value)}
              aria-label="当前项目"
            >
              {!projects.length ? (
                <option value="">暂无项目</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            <div className="sidebar-workspace-actions">
              <button type="button" className="nav-btn nav-btn--compact" onClick={() => openCreateProject()}>
                + 项目
              </button>
              <button type="button" className="nav-btn nav-btn--compact" disabled={!selectedProject} onClick={() => goTab("projects")}>
                管理
              </button>
            </div>
            {selectedProject ? (
              <p className="sidebar-workspace-meta" title={selectedProject}>
                ID <code>{selectedProject}</code>
              </p>
            ) : null}
        </div>

        <nav className="sidebar-nav" aria-label="主功能">
          {(["dev", "assets", "auto"] as const).map((group) => (
            <div key={group} className="sidebar-nav-group">
              <div className="nav-section">{NAV_GROUP_LABELS[group]}</div>
              <div className="sidebar-nav-items">
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
          ))}
        </nav>

        <p className="sidebar-foot-hint">项目与工作区在全部模块共用</p>
      </aside>

      <main
        className={`main loading-host${tab === "api" ? " main--workbench" : ""}${tab === "load" ? " main--workbench" : ""}`}
      >
        <LoadingOverlay show={bootLoading} label="加载工作台…" />
        {needsProject && !projectReady && (
          <ProjectEmptyState
            title={projects.length ? "未选择项目" : "尚无项目"}
            hint={
              projects.length
                ? "请在左侧「工作区项目」下拉框中选择项目，或前往「项目与用例」管理资产。"
                : "创建第一个项目后，即可使用 API 工作台、抓包与负载测试。"
            }
            onCreateProject={() => openCreateProject()}
            onGoProjects={() => goTab("projects")}
          />
        )}
        {tab === "runs" && (
          <>
            <h2 className="page-head">执行记录</h2>
            <Card title="运行套件">
              <RunToolbar
                projects={projects}
                selectedProject={selectedProject}
                onProject={setSelectedProject}
                suite={suite}
                env={env}
                assets={assets}
                onSuite={setSuite}
                onEnv={setEnv}
                running={running}
                onRun={onRun}
              />
              {runLog && (
                <pre className="card" style={{ marginTop: 12 }}>
                  {runLog}
                </pre>
              )}
            </Card>

            <Card title="最近执行">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>状态</th>
                    <th>项目</th>
                    <th>套件</th>
                    <th>环境</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => void openRun(r.id)}>
                      <td>{r.started_at}</td>
                      <td>
                        <span className={`badge ${r.status}`}>{r.status}</span>
                      </td>
                      <td>{r.project}</td>
                      <td>{r.suite}</td>
                      <td>{r.environment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {selectedRunId && (
              <Card title={`详情 · ${selectedRunId}`}>
                <div className="loading-host" style={{ minHeight: 120 }}>
                  <LoadingOverlay show={runDetailLoading} label="加载执行详情…" />
                  {runDetail?.summary && (
                    <div className="grid-2">
                      <pre>{JSON.stringify(runDetail.summary, null, 2)}</pre>
                      <pre>{JSON.stringify(runDetail.steps, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}

        {tab === "projects" && (
          <>
            <h2 className="page-head">项目与用例</h2>
            {projects.length === 0 ? (
              <section className="card panel-empty-card">
                <div className="panel-empty-state">
                  <div className="panel-empty-icon" aria-hidden>
                    ◇
                  </div>
                  <p className="panel-empty-title">暂无项目</p>
                  <p className="panel-empty-hint">
                    项目对应仓库中的 <code>projects/&lt;id&gt;/</code> 目录，用于管理用例、环境与 API 集合。
                    请先创建项目。
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setCreateProjectBaseUrlHint(undefined);
                      setCreateProjectOpen(true);
                    }}
                  >
                    新建项目
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className="toolbar project-toolbar">
                  <label className="project-select-wrap">
                    <span className="project-select-label">当前项目</span>
                    <select
                      value={selectedProject}
                      onChange={(e) => setSelectedProject(e.target.value)}
                      aria-label="项目"
                    >
                      {!selectedProject ? (
                        <option value="" disabled>
                          请选择项目
                        </option>
                      ) : null}
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="nav-btn"
                    onClick={() => {
                      setCreateProjectBaseUrlHint(undefined);
                      setCreateProjectOpen(true);
                    }}
                  >
                    新建项目
                  </button>
                  <button
                    type="button"
                    className="nav-btn"
                    disabled={!selectedProject || projectDeleteBusy}
                    onClick={() => setPendingProjectDelete(true)}
                  >
                    删除项目
                  </button>
                </div>
                {selectedProject && (
                  <section className="card project-overview-card">
                    <div className="project-overview-head">
                      <div>
                        <h3 className="project-overview-title">
                          {projects.find((p) => p.id === selectedProject)?.name ?? selectedProject}
                        </h3>
                        <p className="project-overview-meta">
                          目录 ID：<code>{selectedProject}</code>
                          {assets
                            ? ` · 环境 ${assets.environments.length} · 套件 ${assets.suites.length} · 用例 ${assets.cases.length}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="nav-btn"
                        title="将全部 YAML 用例导入默认模块，并在编辑器打开当前选中的用例"
                        onClick={() => openApiWorkbench()}
                      >
                        打开工作台
                      </button>
                    </div>
                    {projectCollections.length > 0 && (
                      <p className="project-overview-collections">
                        API 集合：{" "}
                        {projectCollections.map((c) => `${c.name}（${c.requestCount} 条）`).join(" · ")}
                        <span className="project-overview-note">（集合在 API 工作台管理；本页主要管理 YAML 用例）</span>
                      </p>
                    )}
                  </section>
                )}
                <div className="loading-host projects-panel-host">
                  <LoadingOverlay show={assetsLoading && !bootLoading} label="加载项目资源…" />
                  <CasesPanel
                    project={selectedProject}
                    cases={assets?.cases ?? []}
                    onRefresh={() => void refreshAssets()}
                    onCasePreviewChange={handleCasePreviewChange}
                    onOpenInWorkbench={(draft) => {
                      setWorkbenchDraft(draft);
                      goTab("api");
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}

        {tab === "capture" && projectReady && (
          <PanelErrorBoundary name="capture">
            <CapturePanel
              project={selectedProject}
              projectName={selectedProjectName}
              onCaseSaved={() => void refreshAssets()}
              onGoToProjects={() => goTab("projects")}
              onOpenInWorkbench={(draft) => {
                setWorkbenchDraft(draft);
                goTab("api");
              }}
            />
          </PanelErrorBoundary>
        )}

        {tab === "api" && projectReady && (
          <PanelErrorBoundary name="api-workbench">
          <ApiWorkbench
            project={selectedProject}
            projectName={selectedProjectName}
            externalDraft={workbenchDraft}
            collectionReloadNonce={workbenchCollectionNonce}
            onConsumeExternalDraft={consumeWorkbenchDraft}
            onCaseSaved={() => void refreshAssets()}
            onRequestCreateProject={(hint) => openCreateProject(hint)}
            onSendToLoadTest={({ draft, envName, variables }) => {
              setLoadTestDraft(draft);
              setLoadTestEnv(envName);
              setLoadTestVars(variables);
              goTab("load");
            }}
          />
          </PanelErrorBoundary>
        )}

        {tab === "load" && projectReady && (
          <LoadTestPanel
            project={selectedProject}
            projectName={selectedProjectName}
            externalDraft={loadTestDraft}
            externalEnvName={loadTestEnv}
            externalVariables={loadTestVars}
            onConsumeExternalDraft={() => {
              setLoadTestDraft(null);
              setLoadTestVars(null);
            }}
          />
        )}
      </main>

      {toast ? (
        <div className="app-toast app-toast--global" role="status">
          <span className="app-toast-dot" />
          {toast}
        </div>
      ) : null}

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

function RunToolbar(props: {
  projects: Project[];
  selectedProject: string;
  onProject: (v: string) => void;
  suite: string;
  env: string;
  assets: { environments: string[]; suites: string[]; cases: string[] } | null;
  onSuite: (v: string) => void;
  onEnv: (v: string) => void;
  running: boolean;
  onRun: () => void;
}) {
  const { projects, selectedProject, onProject, suite, env, assets, onSuite, onEnv, running, onRun } = props;
  return (
    <div className="toolbar">
      <select value={selectedProject} onChange={(e) => onProject(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={suite} onChange={(e) => onSuite(e.target.value)}>
        {(assets?.suites ?? [suite]).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select value={env} onChange={(e) => onEnv(e.target.value)}>
        {(assets?.environments ?? [env]).map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <button type="button" className="primary" disabled={running || !selectedProject} onClick={() => void onRun()}>
        {running ? "执行中…" : "运行套件"}
      </button>
    </div>
  );
}