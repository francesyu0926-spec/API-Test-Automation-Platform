import { useCallback, useEffect, useMemo, useState } from "react";

import type { OpenApiExportItem, OpenApiExportOptions } from "./openapiExport";
import { loadOpenApiExportItems, saveOpenApiExport } from "./openapiExport";

type Project = { id: string; name: string };

type Props = {
  open: boolean;
  projects: Project[];
  defaultServerUrl?: string;
  onCancel: () => void;
  onNotify?: (text: string) => void;
};

export default function ExportOpenApiDialog({
  open,
  projects,
  defaultServerUrl,
  onCancel,
  onNotify,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<OpenApiExportItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("API Test Platform Export");
  const [version, setVersion] = useState("1.0.0");
  const [serverUrl, setServerUrl] = useState(defaultServerUrl ?? "{{base_url}}");
  const [format, setFormat] = useState<"json" | "yaml">("json");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());

  const reload = useCallback(async () => {
    if (!projects.length) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await loadOpenApiExportItems(projects);
      setItems(rows);
      setSelected(new Set(rows.map((r) => r.key)));
      setExpandedProjects(new Set(projects.map((p) => p.id)));
    } finally {
      setLoading(false);
    }
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    setTitle("API Test Platform Export");
    setVersion("1.0.0");
    setServerUrl(defaultServerUrl?.trim() || "{{base_url}}");
    setFormat("json");
    setFilter("");
    void reload();
  }, [open, defaultServerUrl, reload]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.projectName.toLowerCase().includes(q) ||
        i.projectId.toLowerCase().includes(q) ||
        (i.detail ?? "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; rows: OpenApiExportItem[] }>();
    for (const row of filtered) {
      const cur = map.get(row.projectId) ?? { projectName: row.projectName, rows: [] };
      cur.rows.push(row);
      map.set(row.projectId, cur);
    }
    return [...map.entries()].sort((a, b) => a[1].projectName.localeCompare(b[1].projectName, "zh"));
  }, [filtered]);

  const selectedCount = selected.size;

  const projectKeys = (projectId: string) =>
    items.filter((i) => i.projectId === projectId).map((i) => i.key);

  const toggleProject = (projectId: string, checked: boolean) => {
    const keys = projectKeys(projectId);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const projectAllChecked = (projectId: string) => {
    const keys = projectKeys(projectId);
    return keys.length > 0 && keys.every((k) => selected.has(k));
  };

  const projectSomeChecked = (projectId: string) => {
    const keys = projectKeys(projectId);
    return keys.some((k) => selected.has(k)) && !projectAllChecked(projectId);
  };

  const onExport = async () => {
    const opts: OpenApiExportOptions = { title, version, serverUrl, format };
    setBusy(true);
    try {
      const res = await saveOpenApiExport(items, selected, opts);
      if (res.cancelled) return;
      if (!res.ok) {
        onNotify?.(res.error ?? "导出失败");
        return;
      }
      const warn = res.warnings?.length ? `（${res.warnings.slice(0, 2).join("；")}）` : "";
      onNotify?.(`已导出 ${selectedCount} 条请求${warn}`);
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-card modal-card--wide export-openapi-modal"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h4 className="modal-title">导出 OpenAPI</h4>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          可多选项目及其 YAML 用例、API 集合请求（与集合中已有 YAML 的条目会自动去重）。导出为 OpenAPI 3.0。
        </p>

        <div className="grid-2 export-openapi-meta" style={{ gap: 12, marginBottom: 14 }}>
          <label className="perf-field">
            <span>文档标题</span>
            <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </label>
          <label className="perf-field">
            <span>版本</span>
            <input className="text-input" value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy} />
          </label>
          <label className="perf-field">
            <span>servers[0].url</span>
            <input
              className="text-input"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="{{base_url}} 或 https://api.example.com"
              disabled={busy}
            />
          </label>
          <label className="perf-field">
            <span>文件格式</span>
            <select
              className="text-input"
              value={format}
              disabled={busy}
              onChange={(e) => setFormat(e.target.value as "json" | "yaml")}
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
          </label>
        </div>

        <div className="export-openapi-toolbar">
          <input
            className="text-input export-openapi-filter"
            placeholder="搜索项目或用例…"
            value={filter}
            disabled={loading || busy}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="hint">已选 {selectedCount} / {items.length}</span>
          <button
            type="button"
            className="nav-btn nav-btn--compact"
            disabled={loading || busy || !items.length}
            onClick={() => setSelected(new Set(items.map((i) => i.key)))}
          >
            全选
          </button>
          <button
            type="button"
            className="nav-btn nav-btn--compact"
            disabled={loading || busy || !selectedCount}
            onClick={() => setSelected(new Set())}
          >
            清空
          </button>
        </div>

        <div className="export-openapi-list" role="list">
          {loading ? <p className="hint">加载请求列表…</p> : null}
          {!loading && !items.length ? (
            <p className="hint">暂无项目或可导出的请求。</p>
          ) : null}
          {grouped.map(([projectId, group]) => {
            const open = expandedProjects.has(projectId);
            return (
              <div key={projectId} className="export-openapi-project" role="listitem">
                <header className="export-openapi-project-head">
                  <label className="export-openapi-check export-openapi-check--project">
                    <input
                      type="checkbox"
                      checked={projectAllChecked(projectId)}
                      disabled={busy}
                      onChange={(e) => toggleProject(projectId, e.target.checked)}
                    />
                    <span className="export-openapi-project-title">{group.projectName}</span>
                    <span className="hint export-openapi-project-id">{projectId}</span>
                  </label>
                  <button
                    type="button"
                    className="nav-btn nav-btn--compact nav-btn--ghost"
                    onClick={() =>
                      setExpandedProjects((prev) => {
                        const next = new Set(prev);
                        if (next.has(projectId)) next.delete(projectId);
                        else next.add(projectId);
                        return next;
                      })
                    }
                  >
                    {open ? "收起" : "展开"} ({group.rows.length})
                  </button>
                </header>
                {projectSomeChecked(projectId) && !projectAllChecked(projectId) ? (
                  <p className="hint export-openapi-partial">部分已选</p>
                ) : null}
                {open ? (
                  <ul className="export-openapi-rows">
                    {group.rows.map((row) => (
                      <li key={row.key}>
                        <label className="export-openapi-check">
                          <input
                            type="checkbox"
                            checked={selected.has(row.key)}
                            disabled={busy}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(row.key);
                                else next.delete(row.key);
                                return next;
                              })
                            }
                          />
                          <span>{row.label}</span>
                          <span className="hint export-openapi-row-detail">{row.detail}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button type="button" className="nav-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || loading || !selectedCount}
            onClick={() => void onExport()}
          >
            {busy ? "导出中…" : "导出到文件…"}
          </button>
        </div>
      </div>
    </div>
  );
}