import { useEffect, useMemo, useState, type ReactNode } from "react";

import ConfirmDialog from "./ConfirmDialog";

export type RunHistoryRow = {
  id: string;
  project: string;
  suite: string;
  environment: string;
  status: string;
  started_at: string;
};

const PAGE_SIZE = 12;

type StatusFilter = "" | "passed" | "failed" | "error";
type TimePreset = "" | "today" | "7d" | "30d" | "custom";

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: "", label: "不限" },
  { id: "passed", label: "passed" },
  { id: "failed", label: "failed" },
  { id: "error", label: "error" },
];

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

function parseRunInstant(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function parseLocalDateTime(value: string): number | null {
  if (!value.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function combineRangeStart(date: string, time: string): string {
  if (!date.trim()) return "";
  return `${date}T${time.trim() || "00:00"}`;
}

function combineRangeEnd(date: string, time: string): string {
  if (!date.trim()) return "";
  return `${date}T${time.trim() || "23:59"}`;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function FilterTagRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="run-filter-row">
      <span className="run-filter-row-label">{label}</span>
      <div className="run-filter-row-tags">{children}</div>
    </div>
  );
}

function FilterTag({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`run-filter-tag${active ? " run-filter-tag--active" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

type ProjectOption = { id: string; name: string };

type Props = {
  runs: RunHistoryRow[];
  projects: ProjectOption[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onRunsDeleted?: (deletedIds: string[]) => void;
  onNotify?: (message: string) => void;
};

export default function RunsHistoryTable({
  runs,
  projects,
  selectedRunId,
  onSelect,
  onRunsDeleted,
  onNotify,
}: Props) {
  const [projectFilter, setProjectFilter] = useState("");
  const [envFilter, setEnvFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [fromDate, setFromDate] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [toDate, setToDate] = useState("");
  const [toTime, setToTime] = useState("");
  const [timePreset, setTimePreset] = useState<TimePreset>("");
  const [timePrecision, setTimePrecision] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const applyPresetDays = (preset: Exclude<TimePreset, "" | "custom">, days: number) => {
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (days <= 1) {
      end.setHours(23, 59, 0, 0);
    } else {
      start.setDate(start.getDate() - (days - 1));
      end.setHours(23, 59, 0, 0);
    }
    setFromDate(toDateInputValue(start));
    setToDate(toDateInputValue(end));
    setFromTime("");
    setToTime("");
    setTimePreset(preset);
  };

  const clearTimeRange = () => {
    setFromDate("");
    setFromTime("");
    setToDate("");
    setToTime("");
    setTimePreset("");
  };

  const rangeStart = useMemo(() => combineRangeStart(fromDate, fromTime), [fromDate, fromTime]);
  const rangeEnd = useMemo(() => combineRangeEnd(toDate, toTime), [toDate, toTime]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name.trim() || p.id);
    return map;
  }, [projects]);

  const resolveProjectName = (id: string) => projectNameById.get(id) ?? id;

  const projectOptions = useMemo(() => {
    const ids = [...new Set(runs.map((r) => r.project).filter(Boolean))];
    return ids
      .sort((a, b) => resolveProjectName(a).localeCompare(resolveProjectName(b), "zh"))
      .map((id) => ({ id, name: projectNameById.get(id) ?? id }));
  }, [runs, projectNameById]);
  const envOptions = useMemo(
    () => [...new Set(runs.map((r) => r.environment).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")),
    [runs],
  );

  const filtered = useMemo(() => {
    const fromMs = parseLocalDateTime(rangeStart);
    const toMs = parseLocalDateTime(rangeEnd);
    return runs.filter((r) => {
      if (projectFilter && r.project !== projectFilter) return false;
      if (envFilter && r.environment !== envFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      const started = parseRunInstant(r.started_at);
      if (fromMs != null && started != null && started < fromMs) return false;
      if (toMs != null && started != null && started > toMs) return false;
      return true;
    });
  }, [runs, projectFilter, envFilter, statusFilter, rangeStart, rangeEnd]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE) || 1);
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const hasActiveFilters = Boolean(
    projectFilter || envFilter || statusFilter || fromDate || fromTime || toDate || toTime,
  );

  const clearFilters = () => {
    setProjectFilter("");
    setEnvFilter("");
    setStatusFilter("");
    clearTimeRange();
    setTimePrecision(false);
    setMoreOpen(false);
  };

  useEffect(() => {
    setPage(1);
  }, [projectFilter, envFilter, statusFilter, fromDate, fromTime, toDate, toTime, runs]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const runIdSet = useMemo(() => new Set(runs.map((r) => r.id)), [runs]);

  useEffect(() => {
    setCheckedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (runIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [runIdSet]);

  const pagedIds = useMemo(() => paged.map((r) => r.id), [paged]);
  const allPageChecked = pagedIds.length > 0 && pagedIds.every((id) => checkedIds.has(id));
  const pageSelectedCount = useMemo(
    () => pagedIds.filter((id) => checkedIds.has(id)).length,
    [pagedIds, checkedIds],
  );

  const toggleRowChecked = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePageAll = (checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const id of pagedIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setCheckedIds(new Set(filtered.map((r) => r.id)));
  };

  const selectedDeleteIds = useMemo(
    () => [...checkedIds].filter((id) => runIdSet.has(id)),
    [checkedIds, runIdSet],
  );

  const doDeleteSelected = async () => {
    if (!selectedDeleteIds.length) return;
    setDeleteBusy(true);
    try {
      const res = await window.atp.deleteRuns(selectedDeleteIds);
      if (res.errors.length) onNotify?.(res.errors.join("；"));
      if (res.deleted > 0) {
        onNotify?.(`已删除 ${res.deleted} 条执行记录`);
        onRunsDeleted?.(selectedDeleteIds);
        setCheckedIds((prev) => {
          const next = new Set(prev);
          for (const id of selectedDeleteIds) next.delete(id);
          return next;
        });
      } else if (!res.errors.length) {
        onNotify?.("未删除任何记录");
      }
    } finally {
      setDeleteBusy(false);
      setConfirmDeleteSelected(false);
    }
  };

  const doClearAll = async () => {
    setDeleteBusy(true);
    try {
      const res = await window.atp.clearAllRuns();
      if (!res.ok) {
        onNotify?.(res.error ?? "清空失败");
        return;
      }
      onNotify?.(`已清空 ${res.deleted} 条执行记录`);
      setCheckedIds(new Set());
      onRunsDeleted?.(runs.map((r) => r.id));
    } finally {
      setDeleteBusy(false);
      setConfirmClearAll(false);
    }
  };

  const timeCustomActive =
    timePreset === "custom" || (Boolean(fromDate || toDate) && timePreset !== "today" && timePreset !== "7d" && timePreset !== "30d");

  return (
    <>
      <section className="run-filter-panel" role="search" aria-label="筛选执行记录">
        <div className="run-filter-panel-head">
          <h4 className="run-filter-panel-title">条件筛选</h4>
          <span className="run-history-toolbar-meta">
            {filtered.length === runs.length
              ? `共 ${runs.length} 条`
              : `匹配 ${filtered.length} / ${runs.length} 条`}
          </span>
          {hasActiveFilters ? (
            <button type="button" className="run-filter-reset-link" onClick={clearFilters}>
              重置条件
            </button>
          ) : null}
        </div>

        <div className="run-filter-panel-body">
          <FilterTagRow label="项目">
            <FilterTag active={!projectFilter} onClick={() => setProjectFilter("")}>
              不限
            </FilterTag>
            {projectOptions.map((p) => (
              <FilterTag
                key={p.id}
                active={projectFilter === p.id}
                onClick={() => setProjectFilter(p.id)}
                title={`${p.name}（${p.id}）`}
              >
                {p.name}
              </FilterTag>
            ))}
          </FilterTagRow>

          <FilterTagRow label="环境">
            <FilterTag active={!envFilter} onClick={() => setEnvFilter("")}>
              不限
            </FilterTag>
            {envOptions.map((e) => (
              <FilterTag key={e} active={envFilter === e} onClick={() => setEnvFilter(e)}>
                {e}
              </FilterTag>
            ))}
          </FilterTagRow>

          <FilterTagRow label="状态">
            {STATUS_OPTIONS.map((s) => (
              <FilterTag
                key={s.id || "all"}
                active={statusFilter === s.id}
                onClick={() => setStatusFilter(s.id)}
              >
                {s.label}
              </FilterTag>
            ))}
          </FilterTagRow>

          <FilterTagRow label="时间">
            <FilterTag active={!timeCustomActive && !timePreset} onClick={clearTimeRange}>
              不限
            </FilterTag>
            <FilterTag active={timePreset === "today"} onClick={() => applyPresetDays("today", 1)}>
              今天
            </FilterTag>
            <FilterTag active={timePreset === "7d"} onClick={() => applyPresetDays("7d", 7)}>
              近 7 天
            </FilterTag>
            <FilterTag active={timePreset === "30d"} onClick={() => applyPresetDays("30d", 30)}>
              近 30 天
            </FilterTag>
            <FilterTag
              active={timeCustomActive && timePreset === "custom"}
              onClick={() => {
                setTimePreset("custom");
                setMoreOpen(true);
              }}
            >
              自定义
            </FilterTag>
          </FilterTagRow>
        </div>

        <button
          type="button"
          className="run-filter-more-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span>{moreOpen ? "收起更多条件" : "展开更多条件"}</span>
          <span className="run-filter-more-chevron" aria-hidden>
            {moreOpen ? "▴" : "▾"}
          </span>
        </button>

        {moreOpen ? (
          <div className="run-filter-more-panel">
            <div className="run-filter-custom-range">
              <label className="run-filter-custom-field">
                <span className="run-filter-custom-label">开始日期</span>
                <input
                  type="date"
                  className="text-input run-filter-date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setTimePreset("custom");
                  }}
                />
              </label>
              {timePrecision ? (
                <label className="run-filter-custom-field run-filter-custom-field--time">
                  <span className="run-filter-custom-label">时刻</span>
                  <input
                    type="time"
                    className="text-input run-filter-time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                    step={60}
                  />
                </label>
              ) : null}
              <span className="run-filter-range-sep">至</span>
              <label className="run-filter-custom-field">
                <span className="run-filter-custom-label">结束日期</span>
                <input
                  type="date"
                  className="text-input run-filter-date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setTimePreset("custom");
                  }}
                />
              </label>
              {timePrecision ? (
                <label className="run-filter-custom-field run-filter-custom-field--time">
                  <span className="run-filter-custom-label">时刻</span>
                  <input
                    type="time"
                    className="text-input run-filter-time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    step={60}
                  />
                </label>
              ) : null}
            </div>
            <label className="run-filter-time-precision">
              <input
                type="checkbox"
                checked={timePrecision}
                onChange={(e) => {
                  setTimePrecision(e.target.checked);
                  if (!e.target.checked) {
                    setFromTime("");
                    setToTime("");
                  }
                }}
              />
              精确到时刻
            </label>
          </div>
        ) : null}
      </section>

      {runs.length > 0 ? (
        <div className="run-history-bulk-toolbar">
          <span className="run-history-bulk-hint">可多选后批量删除</span>
          {selectedDeleteIds.length > 0 ? (
            <span className="run-history-bulk-meta">已选 {selectedDeleteIds.length} 条</span>
          ) : null}
          {filtered.length > paged.length ? (
            <button
              type="button"
              className="nav-btn nav-btn--compact"
              disabled={deleteBusy}
              onClick={selectAllFiltered}
            >
              全选筛选结果（{filtered.length}）
            </button>
          ) : null}
          <button
            type="button"
            className="nav-btn nav-btn--compact danger"
            disabled={deleteBusy || selectedDeleteIds.length === 0}
            onClick={() => setConfirmDeleteSelected(true)}
          >
            删除选中
          </button>
          <button
            type="button"
            className="nav-btn nav-btn--compact danger"
            disabled={deleteBusy || !runs.length}
            onClick={() => setConfirmClearAll(true)}
          >
            清空全部
          </button>
        </div>
      ) : null}

      <div className="run-history-table-wrap">
        <table className="run-history-table">
          <thead>
            <tr>
              <th className="run-history-col-check">
                <input
                  type="checkbox"
                  className="run-history-check"
                  aria-label="全选本页"
                  disabled={!paged.length || deleteBusy}
                  checked={allPageChecked}
                  aria-checked={
                    allPageChecked ? true : pageSelectedCount > 0 ? "mixed" : false
                  }
                  onChange={(e) => togglePageAll(e.target.checked)}
                />
              </th>
              <th>时间</th>
              <th>状态</th>
              <th>项目</th>
              <th>套件</th>
              <th>环境</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr
                key={r.id}
                className={`clickable run-history-row${selectedRunId === r.id ? " run-history-row--active" : ""}`}
                onClick={() => onSelect(r.id)}
              >
                <td className="run-history-col-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="run-history-check"
                    aria-label={`选择 ${r.id}`}
                    disabled={deleteBusy}
                    checked={checkedIds.has(r.id)}
                    onChange={(e) => toggleRowChecked(r.id, e.target.checked)}
                  />
                </td>
                <td title={r.started_at}>{formatRunTime(r.started_at)}</td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                <td title={r.project}>{resolveProjectName(r.project)}</td>
                <td>{r.suite}</td>
                <td>{r.environment}</td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={6} className="run-history-empty">
                  尚无执行记录，请前往左侧「运行套件」执行。
                </td>
              </tr>
            )}
            {runs.length > 0 && !filtered.length && (
              <tr>
                <td colSpan={6} className="run-history-empty">
                  无匹配结果
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="pagination run-history-pagination">
          <button
            type="button"
            className="nav-btn nav-btn--compact"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="pagination-info">
            {page}/{pageCount}
          </span>
          <button
            type="button"
            className="nav-btn nav-btn--compact"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            下一页
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDeleteSelected}
        title="删除执行记录"
        message={`确定删除已选的 ${selectedDeleteIds.length} 条记录？将移除 runs 目录下对应数据，不可恢复。`}
        confirmLabel="删除"
        danger
        onConfirm={() => void doDeleteSelected()}
        onCancel={() => !deleteBusy && setConfirmDeleteSelected(false)}
      />
      <ConfirmDialog
        open={confirmClearAll}
        title="清空全部执行记录"
        message={`确定清空全部 ${runs.length} 条记录？将删除所有 runs 目录与索引，不可恢复。`}
        confirmLabel="清空"
        danger
        onConfirm={() => void doClearAll()}
        onCancel={() => !deleteBusy && setConfirmClearAll(false)}
      />
    </>
  );
}