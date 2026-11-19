import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ConfirmDialog from "./ConfirmDialog";
import ExportJmxDialog from "./ExportJmxDialog";
import LoadingOverlay from "./LoadingOverlay";
import { SkeletonDetailPanel, SkeletonListRows } from "./AppSkeleton";
import { caseYamlToWorkbenchDraft } from "./caseYaml";
import {
  buildJmxFromCaseYamls,
  buildJmxFromWorkbenchDrafts,
  type JmxExportOptions,
} from "./jmxExport";
import { buildUrl, normalizeRawBodyDraft, savedRequestToDraft } from "./apiWorkbenchModel";
import { newCaseYaml } from "./newCaseTemplate";
import type { SavedApiRequest, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { applyImportedCurlAuth } from "./samplerAuth";
import { useProjectEnvOptional } from "./ProjectEnvContext";
import CaptureCodeBlock from "./CaptureCodeBlock";

type CollectionRow = {
  collectionId: string;
  collectionName: string;
  request: SavedApiRequest;
};

type ListMode = "yaml" | "collection";

function collectionRowKey(row: CollectionRow): string {
  return `${row.collectionId}:${row.request.id}`;
}

type JmxExportMode = "current" | "all" | "collection";

type Props = {
  project: string;
  projectDisplayName?: string;
  cases: string[];
  /** 与 listProjectAssets 一并读入的 YAML 正文 */
  caseTexts?: Record<string, string>;
  /** 父级 assets 已与当前 project 对齐，再自动读 YAML */
  casesReady?: boolean;
  assetsLoading?: boolean;
  /** 由 App 持有选中项，避免面板内 effect 抢选中 */
  activeCaseName: string | null;
  onActiveCaseNameChange: (name: string | null) => void;
  onRefresh: () => void;
  onNotify?: (text: string) => void;
  onCasePreviewChange?: (ctx: { caseName: string | null; yaml: string }) => void;
  onOpenInWorkbench?: (draft: WorkbenchDraft, opts?: { requestId?: string; collectionId?: string }) => void;
};

function slugFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "test-plan"
  );
}

export default function CasesPanel({
  project,
  projectDisplayName,
  cases,
  caseTexts = {},
  casesReady = true,
  assetsLoading = false,
  activeCaseName,
  onActiveCaseNameChange,
  onRefresh,
  onNotify,
  onCasePreviewChange,
  onOpenInWorkbench,
}: Props) {
  const projectEnv = useProjectEnvOptional();
  const [yamlText, setYamlText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<CollectionRow | null>(null);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newCaseName, setNewCaseName] = useState("new-case");
  const [caseFilter, setCaseFilter] = useState("");
  const [listPage, setListPage] = useState(1);
  const [caseLoading, setCaseLoading] = useState(false);
  const [jmxExportOpen, setJmxExportOpen] = useState(false);
  const [jmxExportMode, setJmxExportMode] = useState<JmxExportMode>("current");
  const [jmxExportItemCount, setJmxExportItemCount] = useState(0);
  const [jmxExportBusy, setJmxExportBusy] = useState(false);
  const [collectionRows, setCollectionRows] = useState<CollectionRow[]>([]);
  const [listMode, setListMode] = useState<ListMode>("yaml");
  const [selectedCollectionKey, setSelectedCollectionKey] = useState<string | null>(null);
  const caseLoadGenRef = useRef(0);
  const CASE_READ_TIMEOUT_MS = 20_000;
  const casesRef = useRef(cases);
  casesRef.current = cases;
  const caseTextsRef = useRef(caseTexts);
  caseTextsRef.current = caseTexts;
  const yamlTextRef = useRef(yamlText);
  yamlTextRef.current = yamlText;

  const CASE_LIST_PAGE = 20;
  const casesKey = useMemo(() => [...cases].sort().join("\u001f"), [cases]);

  const activeCase = useMemo(() => {
    if (!cases.length) return null;
    if (activeCaseName && cases.includes(activeCaseName)) return activeCaseName;
    return cases[0] ?? null;
  }, [activeCaseName, cases, casesKey]);

  const activeCaseRef = useRef(activeCase);
  activeCaseRef.current = activeCase;

  const loadCollectionRows = useCallback(async () => {
    if (!project) {
      setCollectionRows([]);
      return;
    }
    const cols = await window.atp.listCollections(project);
    const rows: CollectionRow[] = [];
    for (const c of cols) {
      const doc = await window.atp.getCollection(project, c.id);
      for (const r of doc?.requests ?? []) {
        rows.push({ collectionId: c.id, collectionName: c.name, request: r });
      }
    }
    setCollectionRows(rows);
  }, [project]);

  const resolvedCaseYaml = useMemo(() => {
    if (!activeCase) return "";
    if (editing) return editDraft;
    const bundled = caseTexts[activeCase];
    if (bundled !== undefined) return bundled;
    return yamlText;
  }, [activeCase, caseTexts, editing, editDraft, yamlText]);

  const selectedCaseSummary = useMemo(() => {
    if (!resolvedCaseYaml.trim()) return null;
    const draft = caseYamlToWorkbenchDraft(resolvedCaseYaml);
    if (!draft) return null;
    return {
      method: draft.method,
      url: buildUrl(draft.url, draft.query),
    };
  }, [resolvedCaseYaml]);

  const applyCaseYaml = useCallback((caseName: string, text: string | null | undefined) => {
    if (activeCaseRef.current !== caseName) return;
    setYamlText(text ?? "");
    setEditDraft(text ?? "");
    setEditing(false);
    setCaseLoading(false);
    if (text == null || text === "") {
      const msg = `无法读取用例：${caseName}.yaml（项目 ${project}）`;
      setMessage(msg);
      onNotify?.(msg);
      window.setTimeout(() => setMessage(""), 6000);
    }
  }, [project, onNotify]);

  const loadCase = useCallback(
    async (caseName: string, opts?: { force?: boolean }) => {
      if (!project) return;
      const list = casesRef.current;
      if (
        !opts?.force &&
        activeCaseRef.current === caseName &&
        yamlTextRef.current &&
        list.includes(caseName)
      ) {
        return;
      }
      const cached = caseTextsRef.current[caseName];
      if (cached !== undefined && !opts?.force) {
        applyCaseYaml(caseName, cached);
        return;
      }
      if (activeCaseRef.current !== caseName) return;
      const gen = ++caseLoadGenRef.current;
      setYamlText("");
      setEditDraft("");
      setCaseLoading(true);
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished || gen !== caseLoadGenRef.current) return;
        finished = true;
        applyCaseYaml(caseName, null);
        const msg = `加载用例超时（${caseName}）`;
        onNotify?.(msg);
      }, CASE_READ_TIMEOUT_MS);
      try {
        const text = await window.atp.readProjectCase(project, caseName);
        if (finished || gen !== caseLoadGenRef.current) return;
        finished = true;
        applyCaseYaml(caseName, text);
      } catch (err) {
        if (finished || gen !== caseLoadGenRef.current) return;
        finished = true;
        applyCaseYaml(caseName, null);
        onNotify?.(err instanceof Error ? err.message : "加载用例失败");
      } finally {
        window.clearTimeout(timer);
        if (gen === caseLoadGenRef.current) setCaseLoading(false);
      }
    },
    [project, applyCaseYaml, onNotify],
  );

  const selectCase = useCallback(
    (caseName: string) => {
      if (!casesRef.current.includes(caseName)) return;
      caseLoadGenRef.current += 1;
      setEditing(false);
      onActiveCaseNameChange(caseName);
      const cached = caseTextsRef.current[caseName];
      if (cached !== undefined) {
        setYamlText(cached);
        setEditDraft(cached);
        setCaseLoading(false);
        return;
      }
      setYamlText("");
      setEditDraft("");
      setCaseLoading(true);
      void loadCase(caseName, { force: true });
    },
    [loadCase, onActiveCaseNameChange],
  );

  useEffect(() => {
    caseLoadGenRef.current += 1;
    setCaseLoading(false);
    setYamlText("");
    setEditing(false);
    setSelectedCollectionKey(null);
    const t = window.setTimeout(() => {
      void loadCollectionRows();
    }, 0);
    return () => window.clearTimeout(t);
  }, [project, loadCollectionRows]);

  useEffect(() => {
    if (cases.length) return;
    if (collectionRows.length) setListMode("collection");
  }, [project, cases.length, collectionRows.length]);

  /** 切换选中时同步 YAML（优先 caseTexts） */
  useEffect(() => {
    const target = activeCase;
    if (!target || !cases.includes(target)) return;
    const bundled = caseTexts[target];
    if (bundled !== undefined) {
      setYamlText(bundled);
      setEditDraft(bundled);
      setEditing(false);
      setCaseLoading(false);
      return;
    }
    if (yamlText.trim() && activeCaseRef.current === target) return;
    setYamlText("");
    setEditDraft("");
    setCaseLoading(true);
    void loadCase(target, { force: true });
  }, [activeCase, caseTexts, cases, loadCase]);

  const filteredCases = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => c.toLowerCase().includes(q));
  }, [cases, caseFilter]);

  const filteredCollectionRows = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return collectionRows;
    return collectionRows.filter((row) => {
      const hay = `${row.request.name} ${row.request.method} ${row.request.url} ${row.collectionName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [collectionRows, caseFilter]);

  const selectedCollectionRow = useMemo(
    () => collectionRows.find((r) => collectionRowKey(r) === selectedCollectionKey) ?? null,
    [collectionRows, selectedCollectionKey],
  );

  const listItemCount = listMode === "yaml" ? filteredCases.length : filteredCollectionRows.length;
  const listPageCount = Math.max(1, Math.ceil(listItemCount / CASE_LIST_PAGE) || 1);
  const pagedCases = useMemo(() => {
    const start = (listPage - 1) * CASE_LIST_PAGE;
    return filteredCases.slice(start, start + CASE_LIST_PAGE);
  }, [filteredCases, listPage]);
  const pagedCollectionRows = useMemo(() => {
    const start = (listPage - 1) * CASE_LIST_PAGE;
    return filteredCollectionRows.slice(start, start + CASE_LIST_PAGE);
  }, [filteredCollectionRows, listPage]);

  useEffect(() => {
    setListPage(1);
  }, [caseFilter, project]);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  useEffect(() => {
    onCasePreviewChange?.({ caseName: activeCase, yaml: resolvedCaseYaml });
  }, [activeCase, resolvedCaseYaml, onCasePreviewChange]);

  useEffect(() => {
    if (listMode !== "collection" || !filteredCollectionRows.length) return;
    if (selectedCollectionKey && filteredCollectionRows.some((r) => collectionRowKey(r) === selectedCollectionKey)) {
      return;
    }
    setSelectedCollectionKey(collectionRowKey(filteredCollectionRows[0]));
  }, [listMode, filteredCollectionRows, selectedCollectionKey]);

  const openCollectionInWorkbench = (row: CollectionRow) => {
    if (!onOpenInWorkbench) return;
    const draft = normalizeRawBodyDraft(savedRequestToDraft(row.request));
    onOpenInWorkbench(draft, { requestId: row.request.id, collectionId: row.collectionId });
  };

  const onDeleteCollectionRequest = async (row: CollectionRow) => {
    const col = await window.atp.getCollection(project, row.collectionId);
    if (!col) {
      showMsg("找不到集合文件");
      return;
    }
    const next = { ...col, requests: col.requests.filter((r) => r.id !== row.request.id) };
    await window.atp.saveCollection(project, next);
    const key = collectionRowKey(row);
    if (selectedCollectionKey === key) setSelectedCollectionKey(null);
    setPendingCollectionDelete(null);
    await loadCollectionRows();
    showMsg("已从集合移除请求");
    onRefresh();
  };
  // onCasePreviewChange 在 App 内做浅比较，避免重复 setState

  const showMsg = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 4800);
  };

  const openJmxExportAll = () => {
    void (async () => {
      if (cases.length) {
        setJmxExportMode("all");
        setJmxExportItemCount(cases.length);
        setJmxExportOpen(true);
        return;
      }
      const col = await window.atp.getCollection(project, "default");
      const reqs = col?.requests ?? [];
      if (!reqs.length) {
        showMsg(
          "暂无可导出内容：请新建 YAML 用例，或在工作台「保存到集合」（会同步生成用例）。南财行情请切换到项目「终端」或「南财行情」。",
        );
        return;
      }
      setJmxExportMode("collection");
      setJmxExportItemCount(reqs.length);
      setJmxExportOpen(true);
    })();
  };

  const collectJmxCases = async (mode: JmxExportMode): Promise<Array<{ label: string; yaml: string }>> => {
    if (mode === "current") {
      if (!activeCase || !resolvedCaseYaml.trim()) return [];
      return [{ label: activeCase, yaml: resolvedCaseYaml }];
    }
    const out: Array<{ label: string; yaml: string }> = [];
    for (const c of cases) {
      const text = await window.atp.readFile(`projects/${project}/cases/${c}.yaml`);
      if (text?.trim()) out.push({ label: c, yaml: text });
    }
    return out;
  };

  const runJmxExport = async (opts: JmxExportOptions, target: "project" | "dialog") => {
    setJmxExportBusy(true);
    try {
      let envVariables: Record<string, string> | undefined;
      if (opts.injectEnv) {
        const raw = await window.atp.getProjectVariables(project, opts.envName || "dev");
        envVariables = {};
        for (const [k, v] of Object.entries(raw)) {
          if (k !== "project" && typeof v === "string") envVariables[k] = v;
        }
      }

      let xml = "";
      let errors: string[] = [];
      let warnings: string[] = [];

      if (jmxExportMode === "collection") {
        const col = await window.atp.getCollection(project, "default");
        const reqs = col?.requests ?? [];
        if (!reqs.length) {
          showMsg("API 集合为空");
          return;
        }
        const items = reqs.map((r) => ({
          label: r.name?.trim() || r.id,
          draft: normalizeRawBodyDraft(savedRequestToDraft(r)),
        }));
        const built = buildJmxFromWorkbenchDrafts(items, opts, envVariables);
        xml = built.xml;
        errors = built.errors;
        warnings = built.warnings;
      } else {
        const inputs = await collectJmxCases(jmxExportMode);
        if (!inputs.length) {
          showMsg(jmxExportMode === "current" ? "请先选择用例" : "项目中无用例");
          return;
        }
        const built = buildJmxFromCaseYamls(inputs, opts, envVariables);
        xml = built.xml;
        errors = built.errors;
        warnings = built.warnings;
      }
      if (!xml) {
        showMsg(errors.join("；") || "生成失败");
        return;
      }
      const baseName = slugFileName(opts.planName);
      if (target === "project") {
        const rel = `projects/${project}/jmx/${baseName}.jmx`;
        const res = await window.atp.writeRepoFile(rel, xml);
        if (!res.ok) {
          showMsg(res.error ?? "写入失败");
          return;
        }
        showMsg(
          `已保存 ${res.relativePath ?? rel}${warnings.length ? `；${warnings[0]}` : ""}${errors.length ? `（跳过 ${errors.length} 条）` : ""}`,
        );
      } else {
        const res = await window.atp.saveTextWithDialog({
          defaultPath: `${baseName}.jmx`,
          content: xml,
          filters: [{ name: "JMeter 测试计划", extensions: ["jmx"] }],
        });
        if (res.cancelled) return;
        if (!res.ok) {
          showMsg(res.error ?? "保存失败");
          return;
        }
        showMsg(
          `已保存 ${res.filePath ?? ""}${warnings.length ? `；${warnings[0]}` : ""}${errors.length ? `（跳过 ${errors.length} 条）` : ""}`,
        );
      }
      setJmxExportOpen(false);
    } finally {
      setJmxExportBusy(false);
    }
  };

  const onSave = async () => {
    if (!project || !activeCase) return;
    setSaving(true);
    const res = await window.atp.updateProjectCase(project, activeCase, editDraft);
    setSaving(false);
    if (!res.ok) {
      showMsg(res.error ?? "保存失败");
      return;
    }
    setYamlText(editDraft);
    setEditing(false);
    showMsg("已保存");
    onRefresh();
  };

  const onDelete = async () => {
    if (!project || !activeCase) return;
    setSaving(true);
    const res = await window.atp.deleteProjectCase(project, activeCase);
    setSaving(false);
    setPendingDelete(false);
    if (!res.ok) {
      showMsg(res.error ?? "删除失败");
      return;
    }
    showMsg("已删除用例");
    const remain = cases.filter((c) => c !== activeCase);
    onActiveCaseNameChange(remain[0] ?? null);
    setYamlText("");
    setEditing(false);
    onRefresh();
    void loadCollectionRows();
  };

  if (!project) {
    return (
      <section className="card cases-panel-shell">
        <div className="panel-empty-state panel-empty-state--compact">
          <p className="panel-empty-title">未选择项目</p>
          <p className="panel-empty-hint">请在左侧侧栏选择工作区项目，或新建项目后再管理用例。</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="card cases-panel-shell">
        <header className="cases-panel-head">
          <h3 className="cases-panel-heading">用例与集合</h3>
        </header>

        <div className="cases-panel-split">
          <div className="cases-list-mode-tabs cases-panel-list-tabs" role="tablist" aria-label="列表类型">
            <button
              type="button"
              role="tab"
              aria-selected={listMode === "yaml"}
              className={`cases-list-mode-tab${listMode === "yaml" ? " cases-list-mode-tab--active" : ""}`}
              onClick={() => {
                setListMode("yaml");
                setListPage(1);
              }}
            >
              <span className="cases-list-mode-tab-title">YAML</span>
              <span className="cases-list-mode-tab-count">{cases.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listMode === "collection"}
              className={`cases-list-mode-tab${listMode === "collection" ? " cases-list-mode-tab--active" : ""}`}
              onClick={() => {
                setListMode("collection");
                setListPage(1);
              }}
            >
              <span className="cases-list-mode-tab-title">集合</span>
              <span className="cases-list-mode-tab-count">{collectionRows.length}</span>
            </button>
          </div>
          <div className="cases-panel-split-actions" role="toolbar" aria-label="用例操作">
            <button type="button" className="primary nav-btn--compact" onClick={() => setNewCaseOpen(true)}>
              新建用例
            </button>
            <button
              type="button"
              className="nav-btn nav-btn--compact"
              title={
                cases.length
                  ? "将全部 YAML 用例合成一个 JMeter 测试计划"
                  : "无用例时将从 API 工作台「默认模块」集合导出"
              }
              onClick={openJmxExportAll}
            >
              生成 JMX（全部）
            </button>
          </div>
          <aside className="cases-panel-list" aria-label="用例列表">
            <label className="cases-panel-search-wrap">
              <span className="cases-panel-search-icon" aria-hidden>
                ⌕
              </span>
              <input
                type="search"
                className="text-input cases-panel-search"
                placeholder={listMode === "yaml" ? "搜索用例" : "搜索名称 / URL"}
                value={caseFilter}
                onChange={(e) => setCaseFilter(e.target.value)}
              />
            </label>
            {listMode === "yaml" && !cases.length ? (
              <div className="cases-panel-list-body cases-panel-list-body--empty-yaml">
                <div className="case-list-empty case-list-empty--yaml">
                  <CasesListEmptyIcon prominent />
                  <p className="case-list-empty-title">暂无 YAML 用例</p>
                  <p className="case-list-empty-hint">
                    {collectionRows.length > 0
                      ? "工作台已有集合请求，或新建用例。"
                      : "可新建用例，或在抓包中保存为用例。"}
                  </p>
                  <div className="case-list-empty-actions">
                    <button type="button" className="primary nav-btn--compact" onClick={() => setNewCaseOpen(true)}>
                      + 新建用例
                    </button>
                    {collectionRows.length > 0 ? (
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost case-list-empty-link"
                        onClick={() => {
                          setListMode("collection");
                          setListPage(1);
                        }}
                      >
                        切到「集合」查看
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
            <div className="case-list-scroll cases-panel-list-scroll capture-scroll-slim">
              {assetsLoading && !casesReady ? (
                <SkeletonListRows rows={6} />
              ) : (
                <>
              {listMode === "yaml" &&
                pagedCases.map((c) => (
                  <div key={c} className={`case-list-item${activeCase === c ? " active" : ""}`}>
                    <button
                      type="button"
                      className="case-list-item-main"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        selectCase(c);
                      }}
                      title={c}
                    >
                      {c}
                    </button>
                    <div className="case-list-item-actions">
                      <button
                        type="button"
                        className="case-list-item-action"
                        title="编辑 YAML"
                        aria-label={`编辑 ${c}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectCase(c);
                          setEditing(true);
                        }}
                      >
                        <CasesRowEditIcon />
                      </button>
                      <button
                        type="button"
                        className="case-list-item-action case-list-item-action--danger"
                        title="删除用例"
                        aria-label={`删除 ${c}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onActiveCaseNameChange(c);
                          setPendingDelete(true);
                        }}
                      >
                        <CasesRowTrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              {listMode === "yaml" && cases.length > 0 && !filteredCases.length && (
                <div className="case-list-empty">无匹配</div>
              )}
              {listMode === "collection" &&
                pagedCollectionRows.map((row) => {
                  const key = collectionRowKey(row);
                  const url = buildUrl(row.request.url, row.request.query);
                  const label = row.request.name?.trim() || row.request.id;
                  const showModule = row.collectionName && row.collectionName !== "默认模块";
                  const methodCls = `method-tag method-${row.request.method.toLowerCase()}`;
                  return (
                    <div
                      key={key}
                      className={`case-list-item case-list-item--collection${
                        selectedCollectionKey === key ? " active" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="case-list-item-main case-list-item-main--collection"
                        onClick={() => setSelectedCollectionKey(key)}
                        title={url}
                      >
                        <span className="case-list-row-collection-main">
                          <span className={methodCls}>{row.request.method}</span>
                          <span className="case-list-row-collection-name">{label}</span>
                        </span>
                        {showModule ? (
                          <span className="case-list-row-collection-meta">{row.collectionName}</span>
                        ) : null}
                      </button>
                      <div className="case-list-item-actions">
                        {onOpenInWorkbench ? (
                          <button
                            type="button"
                            className="case-list-item-action"
                            title="在工作台编辑"
                            aria-label={`编辑 ${label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCollectionKey(key);
                              openCollectionInWorkbench(row);
                            }}
                          >
                            <CasesRowEditIcon />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="case-list-item-action case-list-item-action--danger"
                          title="从集合移除"
                          aria-label={`删除 ${label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCollectionKey(key);
                            setPendingCollectionDelete(row);
                          }}
                        >
                          <CasesRowTrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              {listMode === "collection" && !collectionRows.length && (
                <div className="case-list-empty">
                  <CasesListEmptyIcon />
                  <p className="case-list-empty-title">暂无集合请求</p>
                  <p className="case-list-empty-hint">在 API 工作台调试后点「保存到集合」。</p>
                </div>
              )}
              {listMode === "collection" && collectionRows.length > 0 && !filteredCollectionRows.length && (
                <div className="case-list-empty">无匹配</div>
              )}
                </>
              )}
            </div>
            )}
            {listItemCount > CASE_LIST_PAGE && (
              <div className="pagination case-list-pagination cases-panel-list-pagination">
                <button
                  type="button"
                  className="nav-btn nav-btn--compact"
                  disabled={listPage <= 1}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <span className="pagination-info">
                  {listPage}/{listPageCount}
                </span>
                <button
                  type="button"
                  className="nav-btn nav-btn--compact"
                  disabled={listPage >= listPageCount}
                  onClick={() => setListPage((p) => Math.min(listPageCount, p + 1))}
                >
                  下一页
                </button>
              </div>
            )}
          </aside>

          <div className="cases-panel-detail loading-host">
            {(assetsLoading && !casesReady) ||
            (caseLoading && !resolvedCaseYaml.trim() && Boolean(activeCase)) ? (
              <SkeletonDetailPanel />
            ) : (
              <>
            {listMode === "collection" && selectedCollectionRow && (
              <>
                <header className="cases-panel-detail-head">
                  <div className="cases-panel-detail-head-row">
                    <h4 className="cases-panel-detail-name">
                      {selectedCollectionRow.request.name || "未命名请求"}
                    </h4>
                    {onOpenInWorkbench ? (
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost cases-panel-detail-open-wb"
                        onClick={() => openCollectionInWorkbench(selectedCollectionRow)}
                      >
                        在工作台打开
                      </button>
                    ) : null}
                  </div>
                  <p className="cases-panel-detail-request cases-panel-detail-request--sub">
                    <span className={`method-tag method-${selectedCollectionRow.request.method.toLowerCase()}`}>
                      {selectedCollectionRow.request.method}
                    </span>
                    <span
                      className="cases-panel-detail-url cases-panel-detail-url--wrap"
                      title={buildUrl(selectedCollectionRow.request.url, selectedCollectionRow.request.query)}
                    >
                      {buildUrl(selectedCollectionRow.request.url, selectedCollectionRow.request.query)}
                    </span>
                  </p>
                </header>
                <div className="cases-panel-yaml-host">
                  <CaptureCodeBlock
                    fullText={JSON.stringify(selectedCollectionRow.request, null, 2)}
                    language="json"
                    maxHeight="none"
                    ariaLabel="集合请求 JSON"
                    onCopied={(msg) => onNotify?.(msg)}
                  />
                </div>
              </>
            )}
            {listMode === "yaml" && !activeCase && (
              <div className="cases-panel-detail-empty cases-panel-detail-empty--dim">
                <CasesYamlPreviewWatermark />
                <p className="cases-panel-detail-empty-title">
                  {cases.length > 0 ? "选择左侧用例" : "YAML 预览区"}
                </p>
                <p className="hint cases-panel-detail-empty-hint">
                  {cases.length > 0
                    ? "预览 YAML、编辑或在 API 工作台打开"
                    : "在左侧新建用例，或切换到「集合」查看请求详情"}
                </p>
              </div>
            )}
            {listMode === "collection" && !selectedCollectionRow && (
              <div className="cases-panel-detail-empty">
                <p className="cases-panel-detail-empty-title">选择左侧集合请求</p>
                <p className="hint">来自工作台「保存到集合」，与 YAML 用例相互独立</p>
              </div>
            )}
            {listMode === "yaml" && activeCase && (
              <>
                <header className="cases-panel-detail-head">
                  <div className="cases-panel-detail-head-row">
                    <h4 className="cases-panel-detail-name">{activeCase}</h4>
                    {onOpenInWorkbench && !editing ? (
                      <button
                        type="button"
                        className="nav-btn nav-btn--compact nav-btn--ghost cases-panel-detail-open-wb"
                        onClick={() => {
                          void (async () => {
                            const draft = caseYamlToWorkbenchDraft(resolvedCaseYaml);
                            if (!draft) {
                              const msg = "无法解析用例 YAML";
                              showMsg(msg);
                              onNotify?.(msg);
                              return;
                            }
                            const env = projectEnv?.envName ?? "dev";
                            let openDraft = draft;
                            try {
                              const synced = await applyImportedCurlAuth(project, env, draft);
                              openDraft = synced.draft;
                              await projectEnv?.refreshVariables();
                            } catch (err) {
                              onNotify?.(err instanceof Error ? err.message : "同步鉴权变量到环境失败");
                            }
                            onOpenInWorkbench(openDraft);
                          })();
                        }}
                      >
                        在工作台打开
                      </button>
                    ) : null}
                  </div>
                  {selectedCaseSummary ? (
                    <p className="cases-panel-detail-request cases-panel-detail-request--sub" title={selectedCaseSummary.url}>
                      <span className={`method-tag method-${selectedCaseSummary.method.toLowerCase()}`}>
                        {selectedCaseSummary.method}
                      </span>
                      <span className="cases-panel-detail-url cases-panel-detail-url--wrap">
                        {selectedCaseSummary.url}
                      </span>
                    </p>
                  ) : null}
                  <nav className="cases-panel-detail-toolbar" aria-label="用例操作">
                    {!editing ? (
                      <>
                        <div className="cases-panel-detail-toolbar-start">
                          <div className="cases-panel-detail-btn-group" role="group" aria-label="编辑与导出">
                            <button type="button" className="nav-btn nav-btn--compact" onClick={() => setEditing(true)}>
                              编辑 YAML
                            </button>
                            <button
                              type="button"
                              className="nav-btn nav-btn--compact"
                              onClick={() => {
                                setJmxExportMode("current");
                                setJmxExportItemCount(1);
                                setJmxExportOpen(true);
                              }}
                            >
                              生成 JMX
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="nav-btn nav-btn--compact cases-panel-detail-delete"
                          onClick={() => setPendingDelete(true)}
                        >
                          删除用例
                        </button>
                      </>
                    ) : (
                      <div className="cases-panel-detail-toolbar-start">
                        <button type="button" className="primary nav-btn--compact" disabled={saving} onClick={() => void onSave()}>
                          {saving ? "保存中…" : "保存"}
                        </button>
                        <button
                          type="button"
                          className="nav-btn nav-btn--compact"
                          disabled={saving}
                          onClick={() => {
                            setEditDraft(yamlText);
                            setEditing(false);
                          }}
                        >
                          取消编辑
                        </button>
                      </div>
                    )}
                  </nav>
                </header>
                <div className="cases-panel-yaml-host">
                  {editing ? (
                    <textarea
                      className="case-yaml-editor cases-panel-yaml-editor"
                      value={editDraft}
                      spellCheck={false}
                      onChange={(e) => setEditDraft(e.target.value)}
                    />
                  ) : (
                    <CaptureCodeBlock
                      key={activeCase}
                      fullText={
                        resolvedCaseYaml.trim()
                          ? resolvedCaseYaml
                          : "（文件为空或无法读取，请检查 projects/…/cases 下的 YAML）"
                      }
                      language="yaml"
                      maxHeight="none"
                      ariaLabel="用例 YAML"
                      onCopied={(msg) => onNotify?.(msg)}
                    />
                  )}
                </div>
              </>
            )}
              </>
            )}
          </div>
        </div>
      </section>

      {message && (
        <div className="app-toast" role="status">
          <span className="app-toast-dot" />
          {message}
        </div>
      )}

      {newCaseOpen && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h4 className="modal-title">新建用例</h4>
            <label className="perf-field" style={{ width: "100%", marginBottom: 16 }}>
              <span>用例名</span>
              <input
                className="text-input"
                style={{ width: "100%" }}
                value={newCaseName}
                onChange={(e) => setNewCaseName(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="nav-btn" onClick={() => setNewCaseOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void (async () => {
                    const yaml = newCaseYaml(newCaseName);
                    const res = await window.atp.saveProjectCase(project, newCaseName, yaml, {
                      addToSuite: "smoke",
                    });
                    setNewCaseOpen(false);
                    if (!res.ok) {
                      showMsg(res.error ?? "创建失败");
                      return;
                    }
                    showMsg(`已创建 ${res.caseName}`);
                    onRefresh();
                    if (res.caseName) {
                      setEditing(true);
                      onActiveCaseNameChange(res.caseName);
                      setYamlText(yaml);
                      setEditDraft(yaml);
                    }
                  })();
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportJmxDialog
        open={jmxExportOpen}
        title={
          jmxExportMode === "collection"
            ? "生成 JMX（API 集合）"
            : jmxExportMode === "all"
              ? "生成 JMX（全部用例）"
              : "生成 JMX（当前用例）"
        }
        caseCount={jmxExportItemCount}
        collectionMode={jmxExportMode === "collection"}
        defaultPlanName={projectDisplayName || project}
        busy={jmxExportBusy}
        onCancel={() => setJmxExportOpen(false)}
        onConfirm={(opts, target) => void runJmxExport(opts, target)}
      />

      <ConfirmDialog
        open={pendingDelete}
        title="删除用例"
        message={`将删除 cases/${activeCase}.yaml，并从所有套件中移除引用。不可恢复。`}
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => void onDelete()}
      />

      <ConfirmDialog
        open={Boolean(pendingCollectionDelete)}
        title="从集合移除"
        message={`将移除「${pendingCollectionDelete?.request.name || pendingCollectionDelete?.request.id || "请求"}」，集合文件会更新。`}
        confirmLabel="移除"
        danger
        onCancel={() => setPendingCollectionDelete(null)}
        onConfirm={() => {
          if (pendingCollectionDelete) void onDeleteCollectionRequest(pendingCollectionDelete);
        }}
      />
    </>
  );
}

function CasesYamlPreviewWatermark() {
  return (
    <div className="cases-yaml-preview-watermark" aria-hidden>
      <svg viewBox="0 0 120 120" focusable="false">
        <text
          x="50%"
          y="54%"
          dominantBaseline="middle"
          textAnchor="middle"
          fill="currentColor"
          fontSize="42"
          fontFamily="ui-monospace, Consolas, monospace"
          fontWeight="600"
        >
          {"</>"}
        </text>
      </svg>
    </div>
  );
}

function CasesListEmptyIcon({ prominent = false }: { prominent?: boolean }) {
  return (
    <div
      className={`case-list-empty-icon${prominent ? " case-list-empty-icon--prominent" : ""}`}
      aria-hidden
    >
      <svg className="case-list-empty-icon-svg" viewBox="0 0 48 48" focusable="false">
        <path
          d="M12 8h16l8 8v24a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M28 8v8h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M16 22h16M16 28h12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.65" />
      </svg>
    </div>
  );
}

function CasesRowEditIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M11.8 1.9a1.2 1.2 0 0 1 1.7 0l.6.6a1.2 1.2 0 0 1 0 1.7l-7.4 7.4-2.4.8.8-2.4 6.3-6.3ZM3 12.5V14h1.5l6.8-6.8-.8-.8L3 12.5Z"
      />
    </svg>
  );
}

function CasesRowTrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M5.5 1.75a.75.75 0 0 1 .75-.75H9.75a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5h-.38l-.83 9.2A1.5 1.5 0 0 1 11.08 15H4.92a1.5 1.5 0 0 1-1.49-1.3l-.83-9.2H2.5a.75.75 0 0 1 0-1.5H5.5V1.75Zm2 .75v.5h1.5V2.5H7.5ZM4.5 4.5l.78 8.6a.25.25 0 0 0 .24.22h5.16a.25.25 0 0 0 .24-.22l.78-8.6H4.5Z"
      />
    </svg>
  );
}