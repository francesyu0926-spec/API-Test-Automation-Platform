import { useCallback, useEffect, useMemo, useState } from "react";

import type { ApiCollectionFile, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import LoadTestHistoryPanel from "./LoadTestHistoryPanel";
import { archiveJmeterJtlToPerf } from "./jmeterPerfArchive";
import JmeterJtlPanel from "./JmeterJtlPanel";
import JmeterRunPanel from "./JmeterRunPanel";
import { HTTP_METHODS, normalizeRawBodyDraft, savedRequestToDraft } from "./apiWorkbenchModel";
import { useProjectEnv } from "./ProjectEnvContext";
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
  loadPersistedLoadMainTab,
  persistLoadMainTab,
  type LoadTestConfigNode,
  type LoadTestMainTab,
  type LoadTestPlan,
  type LoadTestThreadGroup,
} from "./loadTestModel";
import { writeLoadTestPlanJmx } from "./loadTestJmx";
import JtlStreamModeField from "./JtlStreamModeField";
import AppCustomSelect from "./AppCustomSelect";
import { loadPersistedJtlStreamMode, persistJtlStreamMode } from "./jtlStreamModePrefs";
import type { JtlStreamModeId } from "../../shared/jtlStreamModes";
import type { NotifyKind } from "./useAppNotify";
import AppModuleChrome from "./AppModuleChrome";

const CONFIG_LABELS: Record<LoadTestConfigNode, string> = {
  plan: "测试计划",
  threadGroup: "线程组",
  httpSampler: "HTTP 请求",
};

const MAIN_TAB_LABELS: Record<LoadTestMainTab, string> = {
  config: "压测配置",
  history: "压测历史",
  jmeterRun: "执行 JMX",
  jmeterJtl: "JTL 报告",
};

const LOAD_MAIN_TABS: LoadTestMainTab[] = ["config", "jmeterRun", "jmeterJtl", "history"];

const THREAD_PRESETS: Array<{
  id: string;
  label: string;
  threads: number;
  rampUpSec: number;
  loops: number;
}> = [
  { id: "smoke", label: "冒烟", threads: 1, rampUpSec: 0, loops: 1 },
  { id: "light", label: "轻量", threads: 5, rampUpSec: 2, loops: 2 },
  { id: "default", label: "默认", threads: 10, rampUpSec: 5, loops: 1 },
  { id: "stress", label: "压测", threads: 30, rampUpSec: 10, loops: 3 },
];

type ThreadFieldDef = {
  key: keyof LoadTestThreadGroup;
  label: string;
  suffix: string;
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
    suffix: "线程",
    hint: "并发虚拟用户，上限 50",
    min: 1,
    max: 50,
  },
  {
    key: "rampUpSec",
    label: "Ramp-Up",
    suffix: "秒",
    hint: "在指定秒内逐步拉起全部线程",
    min: 0,
  },
  {
    key: "loops",
    label: "循环次数",
    suffix: "次",
    hint: "每线程重复执行采样器的次数",
    min: 1,
    max: 500,
  },
  {
    key: "warmup",
    label: "预热样本",
    suffix: "次",
    hint: "不计入聚合统计，用于连接预热",
    min: 0,
  },
  {
    key: "timeoutMs",
    label: "请求超时",
    suffix: "ms",
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
  onConsumeExternalDraft: () => void;
  onEditInWorkbench?: (payload: { draft: WorkbenchDraft }) => void;
  /** 偏好设置保存后递增，用于同步 JTL 解析模式 */
  jtlStreamPrefsRevision?: number;
};

export default function LoadTestPanel({
  project,
  projectName,
  onNotify,
  externalDraft,
  onConsumeExternalDraft,
  jtlStreamPrefsRevision = 0,
}: Props) {
  const {
    envName,
    variables,
    refreshVariables,
    openEnvVariables,
  } = useProjectEnv();
  const [plan, setPlan] = useState<LoadTestPlan>(defaultLoadTestPlan);
  const [mainTab, setMainTab] = useState<LoadTestMainTab>(() => loadPersistedLoadMainTab() ?? "config");
  const [jtlStreamMode, setJtlStreamMode] = useState<JtlStreamModeId>(() => loadPersistedJtlStreamMode());

  useEffect(() => {
    setJtlStreamMode(loadPersistedJtlStreamMode());
  }, [jtlStreamPrefsRevision]);

  const goMainTab = useCallback((tab: LoadTestMainTab) => {
    setMainTab(tab);
    persistLoadMainTab(tab);
  }, []);
  const [configNode, setConfigNode] = useState<LoadTestConfigNode>("threadGroup");

  const crumbLabel =
    mainTab === "config" ? CONFIG_LABELS[configNode] : MAIN_TAB_LABELS[mainTab];

  const goConfig = (node: LoadTestConfigNode) => {
    goMainTab("config");
    setConfigNode(node);
  };
  const [pendingJtlPath, setPendingJtlPath] = useState("");
  const [launchingJmeter, setLaunchingJmeter] = useState(false);
  const [jmeterPreset, setJmeterPreset] = useState<{
    jmxPath: string;
    outputDir: string;
    autoRunKey: number;
    fromConfig: boolean;
  } | null>(null);
  const [collections, setCollections] = useState<Awaited<ReturnType<typeof window.atp.listCollections>>>([]);
  const [collectionId, setCollectionId] = useState("default");
  const [collection, setCollection] = useState<ApiCollectionFile | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [importFromCollectionOpen, setImportFromCollectionOpen] = useState(false);
  const [perfHistoryCount, setPerfHistoryCount] = useState(0);

  const refreshPerfHistoryCount = useCallback(() => {
    if (!project) {
      setPerfHistoryCount(0);
      return;
    }
    void window.atp.listPerfReports(project, 200).then((list) => setPerfHistoryCount(list.length));
  }, [project]);

  useEffect(() => {
    refreshPerfHistoryCount();
  }, [refreshPerfHistoryCount, jmeterPreset?.autoRunKey]);

  useEffect(() => {
    if (mainTab === "history") refreshPerfHistoryCount();
  }, [mainTab, refreshPerfHistoryCount]);

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
    if (!externalDraft) return;
    const normalized = normalizeRawBodyDraft(externalDraft);
    void (async () => {
      const base = project && envName ? await window.atp.getProjectVariables(project, envName) : {};
      const withAuth = mergeAuthFromSampler({ ...base, ...variables }, normalized);
      const authPatch = authPatchFromSampler(normalized);
      if (project && envName && Object.keys(authPatch).length) {
        await persistEnvVariables(project, envName, authPatch);
        await refreshVariables();
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
  }, [externalDraft, onConsumeExternalDraft, project, envName, variables, refreshVariables]);

  const missingEnvVars = useMemo(
    () => unresolvedWorkbenchVars(plan.sampler, variables),
    [plan.sampler, variables],
  );

  const linkedRequest = useMemo(() => {
    if (!plan.sourceRequestId || !collection) return null;
    return collection.requests.find((r) => r.id === plan.sourceRequestId) ?? null;
  }, [plan.sourceRequestId, collection]);

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
      openEnvVariables({ sampler: plan.sampler });
      goConfig("httpSampler");
      return;
    }
    try {
      resolveWorkbenchPayload(plan.sampler, variables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "请检查环境变量";
      showToast(msg);
      if (msg.includes("未定义变量")) openEnvVariables({ sampler: plan.sampler });
      return;
    }

    setLaunchingJmeter(true);
    try {
      const written = await writeLoadTestPlanJmx(
        project,
        plan,
        envName,
        variables,
        linkedRequest?.name,
      );
      if (!written.ok || !written.absolutePath) {
        showToast(written.error ?? "生成 JMX 失败", "error");
        return;
      }
      if (written.warnings.length) showToast(written.warnings[0]!);
      const autoRunKey = Date.now();
      setJmeterPreset({
        jmxPath: written.absolutePath,
        outputDir: written.outputDir ?? "",
        autoRunKey,
        fromConfig: true,
      });
      goMainTab("jmeterRun");
      showToast(
        written.relativePath
          ? `已生成 JMX：${written.relativePath}，正在跳转执行…`
          : "已生成 JMX，正在跳转执行…",
        "success",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "生成或执行准备失败", "error");
    } finally {
      setLaunchingJmeter(false);
    }
  }, [plan, variables, project, missingEnvVars, envName, linkedRequest?.name]);

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

  const renderThreadField = (field: ThreadFieldDef) => {
    const value = plan.threadGroup[field.key];
    const fallback =
      field.key === "timeoutMs" ? 30_000 : field.key === "rampUpSec" || field.key === "warmup" ? 0 : 1;
    return (
      <label key={field.key} className="loadtest-param-cell" title={field.hint}>
        <span className="loadtest-param-cell-label">{field.label}</span>
        <div className="loadtest-param-input-wrap">
          <input
            type="number"
            className="text-input loadtest-param-cell-input"
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={launchingJmeter}
            value={value}
            onChange={(e) => updateThreadGroup(field.key, Number(e.target.value), fallback)}
          />
          <span className="loadtest-param-suffix" aria-hidden>
            {field.suffix}
          </span>
        </div>
      </label>
    );
  };

  const flowStepIndex =
    mainTab === "config"
      ? 0
      : mainTab === "jmeterRun"
        ? 1
        : mainTab === "jmeterJtl"
          ? 2
          : mainTab === "history"
            ? 3
            : -1;

  const fieldByKey = Object.fromEntries(THREAD_FIELDS.map((f) => [f.key, f])) as Record<
    keyof LoadTestThreadGroup,
    ThreadFieldDef
  >;

  const hideBenchRunToolbar = mainTab === "jmeterRun" || mainTab === "jmeterJtl" || mainTab === "history";
  const configStepTotal = 3;
  const configStepDone = [Boolean(project), samplerHasTarget, missingEnvVars.length === 0].filter(Boolean).length;

  const onHttpSamplerPage = mainTab === "config" && configNode === "httpSampler";
  const suppressTopUrlWarn = onHttpSamplerPage && !samplerHasTarget && missingEnvVars.length === 0;

  const benchRunToolbar = (
    <div className="loadtest-editor-actions loadtest-editor-actions--split">
      <div className="loadtest-editor-actions-left">
        {!canStart && !launchingJmeter && !samplerHasTarget && !onHttpSamplerPage ? (
          <button type="button" className="nav-btn nav-btn--compact" onClick={() => goConfig("httpSampler")}>
            配置 HTTP
          </button>
        ) : null}
        {!canStart && !launchingJmeter && samplerHasTarget && missingEnvVars.length ? (
          <button
            type="button"
            className="nav-btn nav-btn--compact nav-btn--ghost"
            onClick={() => openEnvVariables({ sampler: plan.sampler })}
          >
            填写变量
          </button>
        ) : null}
        <button
          type="button"
          className={`nav-btn nav-btn--compact nav-btn--ghost${mainTab === "history" ? " active" : ""}`}
          disabled={!project}
          title="查看以往压测存档，无需先执行本次压测"
          onClick={() => goMainTab("history")}
        >
          压测历史{perfHistoryCount > 0 ? ` (${perfHistoryCount})` : ""}
        </button>
      </div>
      <div className="loadtest-editor-actions-right">
        {canStart || launchingJmeter ? (
          <span className="loadtest-toolbar-meta loadtest-toolbar-meta--inline">
            <span className="loadtest-meta-chip">
              预期样本 <strong>{totalSamples}</strong>
            </span>
            <span className="loadtest-meta-chip loadtest-meta-chip--muted">
              {plan.threadGroup.threads} 线程 × {plan.threadGroup.loops} 循环
              {plan.threadGroup.warmup > 0 ? ` · 预热 ${plan.threadGroup.warmup}` : ""}
            </span>
          </span>
        ) : null}
        {!suppressTopUrlWarn && !canStart && !launchingJmeter && startDisabledReason ? (
          <span className="loadtest-editor-actions-hint" role="status">
            {startDisabledReason}
          </span>
        ) : null}
        <button
          type="button"
          className={`primary loadtest-run-primary${canStart && !launchingJmeter ? " loadtest-run-primary--ready" : ""}`}
          disabled={launchingJmeter || !canStart}
          title={!canStart && !launchingJmeter ? startDisabledReason : undefined}
          onClick={() => void onRun()}
        >
          {launchingJmeter ? "准备中…" : "生成 JMX 并执行"}
        </button>
      </div>
    </div>
  );

  const flowStepper = (
    <ol className="loadtest-flow-stepper" aria-label="压测流程">
      {[
        { id: 0, label: "配置" },
        { id: 1, label: "JMX" },
        { id: 2, label: "JTL" },
      ].map((step, i, arr) => (
        <li
          key={step.id}
          className={`loadtest-flow-step${
            flowStepIndex === step.id ? " loadtest-flow-step--active" : ""
          }${flowStepIndex > step.id ? " loadtest-flow-step--done" : ""}`}
        >
          <span className="loadtest-flow-step-dot" aria-hidden />
          <span>{step.label}</span>
          {i < arr.length - 1 ? <span className="loadtest-flow-step-line" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="loadtest">
      <header className="loadtest-header loadtest-header--compact" aria-label="负载测试">
        <AppModuleChrome tab="load" description={false} showShortcut={false} actions={flowStepper} />

        <div className="loadtest-view-tabs-bar workbench-req-tabs-bar">
          <nav
            className="workbench-req-tabs workbench-req-tabs--segmented loadtest-view-tabs"
            role="tablist"
            aria-label="负载测试视图"
          >
            {LOAD_MAIN_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={mainTab === tab}
                className={`workbench-tab${mainTab === tab ? " active" : ""}`}
                onClick={() => goMainTab(tab)}
              >
                {MAIN_TAB_LABELS[tab]}
                {tab === "history" && perfHistoryCount > 0 ? (
                  <span className="loadtest-view-tab-badge" aria-hidden>
                    {perfHistoryCount}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
          {mainTab === "jmeterJtl" || mainTab === "history" ? (
            <div className="loadtest-tab-toolbar loadtest-head-jtl" title="当前视图的 JTL 解析模式">
              <span className="loadtest-head-jtl-label hint">解析</span>
              <JtlStreamModeField
                compact
                showFieldLabel={false}
                value={jtlStreamMode}
                onChange={(mode) => {
                  setJtlStreamMode(mode);
                  persistJtlStreamMode(mode);
                }}
                disabled={!project}
              />
            </div>
          ) : null}
        </div>
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
          className={`loadtest-editor atp-fin-result-panel${
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
                结构对标 Apache JMeter：测试计划下挂「线程组」与「HTTP 请求」；配置完成后生成 JMX，在「执行 JMX」用本机 JMeter 运行。
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
                            disabled={launchingJmeter}
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

                  <details className="loadtest-advanced-panel">
                    <summary className="loadtest-advanced-summary">高级参数</summary>
                    <div className="loadtest-param-strip loadtest-param-strip--sub" aria-label="高级参数">
                      {ADVANCED_THREAD_KEYS.map((key) => renderThreadField(fieldByKey[key]))}
                    </div>
                  </details>

                  {rampPerThread ? (
                    <p className="loadtest-thread-footnote">
                      爬坡间隔约 <strong>{rampPerThread}s</strong>/线程（{plan.threadGroup.rampUpSec}s ÷{" "}
                      {plan.threadGroup.threads}）
                    </p>
                  ) : null}

                  {!samplerHasTarget ? (
                    <div className="loadtest-thread-next">
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost"
                        onClick={() => goConfig("httpSampler")}
                      >
                        下一步：配置 HTTP 请求
                      </button>
                    </div>
                  ) : null}
                </div>

                <aside className="loadtest-thread-aside" aria-label="配置清单与概览">
                  <h4 className="loadtest-aside-title">配置清单</h4>
                  <ul className="loadtest-config-checklist">
                    <li className={project ? "loadtest-check--ok" : "loadtest-check--warn"}>
                      <span className="loadtest-check-mark" aria-hidden>
                        {project ? "✓" : "!"}
                      </span>
                      <span>已选项目</span>
                    </li>
                    <li className={samplerHasTarget ? "loadtest-check--ok" : "loadtest-check--warn"}>
                      <span className="loadtest-check-mark" aria-hidden>
                        {samplerHasTarget ? "✓" : "!"}
                      </span>
                      <span>
                        HTTP 请求 URL
                        {!samplerHasTarget ? (
                          <button
                            type="button"
                            className="loadtest-check-link"
                            onClick={() => goConfig("httpSampler")}
                          >
                            去配置
                          </button>
                        ) : null}
                      </span>
                    </li>
                    <li
                      className={
                        missingEnvVars.length === 0 && project
                          ? "loadtest-check--ok"
                          : "loadtest-check--warn"
                      }
                    >
                      <span className="loadtest-check-mark" aria-hidden>
                        {missingEnvVars.length === 0 && project ? "✓" : "!"}
                      </span>
                      <span>
                        环境变量（{envName}）
                        {missingEnvVars.length > 0 ? (
                          <button
                            type="button"
                            className="loadtest-check-link"
                            onClick={() => openEnvVariables({ sampler: plan.sampler })}
                          >
                            填写
                          </button>
                        ) : null}
                      </span>
                    </li>
                  </ul>

                  <h4 className="loadtest-aside-title">压测概览</h4>
                  <ul className="loadtest-aside-stats loadtest-aside-stats--compact">
                    <li>
                      <span className="loadtest-aside-stat-label">预期样本</span>
                      <span className="loadtest-aside-stat-value">{totalSamples}</span>
                    </li>
                    <li>
                      <span className="loadtest-aside-stat-label">并发</span>
                      <span className="loadtest-aside-stat-value">
                        {plan.threadGroup.threads} × {plan.threadGroup.loops}
                      </span>
                    </li>
                  </ul>
                  <p className="hint loadtest-aside-hint">执行请用上方「生成 JMX 并执行」</p>
                </aside>
              </div>
            </div>
          )}

          {mainTab === "config" && configNode === "httpSampler" && (
            <div className="loadtest-panel loadtest-panel--sampler">
              <div className="loadtest-sampler-shell">
                <header className="loadtest-sampler-shell-head">
                  <div>
                    <h3 className="loadtest-sampler-shell-title">HTTP 请求</h3>
                    <p className="loadtest-sampler-shell-lede">配置采样 URL 与 Body，压测将按线程组参数重复调用</p>
                  </div>
                </header>

              {showImportStrip ? (
                <div className="loadtest-sampler-source-bar">
                  {!project ? (
                    <span className="hint loadtest-import-hint">选择侧栏项目后可从集合导入</span>
                  ) : importFromCollectionOpen ? (
                    <div className="loadtest-pick-block loadtest-pick-block--open loading-host">
                      <LoadingOverlay show={collectionsLoading} label="加载集合…" />
                      <div className="loadtest-pick-head">
                        <span className="loadtest-pick-label">从集合选择</span>
                        <AppCustomSelect
                          className="workbench-sidebar-select loadtest-pick-module"
                          value={effectiveCollectionId}
                          disabled={!collections.length}
                          ariaLabel="集合模块"
                          placeholder="暂无模块"
                          options={
                            collections.length
                              ? collections.map((c) => ({
                                  value: c.id,
                                  label: `${c.name} · ${c.requestCount}`,
                                }))
                              : [{ value: "", label: "暂无模块" }]
                          }
                          onChange={(id) => {
                            setCollectionId(id);
                            setPlan((p) => ({ ...p, sourceRequestId: null }));
                          }}
                        />
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
                  ) : linkedRequest ? (
                    <div className="loadtest-sampler-linked-line">
                      <span className={`method-tag method-${linkedRequest.method.toLowerCase()}`}>
                        {linkedRequest.method}
                      </span>
                      <span className="loadtest-sampler-linked-name" title={linkedRequest.name}>
                        {linkedRequest.name}
                      </span>
                      <span
                        className="loadtest-sampler-linked-url hint"
                        title={plan.sampler.url || linkedRequest.url}
                      >
                        {plan.sampler.url.trim() || linkedRequest.url}
                      </span>
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost"
                        disabled={!canPickFromCollection}
                        onClick={() => setImportFromCollectionOpen(true)}
                      >
                        更换
                      </button>
                    </div>
                  ) : (
                    <p className="loadtest-sampler-import-banner">
                      <span className="loadtest-sampler-import-banner-icon" aria-hidden>
                        💡
                      </span>
                      你可以{" "}
                      <button
                        type="button"
                        className="loadtest-sampler-import-link"
                        disabled={!canPickFromCollection}
                        onClick={() => setImportFromCollectionOpen(true)}
                      >
                        从集合导入请求
                      </button>
                      或手动填写下方 URL。
                    </p>
                  )}
                </div>
              ) : null}

              <div className="loadtest-sampler-compose">
                <label className="loadtest-sampler-url-block">
                  <span className="loadtest-sampler-field-label loadtest-sampler-field-label--url">请求地址</span>
                  <div className="loadtest-sampler-url-unified">
                    <div className="workbench-method-group" aria-label="HTTP 方法">
                      <AppCustomSelect
                        variant="method"
                        className="workbench-method--verb"
                        triggerClassName="workbench-method--verb"
                        value={plan.sampler.method}
                        ariaLabel="HTTP 方法"
                        options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
                        onChange={(method) =>
                          setPlan((p) => ({ ...p, sampler: { ...p.sampler, method } }))
                        }
                      />
                    </div>
                    <input
                      className="text-input workbench-url-input loadtest-sampler-url-input"
                      value={plan.sampler.url}
                      placeholder="https://host/path 或 {{base_url}}/path"
                      spellCheck={false}
                      onChange={(e) =>
                        setPlan((p) => ({ ...p, sampler: { ...p.sampler, url: e.target.value } }))
                      }
                    />
                  </div>
                  {!samplerHasTarget ? (
                    <p className="loadtest-field-error" role="alert">
                      请输入 URL 后才能生成 JMX
                    </p>
                  ) : null}
                </label>
                <label className="loadtest-sampler-body-block">
                  <span className="loadtest-sampler-field-label loadtest-sampler-field-label--body">
                    <strong>请求体</strong>
                    <span className="loadtest-sampler-field-suffix">(BODY)</span>
                  </span>
                  <textarea
                    className="loadtest-sampler-body-editor"
                    value={plan.sampler.body}
                    placeholder='例如 {"key": "value"} — 无正文可留空'
                    title="无正文可留空"
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
              </div>
            </div>
          )}

          <div
            className={mainTab === "history" ? "loadtest-history-host" : "loadtest-history-host loadtest-history-host--hidden"}
            hidden={mainTab !== "history"}
            aria-hidden={mainTab !== "history"}
          >
            <LoadTestHistoryPanel
              project={project}
              active={mainTab === "history"}
              currentReport={null}
              onToast={showToast}
              onHistoryCountChange={setPerfHistoryCount}
              onNavigateTab={goMainTab}
              environment={envName}
            />
          </div>

          {mainTab === "jmeterRun" && (
            <JmeterRunPanel
              project={project}
              onToast={showToast}
              initialJmxPath={jmeterPreset?.jmxPath}
              initialOutputDir={jmeterPreset?.outputDir}
              autoRunKey={jmeterPreset?.autoRunKey}
              fromLoadTestConfig={jmeterPreset?.fromConfig ?? false}
              onRunFinished={({ jtlPath, jmxPath }) => {
                setPendingJtlPath(jtlPath);
                void (async () => {
                  if (!project) {
                    goMainTab("jmeterJtl");
                    showToast("已跳转 JTL 报告页");
                    return;
                  }
                  const archived = await archiveJmeterJtlToPerf(project, jtlPath, jmxPath, jtlStreamMode);
                  if (archived.ok) {
                    refreshPerfHistoryCount();
                    goMainTab("jmeterJtl");
                    showToast(
                      `JMX 执行完成，已载入 JTL；压测历史已存档（${archived.relativePath ?? "perf"}）`,
                      "success",
                    );
                  } else {
                    goMainTab("jmeterJtl");
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
              jtlStreamMode={jtlStreamMode}
            />
          )}
          </div>
        </section>
      </div>

    </div>
  );
}