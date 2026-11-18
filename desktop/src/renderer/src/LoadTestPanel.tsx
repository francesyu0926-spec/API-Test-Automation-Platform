import { useCallback, useEffect, useMemo, useState } from "react";

import type { ApiCollectionFile, HttpBenchmarkReport, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import BenchmarkResults from "./BenchmarkResults";
import { HTTP_METHODS, normalizeRawBodyDraft, savedRequestToDraft } from "./apiWorkbenchModel";
import EnvContextBar from "./EnvContextBar";
import EnvVariablesDialog, { collectTemplateVarNames } from "./EnvVariablesDialog";
import LoadingOverlay from "./LoadingOverlay";
import { findUndefinedVars } from "../../shared/vars";
import { resolveWorkbenchPayload } from "./resolveWorkbenchRequest";
import { authPatchFromSampler, mergeAuthFromSampler, persistEnvVariables } from "./samplerAuth";
import {
  defaultLoadTestPlan,
  threadGroupToBenchmarkOpts,
  type LoadTestPlan,
  type LoadTestTreeNode,
} from "./loadTestModel";

type Props = {
  project: string;
  projectName: string;
  externalDraft: WorkbenchDraft | null;
  externalEnvName?: string;
  externalVariables?: Record<string, string> | null;
  onConsumeExternalDraft: () => void;
};

export default function LoadTestPanel({
  project,
  projectName,
  externalDraft,
  externalEnvName,
  externalVariables,
  onConsumeExternalDraft,
}: Props) {
  const [plan, setPlan] = useState<LoadTestPlan>(defaultLoadTestPlan);
  const [tree, setTree] = useState<LoadTestTreeNode>("threadGroup");
  const [envName, setEnvName] = useState("dev");
  const [environments, setEnvironments] = useState<string[]>(["dev"]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HttpBenchmarkReport | null>(null);
  const [toast, setToast] = useState("");
  const [collections, setCollections] = useState<Awaited<ReturnType<typeof window.atp.listCollections>>>([]);
  const [collectionId, setCollectionId] = useState("default");
  const [collection, setCollection] = useState<ApiCollectionFile | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [importFromCollectionOpen, setImportFromCollectionOpen] = useState(false);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  };

  const effectiveCollectionId = useMemo(() => {
    if (!collections.length) return collectionId || "default";
    return collections.some((c) => c.id === collectionId) ? collectionId : collections[0].id;
  }, [collections, collectionId]);

  const loadCollections = useCallback(async () => {
    if (!project) {
      setCollections([]);
      setCollection(null);
      return;
    }
    const list = await window.atp.listCollections(project);
    setCollections(list);
    if (!list.some((c) => c.id === collectionId) && list.length) {
      setCollectionId(list[0].id);
    }
    if (!list.length) {
      await window.atp.ensureCollection(project, "default");
      const again = await window.atp.listCollections(project);
      setCollections(again);
      setCollectionId("default");
    }
  }, [project, collectionId]);

  const loadCollection = useCallback(async () => {
    if (!project || !effectiveCollectionId) {
      setCollection(null);
      return;
    }
    setCollectionsLoading(true);
    try {
      const doc =
        (await window.atp.getCollection(project, effectiveCollectionId)) ??
        (await window.atp.ensureCollection(project, effectiveCollectionId));
      setCollection(doc);
    } finally {
      setCollectionsLoading(false);
    }
  }, [project, effectiveCollectionId]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    void loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    if (!project) return;
    setPlan(defaultLoadTestPlan());
    setCollectionId("default");
    setImportFromCollectionOpen(false);
  }, [project]);

  useEffect(() => {
    if (!project) return;
    void window.atp.listProjectAssets(project).then((a) => {
      const envs = a.environments.length ? a.environments : ["dev"];
      setEnvironments(envs);
      setEnvName((prev) => (envs.includes(prev) ? prev : envs[0]));
    });
  }, [project]);

  useEffect(() => {
    if (!project || !envName) return;
    void window.atp.getProjectVariables(project, envName).then(setVariables);
  }, [project, envName]);

  useEffect(() => {
    if (!externalDraft) return;
    const normalized = normalizeRawBodyDraft(externalDraft);
    void (async () => {
      const targetEnv = externalEnvName || envName;
      if (externalEnvName) setEnvName(externalEnvName);
      const base =
        project && targetEnv ? await window.atp.getProjectVariables(project, targetEnv) : (externalVariables ?? {});
      const withAuth = mergeAuthFromSampler({ ...base, ...(externalVariables ?? {}) }, normalized);
      setVariables(withAuth);
      const authPatch = authPatchFromSampler(normalized);
      if (project && targetEnv && Object.keys(authPatch).length) {
        await persistEnvVariables(project, targetEnv, authPatch);
      }
      setPlan((p) => ({
        ...p,
        sampler: normalized,
        sourceRequestId: null,
        sourceCollectionId: null,
      }));
      setTree("httpSampler");
      setImportFromCollectionOpen(false);
      onConsumeExternalDraft();
      showToast(
        withAuth.token?.trim()
          ? "已从 API 工作台载入请求，并同步 token"
          : "已从 API 工作台载入 HTTP 请求",
      );
    })();
  }, [externalDraft, externalEnvName, externalVariables, onConsumeExternalDraft, project, envName]);

  const missingEnvVars = useMemo(() => {
    const s = plan.sampler;
    const blobs = [s.url, s.body, ...s.query.map((q) => q.value), ...s.headers.map((h) => h.value)];
    const missing = new Set<string>();
    for (const text of blobs) {
      for (const key of findUndefinedVars(text, variables)) missing.add(key);
    }
    return [...missing];
  }, [plan.sampler, variables]);

  const onRun = useCallback(async () => {
    if (!project) {
      showToast("请先选择项目");
      return;
    }
    if (!plan.sampler.url.trim()) {
      showToast("请在 HTTP 请求中填写 URL");
      setTree("httpSampler");
      return;
    }
    if (missingEnvVars.length) {
      showToast(`未配置变量：${missingEnvVars.join("、")}，请点「变量」填写`);
      setEnvDialogOpen(true);
      setTree("httpSampler");
      return;
    }
    let payload;
    try {
      payload = resolveWorkbenchPayload(plan.sampler, variables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "请检查环境变量";
      showToast(msg);
      if (msg.includes("未定义变量")) setEnvDialogOpen(true);
      return;
    }
    const opts = threadGroupToBenchmarkOpts(plan.threadGroup);
    setRunning(true);
    setReport(null);
    setTree("aggregateReport");
    try {
      const result = await window.atp.runHttpBenchmark(
        { ...payload, timeoutMs: plan.threadGroup.timeoutMs },
        opts,
        { name: plan.sampler.name },
      );
      setReport(result);
      if (result.cancelled) showToast("已停止测试");
      else {
        const rate = Math.round((result.stats.success / Math.max(1, result.stats.samples)) * 100);
        showToast(`测试结束：成功率 ${rate}%`);
      }
    } finally {
      setRunning(false);
    }
  }, [plan, variables, project, missingEnvVars]);

  const onStop = () => {
    void window.atp.cancelHttpBenchmark();
    showToast("正在停止…");
  };

  const totalSamples = plan.threadGroup.threads * plan.threadGroup.loops;

  const pickRequest = (requestId: string) => {
    const req = collection?.requests.find((r) => r.id === requestId);
    if (!req) {
      showToast("请求不存在，正在刷新集合…");
      void loadCollection();
      return;
    }
    const sampler = savedRequestToDraft(req);
    const withAuth = mergeAuthFromSampler(variables, sampler);
    setVariables(withAuth);
    setPlan((p) => ({
      ...p,
      sampler,
      sourceRequestId: req.id,
      sourceCollectionId: effectiveCollectionId,
    }));
    setImportFromCollectionOpen(false);
    showToast(
      withAuth.token && withAuth.token !== variables.token
        ? `已载入「${req.name}」（已从 Header 读取 token）`
        : `已载入「${req.name}」`,
    );
  };

  const projectRequests = collection?.requests ?? [];
  const linkedRequest = useMemo(() => {
    if (!plan.sourceRequestId || !collection) return null;
    return collection.requests.find((r) => r.id === plan.sourceRequestId) ?? null;
  }, [plan.sourceRequestId, collection]);

  const samplerHasTarget = Boolean(plan.sampler.url.trim());
  const canPickFromCollection = Boolean(project && collections.length);
  const showImportStrip =
    canPickFromCollection || linkedRequest || importFromCollectionOpen || (!project && tree === "httpSampler");

  return (
    <div className="loadtest">
      <header className="loadtest-header workbench-topbar">
        <div className="module-head-row">
          <h2 className="page-head workbench-title">负载测试</h2>
          <span className="module-context-chip" title={`项目 ID：${project}`}>
            {projectName || project}
          </span>
        </div>
        <EnvContextBar
          envName={envName}
          environments={environments}
          disabled={!project}
          onEnvChange={setEnvName}
          onOpenVars={() => setEnvDialogOpen(true)}
          trailing={
            <>
              {missingEnvVars.length > 0 ? (
                <span className="loadtest-vars-warn" title={missingEnvVars.join(", ")}>
                  缺变量：{missingEnvVars.join("、")}
                </span>
              ) : null}
              <span className="loadtest-header-hint">线程组 · HTTP 采样 · 聚合报告</span>
            </>
          }
        />
      </header>

      <div className="loadtest-body">
        <aside className="loadtest-tree-panel">
          <div className="loadtest-tree-title">测试计划</div>
          <button
            type="button"
            className={`loadtest-tree-item loadtest-tree-item--depth0${tree === "plan" ? " active" : ""}`}
            onClick={() => setTree("plan")}
          >
            ▾ {plan.planName}
          </button>
          <button
            type="button"
            className={`loadtest-tree-item loadtest-tree-item--depth1${tree === "threadGroup" ? " active" : ""}`}
            onClick={() => setTree("threadGroup")}
          >
            线程组
          </button>
          <button
            type="button"
            className={`loadtest-tree-item loadtest-tree-item--depth1${tree === "httpSampler" ? " active" : ""}`}
            onClick={() => setTree("httpSampler")}
          >
            HTTP 请求
          </button>
          <div className="loadtest-tree-divider" />
          <div className="loadtest-tree-kicker">监听器</div>
          <button
            type="button"
            className={`loadtest-tree-item loadtest-tree-item--depth1${tree === "aggregateReport" ? " active" : ""}`}
            onClick={() => setTree("aggregateReport")}
          >
            聚合报告
          </button>
        </aside>

        <section className="loadtest-editor">
          <div className="loadtest-toolbar">
            <button type="button" className="primary" disabled={running || !project} onClick={() => void onRun()}>
              {running ? "运行中…" : "启动"}
            </button>
            {running && (
              <button type="button" className="nav-btn" onClick={onStop}>
                停止
              </button>
            )}
            <span className="loadtest-toolbar-meta">
              预期样本 ≈ {totalSamples}（{plan.threadGroup.threads} 线程 × {plan.threadGroup.loops} 循环）
            </span>
          </div>

          {tree === "plan" && (
            <div className="loadtest-panel card">
              <h3 className="loadtest-panel-title">测试计划</h3>
              <label className="loadtest-field">
                <span>计划名称</span>
                <input
                  className="text-input"
                  value={plan.planName}
                  onChange={(e) => setPlan((p) => ({ ...p, planName: e.target.value }))}
                />
              </label>
              <p className="hint">
                结构对标 Apache JMeter：测试计划下挂「线程组」与「HTTP 请求」采样器，执行后由「聚合报告」汇总指标。
              </p>
            </div>
          )}

          {tree === "threadGroup" && (
            <div className="loadtest-panel card">
              <h3 className="loadtest-panel-title">线程组</h3>
              <div className="loadtest-form-grid">
                <label className="loadtest-field">
                  <span>线程数（Number of Threads）</span>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={50}
                    disabled={running}
                    value={plan.threadGroup.threads}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        threadGroup: { ...p.threadGroup, threads: Number(e.target.value) || 1 },
                      }))
                    }
                  />
                </label>
                <label className="loadtest-field">
                  <span>Ramp-Up 时间（秒）</span>
                  <input
                    type="number"
                    className="text-input"
                    min={0}
                    disabled={running}
                    value={plan.threadGroup.rampUpSec}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        threadGroup: { ...p.threadGroup, rampUpSec: Number(e.target.value) || 0 },
                      }))
                    }
                  />
                </label>
                <label className="loadtest-field">
                  <span>循环次数（Loop Count）</span>
                  <input
                    type="number"
                    className="text-input"
                    min={1}
                    max={500}
                    disabled={running}
                    value={plan.threadGroup.loops}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        threadGroup: { ...p.threadGroup, loops: Number(e.target.value) || 1 },
                      }))
                    }
                  />
                </label>
                <label className="loadtest-field">
                  <span>预热样本数</span>
                  <input
                    type="number"
                    className="text-input"
                    min={0}
                    disabled={running}
                    value={plan.threadGroup.warmup}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        threadGroup: { ...p.threadGroup, warmup: Number(e.target.value) || 0 },
                      }))
                    }
                  />
                </label>
                <label className="loadtest-field">
                  <span>请求超时（ms）</span>
                  <input
                    type="number"
                    className="text-input"
                    min={1000}
                    step={1000}
                    disabled={running}
                    value={plan.threadGroup.timeoutMs}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        threadGroup: { ...p.threadGroup, timeoutMs: Number(e.target.value) || 30_000 },
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {tree === "httpSampler" && (
            <div className="loadtest-panel card">
              <h3 className="loadtest-panel-title">HTTP 请求</h3>

              {showImportStrip ? (
                <div className="loadtest-import-strip">
                  {!project ? (
                    <span className="hint loadtest-import-hint">选择侧栏项目后可从集合导入</span>
                  ) : importFromCollectionOpen ? (
                    <div className="loadtest-pick-block loadtest-pick-block--open loading-host">
                      <LoadingOverlay show={collectionsLoading} label="加载集合…" />
                      <div className="loadtest-pick-head">
                        <span className="loadtest-pick-label">从集合选择</span>
                        <select
                          className="workbench-sidebar-select loadtest-pick-module"
                          value={effectiveCollectionId}
                          disabled={!collections.length}
                          onChange={(e) => {
                            setCollectionId(e.target.value);
                            setPlan((p) => ({ ...p, sourceRequestId: null }));
                          }}
                        >
                          {!collections.length ? (
                            <option value="">暂无模块</option>
                          ) : (
                            collections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} · {c.requestCount}
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          className="nav-btn loadtest-import-close"
                          onClick={() => setImportFromCollectionOpen(false)}
                        >
                          收起
                        </button>
                      </div>
                      {projectRequests.length === 0 ? (
                        <p className="hint">该模块暂无请求，可在 API 工作台「保存到集合」</p>
                      ) : (
                        <ul className="loadtest-pick-list">
                          {projectRequests.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                className={`loadtest-pick-item${plan.sourceRequestId === r.id ? " active" : ""}`}
                                onClick={() => pickRequest(r.id)}
                              >
                                <span className={`method-tag method-${r.method.toLowerCase()}`}>{r.method}</span>
                                <span className="loadtest-pick-name">{r.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div className="loadtest-import-collapsed">
                      {linkedRequest || samplerHasTarget ? (
                        <span className="loadtest-import-meta" title={plan.sampler.url}>
                          {linkedRequest ? (
                            <>
                              <span className={`method-tag method-${linkedRequest.method.toLowerCase()}`}>
                                {linkedRequest.method}
                              </span>
                              <span className="loadtest-import-meta-name">{linkedRequest.name}</span>
                            </>
                          ) : (
                            <span className="loadtest-import-meta-name">
                              {plan.sampler.name?.trim() || "当前采样器"}
                            </span>
                          )}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="nav-btn loadtest-import-toggle"
                        disabled={!canPickFromCollection}
                        onClick={() => setImportFromCollectionOpen(true)}
                      >
                        {samplerHasTarget || linkedRequest ? "从集合更换…" : "从集合导入…"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="loadtest-sampler-row">
                <select
                  className="workbench-method"
                  value={plan.sampler.method}
                  onChange={(e) =>
                    setPlan((p) => ({ ...p, sampler: { ...p.sampler, method: e.target.value } }))
                  }
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  className="text-input loadtest-url"
                  value={plan.sampler.url}
                  placeholder="https://host/path 或 {{base_url}}/path"
                  onChange={(e) =>
                    setPlan((p) => ({ ...p, sampler: { ...p.sampler, url: e.target.value } }))
                  }
                />
              </div>
              <label className="loadtest-field" style={{ marginTop: 12 }}>
                <span>Body（raw）</span>
                <textarea
                  className="workbench-body-textarea"
                  value={plan.sampler.body}
                  spellCheck={false}
                  onChange={(e) =>
                    setPlan((p) => ({
                      ...p,
                      sampler: { ...p.sampler, bodyMode: "raw", body: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
          )}

          {tree === "aggregateReport" && (
            <BenchmarkResults report={report} running={running} project={project} onToast={showToast} />
          )}
        </section>
      </div>

      <EnvVariablesDialog
        open={envDialogOpen}
        project={project}
        envName={envName}
        variableNames={collectTemplateVarNames(plan.sampler)}
        onCancel={() => setEnvDialogOpen(false)}
        onSaved={() => {
          setEnvDialogOpen(false);
          void window.atp.getProjectVariables(project, envName).then(setVariables);
          showToast("环境变量已保存，可重新启动压测");
        }}
      />

      {toast && (
        <div className="app-toast" role="status">
          <span className="app-toast-dot" />
          {toast}
        </div>
      )}
    </div>
  );
}