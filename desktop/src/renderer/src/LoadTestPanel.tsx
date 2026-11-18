import { useCallback, useEffect, useMemo, useState } from "react";

import type { ApiCollectionFile, HttpBenchmarkReport, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import BenchmarkResults from "./BenchmarkResults";
import LoadTestHistoryPanel from "./LoadTestHistoryPanel";
import { archiveJmeterJtlToPerf } from "./jmeterPerfArchive";
import JmeterJtlPanel from "./JmeterJtlPanel";
import JmeterRunPanel from "./JmeterRunPanel";
import { HTTP_METHODS, normalizeRawBodyDraft, savedRequestToDraft } from "./apiWorkbenchModel";
import EnvContextBar from "./EnvContextBar";
import EnvVariablesDialog, { collectTemplateVarNames } from "./EnvVariablesDialog";
import LoadingOverlay from "./LoadingOverlay";
import { resolveWorkbenchPayload } from "./resolveWorkbenchRequest";
import {
  authPatchFromSampler,
  mergeAuthFromSampler,
  persistEnvVariables,
  unresolvedWorkbenchVars,
} from "./samplerAuth";
import {
  defaultLoadTestPlan,
  threadGroupToBenchmarkOpts,
  type LoadTestConfigNode,
  type LoadTestMainTab,
  type LoadTestPlan,
  type LoadTestThreadGroup,
} from "./loadTestModel";
import { TAB_DESCRIPTIONS } from "./navConfig";
import type { NotifyKind } from "./useAppNotify";

const CONFIG_LABELS: Record<LoadTestConfigNode, string> = {
  plan: "测试计划",
  threadGroup: "线程组",
  httpSampler: "HTTP 请求",
};

const MAIN_TAB_LABELS: Record<LoadTestMainTab, string> = {
  config: "压测配置",
  report: "聚合报告",
  history: "压测历史",
  jmeterRun: "执行 JMX",
  jmeterJtl: "JTL 报告",
};

const LOAD_MAIN_TABS: LoadTestMainTab[] = ["config", "report", "history", "jmeterRun", "jmeterJtl"];

const THREAD_PRESETS: Array<{
  id: string;
  label: string;
  threads: number;
  rampUpSec: number;
  loops: number;
}> = [
  { id: "smoke", label: "冒烟 1×1", threads: 1, rampUpSec: 0, loops: 1 },
  { id: "light", label: "轻量 5×2", threads: 5, rampUpSec: 2, loops: 2 },
  { id: "default", label: "默认 10×1", threads: 10, rampUpSec: 5, loops: 1 },
  { id: "stress", label: "压测 30×3", threads: 30, rampUpSec: 10, loops: 3 },
];

type ThreadFieldDef = {
  key: keyof LoadTestThreadGroup;
  label: string;
  sub: string;
  hint: string;
  min?: number;
  max?: number;
  step?: number;
};

const PRIMARY_THREAD_KEYS: Array<keyof LoadTestThreadGroup> = ["threads", "rampUpSec", "loops"];
const ADVANCED_THREAD_KEYS: Array<keyof LoadTestThreadGroup> = ["warmup", "timeoutMs"];

const THREAD_FIELDS: ThreadFieldDef[] = [
  {
    key: "threads",
    label: "线程数",
    sub: "Threads",
    hint: "并发虚拟用户，上限 50",
    min: 1,
    max: 50,
  },
  {
    key: "rampUpSec",
    label: "Ramp-Up",
    sub: "秒",
    hint: "在指定秒内逐步拉起全部线程",
    min: 0,
  },
  {
    key: "loops",
    label: "循环次数",
    sub: "Loops",
    hint: "每线程重复执行采样器的次数",
    min: 1,
    max: 500,
  },
  {
    key: "warmup",
    label: "预热样本",
    sub: "Warmup",
    hint: "不计入聚合统计，用于连接预热",
    min: 0,
  },
  {
    key: "timeoutMs",
    label: "请求超时",
    sub: "ms",
    hint: "单次 HTTP 等待上限",
    min: 1000,
    step: 1000,
  },
];

type Props = {
  project: string;
  projectName: string;
  onNotify?: (text: string, kind?: NotifyKind) => void;
  externalDraft: WorkbenchDraft | null;
  externalEnvName?: string;
  externalVariables?: Record<string, string> | null;
  onConsumeExternalDraft: () => void;
  onEditInWorkbench?: (payload: {
    draft: WorkbenchDraft;
    envName: string;
    variables: Record<string, string>;
  }) => void;
};

export default function LoadTestPanel({
  project,
  projectName,
  onNotify,
  externalDraft,
  externalEnvName,
  externalVariables,
  onConsumeExternalDraft,
}: Props) {
  const [plan, setPlan] = useState<LoadTestPlan>(defaultLoadTestPlan);
  const [mainTab, setMainTab] = useState<LoadTestMainTab>("config");
  const [configNode, setConfigNode] = useState<LoadTestConfigNode>("threadGroup");

  const crumbLabel =
    mainTab === "config" ? CONFIG_LABELS[configNode] : MAIN_TAB_LABELS[mainTab];

  const goConfig = (node: LoadTestConfigNode) => {
    setMainTab("config");
    setConfigNode(node);
  };
  const [pendingJtlPath, setPendingJtlPath] = useState("");
  const [envName, setEnvName] = useState("dev");
  const [environments, setEnvironments] = useState<string[]>(["dev"]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HttpBenchmarkReport | null>(null);
  const [collections, setCollections] = useState<Awaited<ReturnType<typeof window.atp.listCollections>>>([]);
  const [collectionId, setCollectionId] = useState("default");
  const [collection, setCollection] = useState<ApiCollectionFile | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [importFromCollectionOpen, setImportFromCollectionOpen] = useState(false);
  const [perfHistoryCount, setPerfHistoryCount] = useState(0);

  useEffect(() => {
    if (!project) {
      setPerfHistoryCount(0);
      return;
    }
    void window.atp.listPerfReports(project, 80).then((list) => setPerfHistoryCount(list.length));
  }, [project, report?.id]);

  const showToast = (text: string, kind: NotifyKind = "info") => {
    if (onNotify) onNotify(text, kind);
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
      goConfig("httpSampler");
      setImportFromCollectionOpen(false);
      onConsumeExternalDraft();
      showToast(
        withAuth.token?.trim()
          ? "已从 API 工作台载入请求，并同步 token"
          : "已从 API 工作台载入 HTTP 请求",
      );
    })();
  }, [externalDraft, externalEnvName, externalVariables, onConsumeExternalDraft, project, envName]);

  const missingEnvVars = useMemo(
    () => unresolvedWorkbenchVars(plan.sampler, variables),
    [plan.sampler, variables],
  );

  const onRun = useCallback(async () => {
    if (!project) {
      showToast("请先选择项目");
      return;
    }
    if (!plan.sampler.url.trim()) {
      showToast("请在 HTTP 请求中填写 URL");
      goConfig("httpSampler");
      return;
    }
    if (missingEnvVars.length) {
      showToast(`未配置变量：${missingEnvVars.join("、")}，请点「变量」填写`);
      setEnvDialogOpen(true);
      goConfig("httpSampler");
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
    setMainTab("report");
    try {
      const result = await window.atp.runHttpBenchmark(
        { ...payload, timeoutMs: plan.threadGroup.timeoutMs },
        opts,
        { name: plan.sampler.name },
      );
      setReport(result);
      if (project) {
        void window.atp.savePerfReport(project, result).then(() => {
          void window.atp.listPerfReports(project, 80).then((list) => setPerfHistoryCount(list.length));
        });
      }
      if (result.cancelled) showToast("已停止测试");
      else {
        const rate = Math.round((result.stats.success / Math.max(1, result.stats.samples)) * 100);
        showToast(`测试结束：成功率 ${rate}%`, rate >= 95 ? "success" : rate >= 80 ? "warn" : "error");
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
    canPickFromCollection ||
    linkedRequest ||
    importFromCollectionOpen ||
    (!project && mainTab === "config" && configNode === "httpSampler");
  const canStart = Boolean(project && samplerHasTarget && missingEnvVars.length === 0);
  const startDisabledReason = !project
    ? "请先选择项目"
    : !samplerHasTarget
      ? "请在 HTTP 请求中配置 URL"
      : missingEnvVars.length
        ? `缺变量：${missingEnvVars.join("、")}`
        : "";

  const applyThreadPreset = (preset: (typeof THREAD_PRESETS)[number]) => {
    setPlan((p) => ({
      ...p,
      threadGroup: {
        ...p.threadGroup,
        threads: preset.threads,
        rampUpSec: preset.rampUpSec,
        loops: preset.loops,
      },
    }));
  };

  const updateThreadGroup = (key: keyof LoadTestThreadGroup, raw: number, fallback: number) => {
    setPlan((p) => ({
      ...p,
      threadGroup: { ...p.threadGroup, [key]: Number.isFinite(raw) ? raw : fallback },
    }));
  };

  const rampPerThread =
    plan.threadGroup.threads > 0 && plan.threadGroup.rampUpSec > 0
      ? (plan.threadGroup.rampUpSec / plan.threadGroup.threads).toFixed(1)
      : null;

  const renderThreadField = (field: ThreadFieldDef, compact?: boolean) => {
    const value = plan.threadGroup[field.key];
    const fallback =
      field.key === "timeoutMs" ? 30_000 : field.key === "rampUpSec" || field.key === "warmup" ? 0 : 1;
    return (
      <label
        key={field.key}
        className={`loadtest-param-cell${compact ? " loadtest-param-cell--compact" : ""}`}
        title={field.hint}
      >
        <span className="loadtest-param-cell-label">
          <span>{field.label}</span>
          <span className="loadtest-param-cell-sub">{field.sub}</span>
        </span>
        <input
          type="number"
          className="text-input loadtest-param-cell-input"
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={running}
          value={value}
          onChange={(e) => updateThreadGroup(field.key, Number(e.target.value), fallback)}
        />
      </label>
    );
  };

  const fieldByKey = Object.fromEntries(THREAD_FIELDS.map((f) => [f.key, f])) as Record<
    keyof LoadTestThreadGroup,
    ThreadFieldDef
  >;

  const hideBenchRunToolbar = mainTab === "jmeterRun" || mainTab === "jmeterJtl" || mainTab === "history";
  const readinessKey = running ? "running" : canStart ? "ready" : "blocked";
  const readinessText = running ? "压测运行中" : canStart ? "可启动" : "待配置";
  const configStepTotal = 3;
  const configStepDone = [Boolean(project), samplerHasTarget, missingEnvVars.length === 0].filter(Boolean).length;

  const benchRunToolbar = (
    <div className="loadtest-editor-actions">
      <div className="loadtest-editor-actions-primary">
        {!canStart && !running && !samplerHasTarget ? (
          <button type="button" className="nav-btn nav-btn--compact" onClick={() => goConfig("httpSampler")}>
            配置 HTTP
          </button>
        ) : null}
        {!canStart && !running && samplerHasTarget && missingEnvVars.length ? (
          <button type="button" className="nav-btn nav-btn--compact" onClick={() => setEnvDialogOpen(true)}>
            填写变量
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={running || !canStart}
          title={!canStart && !running ? startDisabledReason : undefined}
          onClick={() => void onRun()}
        >
          {running ? "运行中…" : "启动压测"}
        </button>
        {running ? (
          <button type="button" className="nav-btn" onClick={onStop}>
            停止
          </button>
        ) : null}
      </div>
      <div className="loadtest-editor-actions-chips">
        <span className={`loadtest-readiness loadtest-readiness--${readinessKey}`}>{readinessText}</span>
        {canStart || running ? (
          <span className="loadtest-toolbar-meta loadtest-toolbar-meta--inline">
            <span className="loadtest-meta-chip">
              预期样本 <strong>{totalSamples}</strong>
            </span>
            <span className="loadtest-meta-chip loadtest-meta-chip--muted">
              {plan.threadGroup.threads} 线程 × {plan.threadGroup.loops} 循环
              {plan.threadGroup.warmup > 0 ? ` · 预热 ${plan.threadGroup.warmup}` : ""}
            </span>
          </span>
        ) : startDisabledReason ? (
          <span className="loadtest-editor-actions-hint" role="status">
            {startDisabledReason}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="loadtest">
      <header className="loadtest-header workbench-topbar">
        <div className="module-head-row loadtest-title-block">
          <div>
            <h2 className="page-head workbench-title loadtest-title">负载测试</h2>
            <p className="hint loadtest-header-lede">{TAB_DESCRIPTIONS.load}</p>
          </div>
          <span className="module-context-chip" title={`项目 ID：${project}`}>
            {projectName || project}
          </span>
        </div>
        <section className="atp-fin-query-panel" aria-label="压测查询条件">
          <h3 className="atp-fin-section-title">压测条件</h3>
          <div className="loadtest-header-card">
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
                <span className="loadtest-header-hint">内置压测 · JMX · JTL</span>
              </>
            }
          />
          </div>
        </section>

        <nav className="atp-fin-tabs loadtest-main-nav" role="tablist" aria-label="负载测试视图">
          {LOAD_MAIN_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mainTab === tab}
              className={`atp-fin-tab loadtest-main-nav-btn${mainTab === tab ? " active" : ""}`}
              onClick={() => setMainTab(tab)}
            >
              {MAIN_TAB_LABELS[tab]}
              {tab === "report" && (report || running) ? (
                <span className="loadtest-main-nav-badge" aria-hidden>
                  {running ? "…" : "●"}
                </span>
              ) : null}
              {tab === "history" && perfHistoryCount > 0 ? (
                <span className="loadtest-main-nav-badge" aria-hidden>
                  {perfHistoryCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <div className={`loadtest-body${mainTab !== "config" ? " loadtest-body--no-tree" : ""}`}>
        {mainTab === "config" ? (
          <aside className="loadtest-tree-panel" aria-label="测试计划结构">
            <div className="loadtest-tree-scroll">
              <div className="loadtest-tree-title">计划元素</div>
              <button
                type="button"
                className={`loadtest-tree-item loadtest-tree-item--depth0 loadtest-tree-item--plan${configNode === "plan" ? " active" : ""}`}
                onClick={() => goConfig("plan")}
              >
                <span className="loadtest-tree-chevron" aria-hidden />
                <span className="loadtest-tree-item-text">{plan.planName}</span>
              </button>
              <div className="loadtest-tree-branch" aria-hidden />
              <button
                type="button"
                className={`loadtest-tree-item loadtest-tree-item--depth1${configNode === "threadGroup" ? " active" : ""}`}
                onClick={() => goConfig("threadGroup")}
              >
                <span className="loadtest-tree-item-text">线程组</span>
                <span className="hint loadtest-tree-item-meta">
                  {plan.threadGroup.threads}×{plan.threadGroup.loops}
                </span>
              </button>
              <button
                type="button"
                className={`loadtest-tree-item loadtest-tree-item--depth1${configNode === "httpSampler" ? " active" : ""}`}
                onClick={() => goConfig("httpSampler")}
              >
                <span className="loadtest-tree-item-text">HTTP 请求</span>
                <span
                  className={`loadtest-tree-status${samplerHasTarget ? " loadtest-tree-status--ok" : " loadtest-tree-status--warn"}`}
                  title={samplerHasTarget ? "已配置 URL" : "未配置 URL"}
                  aria-hidden
                />
              </button>
            </div>
            <div className="loadtest-tree-footer">
              <div className="loadtest-tree-progress-head">
                <span>配置进度</span>
                <span className="loadtest-tree-progress-count">
                  {configStepDone}/{configStepTotal}
                </span>
              </div>
              <div
                className="loadtest-tree-progress-bar"
                role="progressbar"
                aria-valuenow={configStepDone}
                aria-valuemin={0}
                aria-valuemax={configStepTotal}
              >
                <span
                  className="loadtest-tree-progress-fill"
                  style={{ width: `${(configStepDone / configStepTotal) * 100}%` }}
                />
              </div>
            </div>
          </aside>
        ) : null}

        <section
          className={`loadtest-editor atp-fin-result-panel${mainTab === "report" ? " loadtest-editor--report" : ""}${
            mainTab === "history" ? " loadtest-editor--history" : ""
          }${mainTab === "jmeterRun" || mainTab === "jmeterJtl" ? " loadtest-editor--jmeter" : ""}`}
        >
          <h3 className="atp-fin-section-title loadtest-result-section-title">数据结果</h3>
          <header className="loadtest-editor-head">
            <div className="loadtest-editor-head-row">
              <div className="loadtest-editor-crumb" aria-live="polite">
                <span className="loadtest-editor-crumb-plan">{plan.planName}</span>
                <span className="loadtest-editor-crumb-sep">/</span>
                <span className="loadtest-editor-crumb-current">{crumbLabel}</span>
              </div>
            </div>

            {mainTab === "report" ? (
              <p className="hint loadtest-report-topbar-lede">
                本次执行的聚合指标与分布图；历史记录、合并导出 PDF / JSON 请切换到「压测历史」。
              </p>
            ) : null}
            {mainTab === "history" ? (
              <p className="hint loadtest-report-topbar-lede">
                浏览内置压测存档，支持单条或批量导出 PDF、导出 JSON、删除记录。
              </p>
            ) : null}

            {!hideBenchRunToolbar ? benchRunToolbar : null}
          </header>

          <div className="loadtest-editor-scroll">
          {mainTab === "config" && configNode === "plan" && (
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

          {mainTab === "config" && configNode === "threadGroup" && (
            <div className="loadtest-panel loadtest-panel--thread">
              <div className="loadtest-thread-layout">
                <div className="loadtest-thread-shell">
                  <header className="loadtest-thread-shell-head loadtest-thread-shell-head--row">
                    <div>
                      <h3 className="loadtest-thread-shell-title">线程组</h3>
                      <p className="loadtest-thread-shell-lede">并发 · Ramp-Up · 循环</p>
                    </div>
                    <div className="loadtest-preset-segment" role="group" aria-label="快速预设">
                      {THREAD_PRESETS.map((preset) => {
                        const active =
                          plan.threadGroup.threads === preset.threads &&
                          plan.threadGroup.rampUpSec === preset.rampUpSec &&
                          plan.threadGroup.loops === preset.loops;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            className={`loadtest-preset-segment-btn${active ? " active" : ""}`}
                            disabled={running}
                            onClick={() => applyThreadPreset(preset)}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </header>

                  <div className="loadtest-param-strip" aria-label="主要参数">
                    {PRIMARY_THREAD_KEYS.map((key) => renderThreadField(fieldByKey[key]))}
                  </div>

                  <div className="loadtest-param-strip loadtest-param-strip--sub" aria-label="高级参数">
                    <span className="loadtest-param-strip-tag">高级</span>
                    {ADVANCED_THREAD_KEYS.map((key) => renderThreadField(fieldByKey[key], true))}
                  </div>

                  {rampPerThread ? (
                    <p className="loadtest-thread-footnote">
                      爬坡间隔约 <strong>{rampPerThread}s</strong>/线程（{plan.threadGroup.rampUpSec}s ÷{" "}
                      {plan.threadGroup.threads}）
                    </p>
                  ) : null}
                </div>

                <aside className="loadtest-thread-aside" aria-label="压测概览与步骤">
                  <h4 className="loadtest-aside-title">压测概览</h4>
                  <ul className="loadtest-aside-stats">
                    <li>
                      <span className="loadtest-aside-stat-label">预期样本</span>
                      <span className="loadtest-aside-stat-value">{totalSamples}</span>
                    </li>
                    <li>
                      <span className="loadtest-aside-stat-label">Ramp-Up</span>
                      <span className="loadtest-aside-stat-value">{plan.threadGroup.rampUpSec}s</span>
                    </li>
                    <li>
                      <span className="loadtest-aside-stat-label">单请求超时</span>
                      <span className="loadtest-aside-stat-value">
                        {plan.threadGroup.timeoutMs >= 1000
                          ? `${plan.threadGroup.timeoutMs / 1000}s`
                          : `${plan.threadGroup.timeoutMs}ms`}
                      </span>
                    </li>
                    <li>
                      <span className="loadtest-aside-stat-label">HTTP 采样</span>
                      <span
                        className={`loadtest-aside-stat-value${samplerHasTarget ? " ok" : " warn"}`}
                      >
                        {samplerHasTarget ? "已配置" : "未配置"}
                      </span>
                    </li>
                  </ul>

                  <h4 className="loadtest-aside-title">下一步</h4>
                  <ol className="loadtest-aside-steps">
                    <li className={samplerHasTarget ? "done" : "current"}>
                      在 HTTP 请求中设置 URL{samplerHasTarget ? "（已完成）" : ""}
                    </li>
                    <li className={missingEnvVars.length === 0 && samplerHasTarget ? "done" : canStart ? "current" : ""}>
                      检查环境变量与环境 {envName}
                    </li>
                    <li>点击工具栏「启动压测」，在聚合报告查看结果</li>
                  </ol>

                  {!samplerHasTarget ? (
                    <button
                      type="button"
                      className="primary loadtest-aside-cta"
                      onClick={() => goConfig("httpSampler")}
                    >
                      去配置 HTTP 请求
                    </button>
                  ) : canStart ? (
                    <button
                      type="button"
                      className="primary loadtest-aside-cta"
                      disabled={running}
                      onClick={() => void onRun()}
                    >
                      {running ? "运行中…" : "启动压测"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="nav-btn loadtest-aside-cta"
                      onClick={() => setEnvDialogOpen(true)}
                    >
                      填写环境变量
                    </button>
                  )}
                </aside>
              </div>
            </div>
          )}

          {mainTab === "config" && configNode === "httpSampler" && (
            <div className="loadtest-panel loadtest-panel--sampler card">
              {showImportStrip ? (
                <div className="loadtest-sampler-source-bar">
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
                    <div className="loadtest-sampler-request-head">
                      <div className="loadtest-sampler-request-identity">
                        <span className="loadtest-sampler-request-kicker">集合请求</span>
                        <span
                          className="loadtest-sampler-request-name"
                          title={
                            linkedRequest?.name || plan.sampler.name?.trim() || plan.sampler.url || ""
                          }
                        >
                          {linkedRequest?.name ||
                            plan.sampler.name?.trim() ||
                            (samplerHasTarget ? "手动配置采样器" : "未绑定，请导入或填写下方 URL")}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact loadtest-sampler-collection-btn"
                        disabled={!canPickFromCollection}
                        onClick={() => setImportFromCollectionOpen(true)}
                      >
                        {samplerHasTarget || linkedRequest ? "更换" : "从集合导入"}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <label className="loadtest-field loadtest-sampler-url-field">
                <span>请求地址</span>
                <div className="loadtest-sampler-row">
                  <select
                    className="workbench-method"
                    value={plan.sampler.method}
                    onChange={(e) =>
                      setPlan((p) => ({ ...p, sampler: { ...p.sampler, method: e.target.value } }))
                    }
                    aria-label="HTTP 方法"
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
                    spellCheck={false}
                    onChange={(e) =>
                      setPlan((p) => ({ ...p, sampler: { ...p.sampler, url: e.target.value } }))
                    }
                  />
                </div>
              </label>
              <label className="loadtest-field loadtest-sampler-body-field">
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

          {mainTab === "report" && (
            <BenchmarkResults
              report={report}
              running={running}
              project={project}
              onToast={showToast}
              onOpenHistory={() => setMainTab("history")}
            />
          )}

          {mainTab === "history" && (
            <LoadTestHistoryPanel
              project={project}
              currentReport={report}
              onToast={showToast}
              onHistoryCountChange={setPerfHistoryCount}
            />
          )}

          {mainTab === "jmeterRun" && (
            <JmeterRunPanel
              project={project}
              onToast={showToast}
              onRunFinished={({ jtlPath, jmxPath }) => {
                setPendingJtlPath(jtlPath);
                void (async () => {
                  if (!project) {
                    setMainTab("jmeterJtl");
                    showToast("已跳转 JTL 报告页");
                    return;
                  }
                  const archived = await archiveJmeterJtlToPerf(project, jtlPath, jmxPath);
                  if (archived.ok) {
                    const list = await window.atp.listPerfReports(project, 200);
                    setPerfHistoryCount(list.length);
                    setMainTab("history");
                    showToast(
                      `JMX 执行完成，已写入压测历史（${archived.relativePath ?? "perf"}）`,
                      "success",
                    );
                  } else {
                    setMainTab("jmeterJtl");
                    showToast(archived.error ?? "未能写入压测历史，请在 JTL 报告页手动加载");
                  }
                })();
              }}
            />
          )}

          {mainTab === "jmeterJtl" && (
            <JmeterJtlPanel
              project={project}
              envName={envName}
              onToast={showToast}
              initialJtlPath={pendingJtlPath}
            />
          )}
          </div>
        </section>
      </div>

      <EnvVariablesDialog
        open={envDialogOpen}
        project={project}
        envName={envName}
        sampler={plan.sampler}
        variableNames={collectTemplateVarNames(plan.sampler)}
        onCancel={() => setEnvDialogOpen(false)}
        onSaved={() => {
          setEnvDialogOpen(false);
          void window.atp.getProjectVariables(project, envName).then(setVariables);
          showToast("环境变量已保存，可重新启动压测");
        }}
      />

    </div>
  );
}