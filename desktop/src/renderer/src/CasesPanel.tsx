import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import ConfirmDialog from "./ConfirmDialog";
import LoadingOverlay from "./LoadingOverlay";
import { caseYamlToWorkbenchDraft } from "./caseYaml";
import { newCaseYaml } from "./newCaseTemplate";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";

type Props = {
  project: string;
  cases: string[];
  onRefresh: () => void;
  onOpenInWorkbench?: (draft: WorkbenchDraft) => void;
};

export default function CasesPanel({ project, cases, onRefresh, onOpenInWorkbench }: Props) {
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newCaseName, setNewCaseName] = useState("new-case");
  const [caseFilter, setCaseFilter] = useState("");
  const [listPage, setListPage] = useState(1);
  const [caseLoading, setCaseLoading] = useState(false);

  const CASE_LIST_PAGE = 14;

  const loadCase = useCallback(
    async (caseName: string) => {
      if (!project) return;
      setCaseLoading(true);
      try {
        const text = await window.atp.readFile(`projects/${project}/cases/${caseName}.yaml`);
        setSelectedCase(caseName);
        setYamlText(text ?? "");
        setEditDraft(text ?? "");
        setEditing(false);
      } finally {
        setCaseLoading(false);
      }
    },
    [project],
  );

  useEffect(() => {
    setSelectedCase(null);
    setYamlText("");
    setEditing(false);
  }, [project]);

  useEffect(() => {
    if (selectedCase && cases.includes(selectedCase)) return;
    if (cases.length) void loadCase(cases[0]);
    else {
      setSelectedCase(null);
      setYamlText("");
    }
  }, [cases, selectedCase, loadCase]);

  const filteredCases = useMemo(() => {
    const q = caseFilter.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => c.toLowerCase().includes(q));
  }, [cases, caseFilter]);

  const listPageCount = Math.max(1, Math.ceil(filteredCases.length / CASE_LIST_PAGE) || 1);
  const pagedCases = useMemo(() => {
    const start = (listPage - 1) * CASE_LIST_PAGE;
    return filteredCases.slice(start, start + CASE_LIST_PAGE);
  }, [filteredCases, listPage]);

  useEffect(() => {
    setListPage(1);
  }, [caseFilter, project]);

  useEffect(() => {
    if (listPage > listPageCount) setListPage(listPageCount);
  }, [listPage, listPageCount]);

  const showMsg = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2800);
  };

  const onSave = async () => {
    if (!project || !selectedCase) return;
    setSaving(true);
    const res = await window.atp.updateProjectCase(project, selectedCase, editDraft);
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
    if (!project || !selectedCase) return;
    setSaving(true);
    const res = await window.atp.deleteProjectCase(project, selectedCase);
    setSaving(false);
    setPendingDelete(false);
    if (!res.ok) {
      showMsg(res.error ?? "删除失败");
      return;
    }
    showMsg("已删除用例");
    setSelectedCase(null);
    setYamlText("");
    setEditing(false);
    onRefresh();
  };

  if (!project) {
    return (
      <Card title="用例列表">
        <div className="panel-empty-state panel-empty-state--compact">
          <p className="panel-empty-title">未选择项目</p>
          <p className="panel-empty-hint">请在上方下拉框选择项目，或新建项目后再管理用例。</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card title={`用例列表${cases.length ? ` · ${cases.length}` : ""}`}>
        <div className="case-list-toolbar">
          <button type="button" className="primary" onClick={() => setNewCaseOpen(true)}>
            新建用例
          </button>
          <input
            type="search"
            className="text-input case-list-search"
            placeholder="搜索用例"
            value={caseFilter}
            onChange={(e) => setCaseFilter(e.target.value)}
          />
          <span className="case-list-count">
            {filteredCases.length === cases.length
              ? `${cases.length} 条`
              : `${filteredCases.length} / ${cases.length}`}
          </span>
        </div>
        <div className="case-list-scroll">
          {pagedCases.map((c) => (
            <button
              key={c}
              type="button"
              className={`case-list-row${selectedCase === c ? " active" : ""}`}
              onClick={() => void loadCase(c)}
              title={c}
            >
              {c}
            </button>
          ))}
          {!cases.length && (
            <div className="case-list-empty">
              <p className="case-list-empty-title">暂无用例</p>
              <p className="case-list-empty-hint">点击「新建用例」，或从 API 工作台 / 抓包保存为用例。</p>
            </div>
          )}
          {cases.length > 0 && !filteredCases.length && (
            <div className="case-list-empty">无匹配</div>
          )}
        </div>
        {filteredCases.length > CASE_LIST_PAGE && (
          <div className="pagination case-list-pagination">
            <button
              type="button"
              className="nav-btn"
              disabled={listPage <= 1}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="pagination-info">
              {listPage} / {listPageCount}
            </span>
            <button
              type="button"
              className="nav-btn"
              disabled={listPage >= listPageCount}
              onClick={() => setListPage((p) => Math.min(listPageCount, p + 1))}
            >
              下一页
            </button>
          </div>
        )}
      </Card>

      {(selectedCase || caseLoading) && (
        <Card title={selectedCase ? `用例 · ${selectedCase}` : "用例"}>
          <div className="loading-host" style={{ minHeight: caseLoading && !yamlText ? 160 : undefined }}>
            <LoadingOverlay show={caseLoading} label="加载用例…" />
          {yamlText !== "" && (
            <>
          <nav className="toolbar" style={{ marginBottom: 12 }}>
            {!editing ? (
              <>
                <button type="button" className="nav-btn" onClick={() => setEditing(true)}>
                  编辑
                </button>
                {onOpenInWorkbench && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const draft = caseYamlToWorkbenchDraft(yamlText);
                      if (!draft) {
                        showMsg("无法解析用例 YAML");
                        return;
                      }
                      onOpenInWorkbench(draft);
                    }}
                  >
                    在工作台打开
                  </button>
                )}
                <button type="button" className="primary danger" onClick={() => setPendingDelete(true)}>
                  删除
                </button>
              </>
            ) : (
              <>
                <button type="button" className="primary" disabled={saving} onClick={() => void onSave()}>
                  {saving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  disabled={saving}
                  onClick={() => {
                    setEditDraft(yamlText);
                    setEditing(false);
                  }}
                >
                  取消
                </button>
              </>
            )}
          </nav>
          {editing ? (
            <textarea
              className="case-yaml-editor"
              value={editDraft}
              spellCheck={false}
              onChange={(e) => setEditDraft(e.target.value)}
            />
          ) : (
            <pre className="case-yaml-pre">{yamlText}</pre>
          )}
            </>
          )}
          </div>
        </Card>
      )}

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
                      setSelectedCase(res.caseName);
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

      <ConfirmDialog
        open={pendingDelete}
        title="删除用例"
        message={`将删除 cases/${selectedCase}.yaml，并从所有套件中移除引用。不可恢复。`}
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(false)}
        onConfirm={() => void onDelete()}
      />
    </>
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