import { useCallback, useEffect, useState, type ReactNode } from "react";

import CapturePanel from "./CapturePanel";

type Tab = "runs" | "projects" | "capture";

type Project = Awaited<ReturnType<typeof window.atp.listProjects>>[number];
type RunRow = Awaited<ReturnType<typeof window.atp.listRuns>>[number];

export default function App() {
  const [tab, setTab] = useState<Tab>("runs");
  const [workspace, setWorkspace] = useState<{ repoRoot: string; python: string } | null>(null);
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
  const [casePreview, setCasePreview] = useState<string>("");

  const refreshRuns = useCallback(async () => {
    const list = await window.atp.listRuns({ limit: 30 });
    setRuns(list);
  }, []);

  const refreshProjects = useCallback(async () => {
    const list = await window.atp.listProjects();
    setProjects(list);
    if (list.length && !selectedProject) {
      setSelectedProject(list[0].id);
    }
  }, [selectedProject]);

  useEffect(() => {
    void (async () => {
      const ws = await window.atp.getWorkspace();
      setWorkspace(ws);
      await refreshProjects();
      await refreshRuns();
    })();
  }, [refreshProjects, refreshRuns]);

  useEffect(() => {
    if (!selectedProject) return;
    void (async () => {
      const a = await window.atp.listProjectAssets(selectedProject);
      setAssets(a);
      if (a.suites.length && !a.suites.includes(suite)) setSuite(a.suites[0]);
      if (a.environments.length && !a.environments.includes(env)) setEnv(a.environments[0]);
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

  const openRun = async (id: string) => {
    setSelectedRunId(id);
    const detail = await window.atp.getRunDetail(id);
    setRunDetail(detail);
    setTab("runs");
  };

  const previewCase = async (caseName: string) => {
    const text = await window.atp.readFile(`projects/${selectedProject}/cases/${caseName}.yaml`);
    setCasePreview(text ?? "(无法读取)");
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">API Test Platform</div>
        <div className="nav-section">功能</div>
        <button type="button" className={`nav-btn ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>
          执行记录
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "projects" ? "active" : ""}`}
          onClick={() => setTab("projects")}
        >
          项目与用例
        </button>
        <button
          type="button"
          className={`nav-btn ${tab === "capture" ? "active" : ""}`}
          onClick={() => setTab("capture")}
        >
          抓包
        </button>
      </aside>

      <main className="main">
        {workspace && (
          <p className="meta">
            工作区：{workspace.repoRoot} · Python：{workspace.python}
          </p>
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

            {selectedRunId && runDetail?.summary && (
              <Card title={`详情 · ${selectedRunId}`}>
                <div className="grid-2">
                  <pre>{JSON.stringify(runDetail.summary, null, 2)}</pre>
                  <pre>{JSON.stringify(runDetail.steps, null, 2)}</pre>
                </div>
              </Card>
            )}
          </>
        )}

        {tab === "projects" && (
          <>
            <h2 className="page-head">项目与用例</h2>
            <div className="toolbar">
              <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Card title="用例列表">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(assets?.cases ?? []).map((c) => (
                  <li key={c} style={{ marginBottom: 8 }}>
                    <button type="button" className="nav-btn" style={{ display: "inline" }} onClick={() => void previewCase(c)}>
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {casePreview && (
              <Card title="用例 YAML">
                <pre>{casePreview}</pre>
              </Card>
            )}
          </>
        )}

        {tab === "capture" && (
          <CapturePanel
            projects={projects}
            project={selectedProject}
            onProject={setSelectedProject}
          />
        )}
      </main>
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