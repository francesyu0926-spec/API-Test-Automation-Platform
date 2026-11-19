import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import {
  JSON_DATA_COL_DEFAULT_PX,
  startJsonColumnResize,
} from "./jsonVisColumnResize";

import {
  MAX_TABLE_ROWS,
  buildVisualSections,
  collectFlatColumns,
  complexSummary,
  formatJsonPrimitive,
  getAtPath,
  inferColumnCellKind,
  isArrayOfRecords,
  isPrimitive,
  isRecord,
  rowRecords,
  type VisualSection,
} from "./jsonVisualModel";
import {
  clearSectionSelection,
  countSelectedRows,
  sectionExportKey,
  setSelectionAll,
  toggleSelectionRow,
  type VisualRowSelection,
} from "./jsonVisualSelection";
import JsonVisualDetailDrawer from "./JsonVisualDetailDrawer";

type JsonVisualFeatures = {
  enableRowSelection: boolean;
  enableColumnResize: boolean;
};

const defaultJsonVisualFeatures: JsonVisualFeatures = {
  enableRowSelection: true,
  enableColumnResize: true,
};

const JsonVisualFeaturesContext = createContext<JsonVisualFeatures>(defaultJsonVisualFeatures);

function useJsonVisualFeatures(): JsonVisualFeatures {
  return useContext(JsonVisualFeaturesContext);
}

function JsonKeyValueTable({
  title,
  entries,
  nested = false,
  sectionKey,
  selection,
  onToggleRow,
  onToggleAll,
}: {
  title?: string;
  entries: Array<[string, unknown]>;
  nested?: boolean;
  sectionKey?: string;
  selection?: VisualRowSelection;
  onToggleRow?: (index: number) => void;
  onToggleAll?: (all: boolean) => void;
}) {
  const [detailDrawer, setDetailDrawer] = useState<{ title: string; value: unknown } | null>(null);
  const selectable = Boolean(sectionKey && onToggleRow && onToggleAll);
  const selected = new Set(sectionKey ? (selection?.[sectionKey] ?? []) : []);
  const allChecked = selectable && entries.length > 0 && selected.size === entries.length;

  return (
    <section className={`json-vis-section${nested ? " json-vis-section--nested" : ""}`}>
      {title ? <h4 className="json-vis-section-title">{title}</h4> : null}
      <table
        className={`json-vis-table json-vis-table--kv${nested ? " json-vis-table--kv-nested" : ""}`}
      >
        {!nested ? (
          <thead>
            <tr>
              {selectable ? (
                <th className="json-vis-table-sel" scope="col" aria-label="全选">
                  <input
                    type="checkbox"
                    className="workbench-kv-checkbox capture-session-checkbox"
                    checked={allChecked}
                    title="全选本表（含未显示行）"
                    onChange={(e) => onToggleAll!(e.target.checked)}
                  />
                </th>
              ) : null}
              <th>字段</th>
              <th>值</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {entries.map(([key, value], i) => (
            <tr key={key} className={selected.has(i) ? "json-vis-row--selected" : ""}>
              {selectable ? (
                <td className="json-vis-table-sel">
                  <input
                    type="checkbox"
                    className="workbench-kv-checkbox capture-session-checkbox"
                    checked={selected.has(i)}
                    onChange={() => onToggleRow!(i)}
                    aria-label={`选择字段 ${key}`}
                  />
                </td>
              ) : null}
              <td className="json-vis-kv-key">{key}</td>
              <td className="json-vis-kv-val">
                <JsonCellValue
                  value={value}
                  rowKey={`kv-${key}`}
                  detailMode="drawer"
                  onOpenDrawer={(val, label) =>
                    setDetailDrawer({ value: val, title: `${key} · ${label}` })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detailDrawer ? (
        <JsonVisualDetailDrawer title={detailDrawer.title} onClose={() => setDetailDrawer(null)}>
          <JsonNestedValue value={detailDrawer.value} />
        </JsonVisualDetailDrawer>
      ) : null}
    </section>
  );
}

function JsonPrimitiveListTable({
  title,
  rows,
  nested = false,
  sectionKey,
  selection,
  onToggleRow,
  onToggleAll,
}: {
  title: string;
  rows: unknown[];
  nested?: boolean;
  sectionKey?: string;
  selection?: VisualRowSelection;
  onToggleRow?: (index: number) => void;
  onToggleAll?: (all: boolean) => void;
}) {
  const display = rows.slice(0, MAX_TABLE_ROWS);
  const truncated = rows.length > MAX_TABLE_ROWS;
  const selectable = Boolean(sectionKey && onToggleRow && onToggleAll);
  const selected = new Set(sectionKey ? (selection?.[sectionKey] ?? []) : []);
  const allChecked = selectable && rows.length > 0 && selected.size === rows.length;

  return (
    <section className={`json-vis-section${nested ? " json-vis-section--nested" : ""}`}>
      <h4 className="json-vis-section-title">{title}</h4>
      {truncated ? (
        <p className="hint json-vis-table-hint">
          界面显示前 {MAX_TABLE_ROWS} 行，共 {rows.length} 行
          {selectable ? (
            <>
              {" "}
              · XLSX 可<strong>全部/所选</strong>；PNG 仅<strong>所选≤20</strong>
            </>
          ) : null}
        </p>
      ) : null}
      <table className={`json-vis-table${nested ? " json-vis-table--list-nested" : ""}`}>
        {!nested ? (
          <thead>
            <tr>
              {selectable ? (
                <th className="json-vis-table-sel" scope="col" aria-label="全选">
                  <input
                    type="checkbox"
                    className="workbench-kv-checkbox capture-session-checkbox"
                    checked={allChecked}
                    title={`全选本表全部 ${rows.length} 行`}
                    onChange={(e) => onToggleAll!(e.target.checked)}
                  />
                </th>
              ) : null}
              <th className="json-vis-table-idx">序</th>
              <th>值</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {display.map((v, i) => (
            <tr key={i} className={selected.has(i) ? "json-vis-row--selected" : ""}>
              {selectable ? (
                <td className="json-vis-table-sel">
                  <input
                    type="checkbox"
                    className="workbench-kv-checkbox capture-session-checkbox"
                    checked={selected.has(i)}
                    onChange={() => onToggleRow!(i)}
                  />
                </td>
              ) : null}
              <td className="json-vis-table-idx">{i + 1}</td>
              <td>
                <JsonCellValue value={v} rowKey={`${title}-${i}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type ExpandState = Record<string, boolean>;

function JsonCellValue({
  value,
  rowKey,
  expandState,
  onToggle,
  detailMode = "inline",
  onOpenDrawer,
}: {
  value: unknown;
  rowKey: string;
  expandState?: ExpandState;
  onToggle?: (id: string) => void;
  detailMode?: "inline" | "drawer";
  onOpenDrawer?: (value: unknown, label: string) => void;
}) {
  const complex = value !== null && typeof value === "object";
  if (!complex) {
    const type =
      value === null
        ? "null"
        : typeof value === "boolean"
          ? value
            ? "boolean-true"
            : "boolean-false"
          : typeof value === "string"
            ? "string"
            : typeof value === "number"
              ? "number"
              : "boolean";
    const display = value === null ? "null" : typeof value === "string" ? value : formatJsonPrimitive(value);
    return (
      <span className={`json-vis-val json-vis-val--${type}`} title={display}>
        {typeof value === "string" && display.length > 120 ? `${display.slice(0, 120)}…` : display}
      </span>
    );
  }

  const cellId = `cell-${rowKey}`;
  const expanded = expandState?.[cellId] ?? false;
  const summary = complexSummary(value);
  const useDrawer = detailMode === "drawer" && Boolean(onOpenDrawer);
  const canExpandInline = onToggle != null && !useDrawer;

  return (
    <div className="json-vis-cell-complex">
      {useDrawer || canExpandInline ? (
        <button
          type="button"
          className="json-vis-expand-btn"
          aria-expanded={useDrawer ? undefined : expanded}
          aria-haspopup={useDrawer ? "dialog" : undefined}
          onClick={() =>
            useDrawer ? onOpenDrawer!(value, summary) : onToggle!(cellId)
          }
        >
          <span className="json-vis-chevron" aria-hidden>
            {useDrawer || !expanded ? "▸" : "▾"}
          </span>
          {summary}
        </button>
      ) : (
        <code className="json-vis-table-nested">{summary}</code>
      )}
      {expanded && canExpandInline ? (
        <div className="json-vis-cell-nested">
          <JsonNestedValue value={value} />
        </div>
      ) : null}
    </div>
  );
}

function JsonNestedValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (isArrayOfRecords(value)) return <JsonRecordTable title="" rows={value} nested />;
    return <JsonPrimitiveListTable title="数组" rows={value} nested />;
  }
  if (isRecord(value)) {
    const sections = buildVisualSections(value);
    return (
      <JsonSectionStack sections={sections} nested selection={{}} onSelectionChange={() => {}} />
    );
  }
  return <span className="json-vis-val">{formatJsonPrimitive(value)}</span>;
}

function JsonRecordTable({
  title,
  rows,
  nested = false,
  sectionKey,
  selection,
  onToggleRow,
  onToggleAll,
}: {
  title: string;
  rows: Record<string, unknown>[];
  nested?: boolean;
  sectionKey?: string;
  selection?: VisualRowSelection;
  onToggleRow?: (index: number) => void;
  onToggleAll?: (all: boolean) => void;
}) {
  const [detailDrawer, setDetailDrawer] = useState<{ title: string; value: unknown } | null>(null);
  const { enableColumnResize } = useJsonVisualFeatures();
  const columns = useMemo(() => collectFlatColumns(rows), [rows]);
  const columnSig = useMemo(() => columns.map((c) => c.path).join("\0"), [columns]);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const displayRows = rows.slice(0, MAX_TABLE_ROWS);
  const truncated = rows.length > MAX_TABLE_ROWS;
  const selectable = Boolean(sectionKey && onToggleRow && onToggleAll);
  const selected = new Set(sectionKey ? (selection?.[sectionKey] ?? []) : []);
  const allChecked = selectable && rows.length > 0 && selected.size === rows.length;

  useEffect(() => {
    setColWidths({});
  }, [columnSig]);

  const colWidth = (path: string) => colWidths[path] ?? JSON_DATA_COL_DEFAULT_PX;

  return (
    <section className={`json-vis-section${nested ? " json-vis-section--nested" : ""}`}>
      {title ? <h4 className="json-vis-section-title">{title}</h4> : null}
      {truncated ? (
        <p className="hint json-vis-table-hint">
          界面显示前 {MAX_TABLE_ROWS} 行，共 {rows.length} 行
          {selectable ? (
            <>
              {" "}
              · XLSX 可<strong>全部/所选</strong>；PNG 仅<strong>所选≤20</strong>
            </>
          ) : null}
        </p>
      ) : null}
      <table
        className={`json-vis-table json-vis-table--data${
          enableColumnResize ? " json-vis-table--resizable-cols" : ""
        }`}
      >
        <colgroup>
          {selectable ? <col className="json-vis-table-sel" /> : null}
          <col className="json-vis-table-idx" />
          {columns.map((col) => (
            <col key={col.path} style={{ width: colWidth(col.path) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selectable ? (
              <th className="json-vis-table-sel" scope="col" aria-label="全选">
                <input
                  type="checkbox"
                  className="workbench-kv-checkbox capture-session-checkbox"
                  checked={allChecked}
                  title={`全选本表全部 ${rows.length} 行`}
                  onChange={(e) => onToggleAll!(e.target.checked)}
                />
              </th>
            ) : null}
            <th className="json-vis-table-idx">序</th>
            {columns.map((col) => {
              const w = colWidth(col.path);
              const kind = inferColumnCellKind(rows, col.path);
              return (
                <th
                  key={col.path}
                  className={`json-vis-col--${kind}${enableColumnResize ? " json-vis-th--resizable" : ""}`}
                  style={enableColumnResize ? { width: w, minWidth: w, maxWidth: w } : undefined}
                  title={col.header}
                >
                  <span className="json-vis-th-label">{col.header}</span>
                  {enableColumnResize ? (
                    <span
                      className="json-vis-col-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整列宽 ${col.header}`}
                      onMouseDown={(e) =>
                        startJsonColumnResize(e, w, (next) =>
                          setColWidths((prev) => ({ ...prev, [col.path]: next })),
                        )
                      }
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i} className={selected.has(i) ? "json-vis-row--selected" : ""}>
              {selectable ? (
                <td className="json-vis-table-sel">
                  <input
                    type="checkbox"
                    className="workbench-kv-checkbox capture-session-checkbox"
                    checked={selected.has(i)}
                    onChange={() => onToggleRow!(i)}
                  />
                </td>
              ) : null}
              <td className="json-vis-table-idx">{i + 1}</td>
              {columns.map((col) => {
                const cell = getAtPath(row, col.path);
                const w = enableColumnResize ? colWidth(col.path) : undefined;
                const kind = inferColumnCellKind(rows, col.path);
                return (
                  <td
                    key={col.path}
                    className={`json-vis-col--${kind}`}
                    style={w != null ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    title={
                      cell !== null && cell !== undefined && typeof cell !== "object"
                        ? String(cell)
                        : undefined
                    }
                  >
                    <JsonCellValue
                      value={cell}
                      rowKey={`${title}-${i}-${col.path}`}
                      detailMode="drawer"
                      onOpenDrawer={(val, label) => setDetailDrawer({ value: val, title: label })}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {detailDrawer ? (
        <JsonVisualDetailDrawer title={detailDrawer.title} onClose={() => setDetailDrawer(null)}>
          <JsonNestedValue value={detailDrawer.value} />
        </JsonVisualDetailDrawer>
      ) : null}
    </section>
  );
}

function JsonArraySection({
  title,
  rows,
  nested = false,
  sectionKey,
  selection,
  onToggleRow,
  onToggleAll,
}: {
  title: string;
  rows: unknown[];
  nested?: boolean;
  sectionKey?: string;
  selection?: VisualRowSelection;
  onToggleRow?: (index: number) => void;
  onToggleAll?: (all: boolean) => void;
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return (
      <section className="json-vis-section">
        <h4 className="json-vis-section-title">{title}</h4>
        <p className="hint json-vis-table-hint">（空数组）</p>
      </section>
    );
  }

  if (isArrayOfRecords(safeRows)) {
    return (
      <JsonRecordTable
        title={title}
        rows={safeRows}
        nested={nested}
        sectionKey={sectionKey}
        selection={selection}
        onToggleRow={onToggleRow}
        onToggleAll={(all) => onToggleAll(all)}
      />
    );
  }

  const records = rowRecords(safeRows);
  if (records.length >= Math.ceil(safeRows.length * 0.5)) {
    return (
      <JsonRecordTable
        title={title}
        rows={records}
        nested={nested}
        sectionKey={sectionKey}
        selection={selection}
        onToggleRow={onToggleRow}
        onToggleAll={onToggleAll}
      />
    );
  }

  return (
    <JsonPrimitiveListTable
      title={title}
      rows={safeRows}
      nested={nested}
      sectionKey={sectionKey}
      selection={selection}
      onToggleRow={onToggleRow}
      onToggleAll={onToggleAll}
    />
  );
}

function JsonSectionStack({
  sections,
  nested = false,
  selection,
  onSelectionChange,
}: {
  sections: VisualSection[];
  nested?: boolean;
  selection: VisualRowSelection;
  onSelectionChange: (next: VisualRowSelection) => void;
}) {
  const { enableRowSelection } = useJsonVisualFeatures();
  const bindSection = (key: string, count: number) => ({
    sectionKey: key,
    selection,
    onToggleRow: (index: number) => onSelectionChange(toggleSelectionRow(selection, key, index)),
    onToggleAll: (all: boolean) =>
      onSelectionChange(all ? setSelectionAll(selection, key, count) : clearSectionSelection(selection, key)),
  });

  return (
    <div className={`json-vis-stack${nested ? " json-vis-stack--nested" : ""}`}>
      {sections.map((sec, idx) => {
        const sectionKey = sectionExportKey(sec, idx);
        if (sec.kind === "kv") {
          return (
            <JsonKeyValueTable
              key={`kv-${idx}`}
              title={sec.title}
              entries={sec.entries}
              nested={nested}
              {...(enableRowSelection ? bindSection(sectionKey, sec.entries.length) : {})}
            />
          );
        }
        if (sec.kind === "array") {
          const rows = Array.isArray(sec.rows) ? sec.rows : [];
          return (
            <JsonArraySection
              key={`arr-${sec.title}-${idx}`}
              title={sec.title}
              rows={rows}
              nested={nested}
              {...(enableRowSelection ? bindSection(sectionKey, rows.length) : {})}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

export type JsonResponseViewHandle = {
  getSelection: () => VisualRowSelection;
  selectedCount: () => number;
  clearSelection: () => void;
};

type Props = {
  data: unknown;
  className?: string;
  /** 行勾选（工作台导出用）；执行记录等只读场景传 false */
  enableRowSelection?: boolean;
  /** 数据表列宽拖拽（默认可用） */
  enableColumnResize?: boolean;
  onSelectionChange?: (selection: VisualRowSelection) => void;
};

const JsonResponseView = forwardRef<JsonResponseViewHandle, Props>(function JsonResponseView(
  { data, className, enableRowSelection = true, enableColumnResize = true, onSelectionChange },
  ref,
) {
  const sections = useMemo(() => buildVisualSections(data), [data]);
  const [selection, setSelectionState] = useState<VisualRowSelection>({});

  const setSelection = (next: VisualRowSelection) => {
    setSelectionState(next);
    onSelectionChange?.(next);
  };

  useEffect(() => {
    setSelection({});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随响应 JSON 重置
  }, [data]);

  useImperativeHandle(
    ref,
    () => ({
      getSelection: () => selection,
      selectedCount: () => countSelectedRows(selection),
      clearSelection: () => setSelection({}),
    }),
    [selection],
  );

  const features = useMemo(
    () => ({ enableRowSelection, enableColumnResize }),
    [enableRowSelection, enableColumnResize],
  );

  return (
    <JsonVisualFeaturesContext.Provider value={features}>
      <div className={`json-vis-root json-vis-root--tables${className ? ` ${className}` : ""}`}>
        <JsonSectionStack sections={sections} selection={selection} onSelectionChange={setSelection} />
      </div>
    </JsonVisualFeaturesContext.Provider>
  );
});

export default JsonResponseView;