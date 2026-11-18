import { useCallback, useEffect, useState, type ReactNode } from "react";

import ApiWorkbench from "./ApiWorkbench";
import CasesPanel from "./CasesPanel";
import CreateProjectDialog from "./CreateProjectDialog";
import CapturePanel from "./CapturePanel";
import ConfirmDialog from "./ConfirmDialog";
import LoadingOverlay from "./LoadingOverlay";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

type Tab = "runs" | "projects" | "capture" | "api";

type Project = Awaited<ReturnType<typeof window.atp.listProjects>>[number];
type RunRow = Awaited<ReturnType<typeof window.atp.listRuns>>[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("api");
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
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectBaseUrlHint, setCreateProjectBaseUrlHint] = useState<string | undefined>();
  const [bootLoading, setBootLoading] = useState(true);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [pendingProjectDelete, setPendingProjectDelete] = useState(false);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [pageMessage, setPageMessage] = useState("");
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
      try {
        await refreshProjects();
        await refreshRuns();
      } finally {
        setBootLoading(false);
      }
    })();
    // 仅启动时拉取一次，避免 selectedProject 变化反复全屏 loading
  }, [refreshProjects, refreshRuns]);

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

  const showPageMessage = (text: string) => {
    setPageMessage(text);
    window.setTimeout(() => setPageMessage(""), 3200);
  };

  const deleteCurrentProject = async () => {
    if (!selectedProject) return;
    const name = projects.find((p) => p.id === selectedProject)?.name ?? selectedProject;
    setProjectDeleteBusy(true);
    const res = await window.atp.deleteProject(selectedProject);
    setProjectDeleteBusy(false);
    setPendingProjectDelete(false);
    if (!res.ok) {
      showPageMessage(res.error ?? "删除项目失败");
      return;
    }
    const list = await window.atp.listProjects();
    setProjects(list);
    setSelectedProject(list[0]?.id ?? "");
    setAssets(null);
    showPageMessage(`已删除项目「${name}」`);
    if (list[0]) await refreshAssets();
  };

  const openRun = async (id: string) => {
    setSelectedRunId(id);
    setRunDetailLoading(true);
    setTab("runs");
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
        showPageMessage(res.error ?? "创建项目失败");
        return;
      }
      await refreshProjects();
      setSelectedProject(res.projectId);
      await refreshAssets();
      const label = opts.name.trim() || res.projectId;
      showPageMessage(`已创建项目「${label}」（ID: ${res.projectId}），可在「项目与用例」查看`);
    })();
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">API Test Platform</div>
        <div className="nav-section">功能</div>
        <button type="button" className={`nav-btn ${tab === "api" ? "active" : ""}`} onClick={() => setTab("api")}>
          API 工作台
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "capture" ? "active" : ""}`}
          onClick={() => setTab("capture")}
        >
          抓包
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "projects" ? "active" : ""}`}
          onClick={() => setTab("projects")}
        >
          项目与用例
        </button>
        <button type="button" className={`nav-btn ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>
          执行记录
        </button>
      </aside>

      <main className={`main loading-host${tab === "api" ? " main--workbench" : ""}`}>
        {pageMessage && tab !== "projects" && <p className="hint app-global-hint">{pageMessage}</p>}
        <LoadingOverlay show={bootLoading} label="加载工作台…" />
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
                {pageMessage && <p className="hint">{pageMessage}</p>}
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
                      <button type="button" className="nav-btn" onClick={() => setTab("api")}>
                        打开 API 工作台
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
                    onOpenInWorkbench={(draft) => {
                      setWorkbenchDraft(draft);
                      setTab("api");
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}

        {tab === "capture" && (
          <CapturePanel
            projects={projects}
            project={selectedProject}
            onProject={setSelectedProject}
            onCaseSaved={() => void refreshAssets()}
            onOpenInWorkbench={(draft) => {
              setWorkbenchDraft(draft);
              setTab("api");
            }}
          />
        )}

        {tab === "api" && (
          <ApiWorkbench
            projects={projects}
            project={selectedProject}
            onProject={setSelectedProject}
            externalDraft={workbenchDraft}
            onConsumeExternalDraft={() => setWorkbenchDraft(null)}
            onCaseSaved={() => void refreshAssets()}
            onRequestCreateProject={(hint) => {
              setCreateProjectBaseUrlHint(hint);
              setCreateProjectOpen(true);
            }}
          />
        )}
      </main>

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