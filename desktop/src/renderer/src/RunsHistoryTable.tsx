import { useEffect, useMemo, useRef, useState } from "react";

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

type FilterPillIcon = "filter" | "calendar";

function FilterPillLeadIcon({ type }: { type: FilterPillIcon }) {
  if (type === "calendar") {
    return (
      <svg className="run-filter-pill-svg" width="13" height="13" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11zM7 11h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z"
        />
      </svg>
    );
  }
  return (
    <svg className="run-filter-pill-svg" width="13" height="13" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M4 6h16v2H4V6zm3 5h10v2H7v-2zm-4 5h18v2H3v-2z" />
    </svg>
  );
}

function FilterPill({
  dim,
  valueLabel,
  active,
  open,
  onToggle,
  showDefaultIcon,
  defaultIcon,
  children,
}: {
  dim: string;
  valueLabel: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  showDefaultIcon?: boolean;
  defaultIcon?: FilterPillIcon;
  children: React.ReactNode;
}) {
  return (
    <div className={`run-filter-pill-wrap${open ? " run-filter-pill-wrap--open" : ""}`}>
      <button
        type="button"
        className={`run-filter-pill${active ? " run-filter-pill--active" : ""}${open ? " run-filter-pill--open" : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="run-filter-pill-dim">{dim}</span>
        <span className="run-filter-pill-val" title={valueLabel}>
          {showDefaultIcon ? (
            <span className="run-filter-pill-val-inner">
              <FilterPillLeadIcon type={defaultIcon ?? "filter"} />
              {valueLabel}
            </span>
          ) : (
            valueLabel
          )}
        </span>
        <span className="run-filter-pill-chev" aria-hidden>
          ▾
        </span>
      </button>
      {open ? <div className="run-filter-dropdown">{children}</div> : null}
    </div>
  );
}

function FilterMenuItem({
  selected,
  onClick,
  children,
  title,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`run-filter-menu-item${selected ? " run-filter-menu-item--selected" : ""}`}
      title={title}
      onClick={onClick}
    >
      <span className="run-filter-menu-item-label">{children}</span>
      {selected ? (
        <span className="run-filter-menu-check" aria-hidden>
          ✓
        </span>
      ) : null}
    </button>
  );
}

function formatPillDate(isoDate: string): string {
  return isoDate.replace(/-/g, "/");
}

type ProjectOption = { id: string; name: string };

type Props = {
  runs: RunHistoryRow[];
  projects: ProjectOption[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  /** 当前选中记录不在筛选结果内时回调（避免下方仍展示旧详情） */
  onClearSelection?: () => void;
  onRunsDeleted?: (deletedIds: string[]) => void;
  onNotify?: (message: string) => void;
};

export default function RunsHistoryTable({
  runs,
  projects,
  selectedRunId,
  onSelect,
  onClearSelection,
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
  const [searchQuery, setSearchQuery] = useState("");
  const [openMenu, setOpenMenu] = useState<FilterMenuId | null>(null);
  const [timeCustomExpanded, setTimeCustomExpanded] = useState(false);
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [draftFromTime, setDraftFromTime] = useState("");
  const [draftToTime, setDraftToTime] = useState("");
  const [draftTimePrecision, setDraftTimePrecision] = useState(false);
  const filterBarRef = useRef<HTMLDivElement>(null);
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
    setDraftFromDate("");
    setDraftToDate("");
    setDraftFromTime("");
    setDraftToTime("");
    setDraftTimePrecision(false);
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
    const q = searchQuery.trim().toLowerCase();
    return runs.filter((r) => {
      if (projectFilter && r.project !== projectFilter) return false;
      if (envFilter && r.environment !== envFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (q && !r.suite.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
      const started = parseRunInstant(r.started_at);
      if (fromMs != null && started != null && started < fromMs) return false;
      if (toMs != null && started != null && started > toMs) return false;
      return true;
    });
  }, [runs, projectFilter, envFilter, statusFilter, rangeStart, rangeEnd, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE) || 1);
  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const hasActiveFilters = Boolean(
    projectFilter ||
      envFilter ||
      statusFilter ||
      fromDate ||
      fromTime ||
      toDate ||
      toTime ||
      searchQuery.trim(),
  );

  const clearFilters = () => {
    setProjectFilter("");
    setEnvFilter("");
    setStatusFilter("");
    clearTimeRange();
    setTimePrecision(false);
    setTimeCustomExpanded(false);
    setSearchQuery("");
    setOpenMenu(null);
  };

  const syncTimeDraftFromApplied = () => {
    setDraftFromDate(fromDate);
    setDraftToDate(toDate);
    setDraftFromTime(fromTime);
    setDraftToTime(toTime);
    setDraftTimePrecision(timePrecision);
  };

  const toggleMenu = (id: FilterMenuId) => {
    setOpenMenu((prev) => {
      const next = prev === id ? null : id;
      if (next === "time" && (timePreset === "custom" || timeCustomActive)) {
        setTimeCustomExpanded(true);
        syncTimeDraftFromApplied();
      }
      return next;
    });
  };

  const openTimeCustom = () => {
    setTimeCustomExpanded(true);
    setTimePreset("custom");
    syncTimeDraftFromApplied();
  };

  const applyCustomTimeRange = () => {
    if (!draftFromDate && !draftToDate) return;
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setFromTime(draftTimePrecision ? draftFromTime : "");
    setToTime(draftTimePrecision ? draftToTime : "");
    setTimePrecision(draftTimePrecision);
    setTimePreset("custom");
    setTimeCustomExpanded(false);
    setOpenMenu(null);
  };

  const pickOption = (after: () => void) => {
    after();
    setTimeCustomExpanded(false);
    setOpenMenu(null);
  };

  useEffect(() => {
    if (!openMenu) {
      setTimeCustomExpanded(false);
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const root = filterBarRef.current;
      if (root && !root.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenu]);

  useEffect(() => {
    setPage(1);
  }, [projectFilter, envFilter, statusFilter, fromDate, fromTime, toDate, toTime, searchQuery, runs]);

  useEffect(() => {
    if (!selectedRunId || !onClearSelection) return;
    if (!filtered.some((r) => r.id === selectedRunId)) {
      onClearSelection();
    }
  }, [filtered, selectedRunId, onClearSelection]);

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

  const timeCustomActive = timePreset === "custom";

  const projectPillLabel = projectFilter ? resolveProjectName(projectFilter) : "不限";
  const envPillLabel = envFilter || "不限";
  const statusPillLabel = statusFilter || "不限";

  const timePillLabel = (() => {
    if (timePreset === "today") return "今天";
    if (timePreset === "7d") return "近 7 天";
    if (timePreset === "30d") return "近 30 天";
    if (timePreset === "custom") {
      if (fromDate && toDate) return `${formatPillDate(fromDate)} ~ ${formatPillDate(toDate)}`;
      return "自定义";
    }
    return "全部";
  })();

  const timeFilterActive = Boolean(timePreset);

  return (
    <>
      <section className="run-filter-panel run-filter-panel--compact" role="search" aria-label="筛选执行记录">
        <div className="run-filter-bar" ref={filterBarRef}>
          <FilterPill
            dim="项目"
            valueLabel={projectPillLabel}
            active={Boolean(projectFilter)}
            showDefaultIcon={!projectFilter}
            defaultIcon="filter"
            open={openMenu === "project"}
            onToggle={() => toggleMenu("project")}
          >
            <div className="run-filter-dropdown-menu" role="menu">
              <FilterMenuItem selected={!projectFilter} onClick={() => pickOption(() => setProjectFilter(""))}>
                不限
              </FilterMenuItem>
              {projectOptions.map((p) => (
                <FilterMenuItem
                  key={p.id}
                  selected={projectFilter === p.id}
                  title={`${p.name}（${p.id}）`}
                  onClick={() => pickOption(() => setProjectFilter(p.id))}
                >
                  {p.name}
                </FilterMenuItem>
              ))}
            </div>
          </FilterPill>

          <FilterPill
            dim="环境"
            valueLabel={envPillLabel}
            active={Boolean(envFilter)}
              showDefaultIcon={!envFilter}
              defaultIcon="filter"
              open={openMenu === "env"}
            onToggle={() => toggleMenu("env")}
          >
            <div className="run-filter-dropdown-menu" role="menu">
              <FilterMenuItem selected={!envFilter} onClick={() => pickOption(() => setEnvFilter(""))}>
                不限
              </FilterMenuItem>
              {envOptions.map((e) => (
                <FilterMenuItem
                  key={e}
                  selected={envFilter === e}
                  onClick={() => pickOption(() => setEnvFilter(e))}
                >
                  {e}
                </FilterMenuItem>
              ))}
            </div>
          </FilterPill>

          <FilterPill
            dim="状态"
            valueLabel={statusPillLabel}
            active={Boolean(statusFilter)}
            showDefaultIcon={!statusFilter}
            defaultIcon="filter"
            open={openMenu === "status"}
            onToggle={() => toggleMenu("status")}
          >
            <div className="run-filter-dropdown-menu" role="menu">
              {STATUS_OPTIONS.map((s) => (
                <FilterMenuItem
                  key={s.id || "all"}
                  selected={statusFilter === s.id}
                  onClick={() => pickOption(() => setStatusFilter(s.id))}
                >
                  {s.label}
                </FilterMenuItem>
              ))}
            </div>
          </FilterPill>

          <FilterPill
            dim="时间"
            valueLabel={timePillLabel}
            active={timeFilterActive}
            showDefaultIcon
            defaultIcon="calendar"
            open={openMenu === "time"}
            onToggle={() => toggleMenu("time")}
          >
            <div
              className={`run-filter-dropdown-menu${timeCustomExpanded ? " run-filter-dropdown-menu--wide" : ""}`}
              role="menu"
            >
              <FilterMenuItem
                selected={!timeFilterActive}
                onClick={() => pickOption(() => clearTimeRange())}
              >
                全部
              </FilterMenuItem>
              <FilterMenuItem
                selected={timePreset === "today"}
                onClick={() => pickOption(() => applyPresetDays("today", 1))}
              >
                今天
              </FilterMenuItem>
              <FilterMenuItem selected={timePreset === "7d"} onClick={() => pickOption(() => applyPresetDays("7d", 7))}>
                近 7 天
              </FilterMenuItem>
              <FilterMenuItem
                selected={timePreset === "30d"}
                onClick={() => pickOption(() => applyPresetDays("30d", 30))}
              >
                近 30 天
              </FilterMenuItem>
              <FilterMenuItem
                selected={timeCustomExpanded || timePreset === "custom"}
                onClick={openTimeCustom}
              >
                自定义
              </FilterMenuItem>
              {timeCustomExpanded ? (
                <div className="run-filter-dropdown-custom">
                  <div className="run-filter-date-range run-filter-date-range--inline">
                    <input
                      type="date"
                      className="text-input run-filter-date run-filter-date--compact"
                      value={draftFromDate}
                      aria-label="开始日期"
                      onChange={(e) => setDraftFromDate(e.target.value)}
                    />
                    <span className="run-filter-range-sep" aria-hidden>
                      -
                    </span>
                    <input
                      type="date"
                      className="text-input run-filter-date run-filter-date--compact"
                      value={draftToDate}
                      aria-label="结束日期"
                      onChange={(e) => setDraftToDate(e.target.value)}
                    />
                  </div>
                  {draftTimePrecision ? (
                    <div className="run-filter-time-range run-filter-date-range--inline">
                      <input
                        type="time"
                        className="text-input run-filter-time run-filter-time--compact"
                        value={draftFromTime}
                        aria-label="开始时刻"
                        onChange={(e) => setDraftFromTime(e.target.value)}
                        step={60}
                      />
                      <span className="run-filter-range-sep" aria-hidden>
                        -
                      </span>
                      <input
                        type="time"
                        className="text-input run-filter-time run-filter-time--compact"
                        value={draftToTime}
                        aria-label="结束时刻"
                        onChange={(e) => setDraftToTime(e.target.value)}
                        step={60}
                      />
                    </div>
                  ) : null}
                  <label className="run-filter-time-precision">
                    <input
                      type="checkbox"
                      className="capture-session-checkbox"
                      checked={draftTimePrecision}
                      onChange={(e) => {
                        setDraftTimePrecision(e.target.checked);
                        if (!e.target.checked) {
                          setDraftFromTime("");
                          setDraftToTime("");
                        }
                      }}
                    />
                    精确到时刻
                  </label>
                  <div className="run-filter-custom-actions">
                    <button
                      type="button"
                      className="primary run-filter-custom-apply"
                      disabled={!draftFromDate && !draftToDate}
                      onClick={applyCustomTimeRange}
                    >
                      应用
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </FilterPill>

          <label className="run-filter-search">
            <span className="run-filter-search-icon" aria-hidden>
              ⌕
            </span>
            <input
              type="search"
              className="text-input run-filter-search-input"
              placeholder="搜索套件 / Run ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="搜索套件或 Run ID"
            />
          </label>

          <div className="run-filter-bar-end">
            {hasActiveFilters ? (
              <button type="button" className="run-filter-reset-link" onClick={clearFilters}>
                <span className="run-filter-reset-icon" aria-hidden>
                  ↺
                </span>
                重置筛选
              </button>
            ) : null}
            <span className="run-history-toolbar-meta run-filter-bar-meta">
              {filtered.length === runs.length
                ? `共 ${runs.length} 条`
                : `匹配 ${filtered.length} / ${runs.length} 条`}
            </span>
          </div>
        </div>
      </section>

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
                  尚无执行记录，请前往左侧「套件执行」(Alt+5) 运行用例。
                </td>
              </tr>
            )}
            {runs.length > 0 && !filtered.length && (
              <tr>
                <td colSpan={6} className="run-history-empty">
                  {projectFilter
                    ? `当前项目「${resolveProjectName(projectFilter)}」无匹配记录。可点「重置筛选」或项目选「不限」。`
                    : "无匹配结果，请调整筛选或搜索条件。"}
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