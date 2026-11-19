import { useEffect, useMemo, useState } from "react";

import AppCustomSelect from "./AppCustomSelect";
import type { SuiteRunTarget } from "./resolveSuiteRunTargets";

type Project = { id: string; name: string };

type Props = {
  projects: Project[];
  selectedProject: string;
  onProject: (v: string) => void;
  suite: string;
  env: string;
  assets: { environments: string[]; suites: string[]; cases: string[] } | null;
  onSuite: (v: string) => void;
  onEnv: (v: string) => void;
  running: boolean;
  reloadKey?: number;
  onRun: (targets: SuiteRunTarget[]) => void;
  onImportOpenApi?: () => void;
};

export default function RunSuitePanel({
  projects,
  selectedProject,
  onProject,
  suite,
  env,
  assets,
  onSuite,
  onEnv,
  running,
  reloadKey = 0,
  onRun,
  onImportOpenApi,
}: Props) {
  const [targets, setTargets] = useState<SuiteRunTarget[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [casesLoading, setCasesLoading] = useState(false);

  useEffect(() => {
    if (!selectedProject || !suite) {
      setTargets([]);
      setSelectedKeys(new Set());
      return;
    }
    let cancelled = false;
    setCasesLoading(true);
    void (async () => {
      const doc = await window.atp.listSuiteRunTargets(selectedProject, suite);
      if (cancelled) return;
      setTargets(doc.targets);
      setSelectedKeys(new Set(doc.targets.map((t) => t.key)));
      setCasesLoading(false);
    })();
    return () => {
      cancelled = true;
      setCasesLoading(false);
    };
  }, [selectedProject, suite, reloadKey]);

  const allChecked = targets.length > 0 && targets.every((t) => selectedKeys.has(t.key));
  const selectedCount = useMemo(
    () => targets.filter((t) => selectedKeys.has(t.key)).length,
    [targets, selectedKeys],
  );
  const hasCollectionOnly = targets.some((t) => t.kind === "collection");

  const toggleTarget = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedKeys(checked ? new Set(targets.map((t) => t.key)) : new Set());
  };

  const runLabel =
    selectedCount === 0
      ? "运行套件"
      : selectedCount === targets.length
        ? "运行套件"
        : `运行所选（${selectedCount}）`;

  const selectedTargets = targets.filter((t) => selectedKeys.has(t.key));

  return (
    <div className="run-suite-panel">
      <div className="toolbar run-suite-toolbar">
        <AppCustomSelect
          className="run-suite-toolbar-picker"
          variant="control"
          value={selectedProject}
          ariaLabel="项目"
          disabled={!projects.length}
          placeholder={!projects.length ? "暂无项目" : undefined}
          options={projects.map((p) => ({ value: p.id, label: p.name, title: p.name }))}
          onChange={onProject}
        />
        <AppCustomSelect
          className="run-suite-toolbar-picker"
          variant="control"
          value={suite}
          ariaLabel="套件"
          options={(assets?.suites ?? [suite]).map((s) => ({ value: s, label: s }))}
          onChange={onSuite}
        />
        <AppCustomSelect
          className="run-suite-toolbar-picker"
          variant="control"
          value={env}
          ariaLabel="环境"
          options={(assets?.environments ?? [env]).map((name) => ({ value: name, label: name }))}
          onChange={onEnv}
        />
        {onImportOpenApi ? (
          <button
            type="button"
            className="nav-btn"
            disabled={running}
            onClick={onImportOpenApi}
          >
            OpenAPI 导入
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={running || !selectedProject || !selectedCount || casesLoading}
          onClick={() => onRun(selectedTargets)}
        >
          {running ? "执行中…" : runLabel}
        </button>
      </div>

      <section className="run-suite-cases" aria-live="polite">
        <div className="run-suite-cases-head">
          <span className="run-suite-cases-title">套件用例</span>
          {casesLoading ? <span className="hint">加载中…</span> : null}
          {!casesLoading && targets.length > 0 ? (
            <span className="hint">
              已选 {selectedCount} / {targets.length}
            </span>
          ) : null}
        </div>
        {!casesLoading && !targets.length ? (
          <p className="run-suite-cases-empty">
            套件内无 YAML 用例，集合中也没有请求。请在「项目与用例」或工作台中创建请求。
          </p>
        ) : null}
        {hasCollectionOnly && !casesLoading ? (
          <p className="run-suite-cases-hint hint">
            标有「集合」的请求尚未写入 cases；运行时会自动保存为用例并加入当前套件。
          </p>
        ) : null}
        {targets.length > 0 ? (
          <div className="run-suite-cases-list" role="group" aria-label="选择要执行的用例">
            <label className="run-suite-case run-suite-case--all">
              <input
                type="checkbox"
                checked={allChecked}
                aria-checked={allChecked ? true : selectedCount > 0 ? "mixed" : false}
                disabled={running || casesLoading}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              <span>全选</span>
            </label>
            {targets.map((row) => (
              <label
                key={row.key}
                className={`run-suite-case${row.kind === "collection" ? " run-suite-case--collection" : ""}`}
                title={row.kind === "case" ? row.id : `${row.collectionId} / ${row.requestId}`}
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(row.key)}
                  disabled={running || casesLoading}
                  onChange={(e) => toggleTarget(row.key, e.target.checked)}
                />
                <span>{row.label}</span>
                {row.kind === "collection" ? (
                  <span className="run-suite-case-tag">集合</span>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}