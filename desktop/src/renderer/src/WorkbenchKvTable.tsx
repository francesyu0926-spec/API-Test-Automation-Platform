import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { KeyValueRow } from "../../shared/apiWorkbenchTypes";
import { parseKvBulk, serializeKvBulk, type KvBulkFormat } from "./workbenchKvBulk";

export type WorkbenchKvTableHandle = {
  openBulk: () => void;
  closeBulk: () => void;
  isBulkOpen: () => boolean;
};

type WorkbenchKvTableProps = {
  rows: KeyValueRow[];
  bulkFormat: KvBulkFormat;
  onChange: (index: number, patch: Partial<KeyValueRow>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onReplaceAll: (rows: KeyValueRow[]) => void;
  onReorder: (from: number, to: number) => void;
  onBulkOpenChange?: (open: boolean) => void;
};

const WorkbenchKvTable = forwardRef<WorkbenchKvTableHandle, WorkbenchKvTableProps>(function WorkbenchKvTable(
  {
    rows,
    bulkFormat,
    onChange,
    onAdd,
    onRemove,
    onReplaceAll,
    onReorder,
    onBulkOpenChange,
  },
  ref,
) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const keyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const valueRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocusKey = useRef<number | null>(null);

  const setBulkOpenState = (open: boolean) => {
    setBulkOpen(open);
    onBulkOpenChange?.(open);
  };

  const openBulk = () => {
    setBulkText(serializeKvBulk(rows, bulkFormat));
    setBulkOpenState(true);
  };

  const closeBulk = () => setBulkOpenState(false);

  useImperativeHandle(ref, () => ({
    openBulk,
    closeBulk,
    isBulkOpen: () => bulkOpen,
  }));

  const applyBulk = () => {
    const next = parseKvBulk(bulkText, bulkFormat);
    onReplaceAll(next);
    setBulkOpenState(false);
  };

  const focusKeyAt = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      keyRefs.current[index]?.focus();
    });
  }, []);

  useEffect(() => {
    if (pendingFocusKey.current != null) {
      const i = pendingFocusKey.current;
      pendingFocusKey.current = null;
      focusKeyAt(i);
    }
  }, [rows.length, focusKeyAt]);

  const onKeyEnter = (index: number) => {
    valueRefs.current[index]?.focus();
  };

  const onValueEnter = (index: number) => {
    if (index === rows.length - 1) {
      onAdd();
      pendingFocusKey.current = rows.length;
    } else {
      focusKeyAt(index + 1);
    }
  };

  const onDropRow = (to: number) => {
    if (dragFrom == null || dragFrom === to) {
      setDragFrom(null);
      return;
    }
    onReorder(dragFrom, to);
    setDragFrom(null);
  };

  if (bulkOpen) {
    return (
      <div className="workbench-kv workbench-kv--bulk">
        <div className="workbench-kv-bulk-bar">
          <span className="workbench-kv-bulk-hint">
            {bulkFormat === "query"
              ? "支持 key=value&key2=value2，或每行 key=value"
              : "支持 JSON 对象 { \"key\": \"value\" }"}
          </span>
          <div className="workbench-kv-bulk-actions">
            <button type="button" className="nav-btn workbench-kv-bulk-cancel" onClick={closeBulk}>
              返回表格
            </button>
            <button type="button" className="nav-btn primary workbench-kv-bulk-apply" onClick={applyBulk}>
              应用到表格
            </button>
          </div>
        </div>
        <textarea
          className="text-input workbench-kv-bulk-textarea"
          value={bulkText}
          spellCheck={false}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={
            bulkFormat === "query" ? "page=1&size=20" : '{\n  "Authorization": "Bearer xxx"\n}'
          }
        />
      </div>
    );
  }

  return (
    <div className="workbench-kv">
      <div className="workbench-kv-table" role="table">
        <div className="workbench-kv-row workbench-kv-row--head" role="row">
          <span className="workbench-kv-col workbench-kv-col--drag" aria-hidden />
          <span className="workbench-kv-col workbench-kv-col--check" aria-hidden />
          <span className="workbench-kv-col workbench-kv-col--key">Key</span>
          <span className="workbench-kv-col workbench-kv-col--value">Value</span>
          <span className="workbench-kv-col workbench-kv-col--actions" aria-hidden />
        </div>
        {rows.map((row, i) => (
          <div
            key={`kv-row-${i}`}
            className={`workbench-kv-row${dragFrom === i ? " is-dragging" : ""}`}
            role="row"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDropRow(i);
            }}
          >
            <span
              className="workbench-kv-col workbench-kv-col--drag workbench-kv-drag"
              draggable
              title="拖拽排序"
              aria-label="拖拽排序"
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => setDragFrom(null)}
            >
              <span className="workbench-kv-drag-grip" aria-hidden />
            </span>
            <span className="workbench-kv-col workbench-kv-col--check">
              <input
                type="checkbox"
                className="workbench-kv-checkbox capture-session-checkbox"
                checked={row.enabled}
                aria-label={`启用参数 ${i + 1}`}
                onChange={(e) => onChange(i, { enabled: e.target.checked })}
              />
            </span>
            <span className="workbench-kv-col workbench-kv-col--key">
              <input
                ref={(el) => {
                  keyRefs.current[i] = el;
                }}
                className="text-input workbench-kv-cell-input"
                value={row.key}
                placeholder="Key"
                onChange={(e) => onChange(i, { key: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onKeyEnter(i);
                  }
                }}
              />
            </span>
            <span className="workbench-kv-col workbench-kv-col--value">
              <input
                ref={(el) => {
                  valueRefs.current[i] = el;
                }}
                className="text-input workbench-kv-cell-input"
                value={row.value}
                placeholder="Value"
                onChange={(e) => onChange(i, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onValueEnter(i);
                  }
                }}
              />
            </span>
            <span className="workbench-kv-col workbench-kv-col--actions">
              <button
                type="button"
                className="workbench-kv-row-del"
                title="删除行"
                aria-label={`删除第 ${i + 1} 行`}
                disabled={rows.length <= 1}
                onClick={() => onRemove(i)}
              >
                <span aria-hidden>🗑</span>
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="workbench-kv-footer">
        <button type="button" className="workbench-kv-add-link" onClick={onAdd}>
          + 添加一行
        </button>
        <button
          type="button"
          className="workbench-kv-bulk-ghost"
          onClick={() => (bulkOpen ? closeBulk() : openBulk())}
        >
          {bulkOpen ? "返回表格" : "⇌ 批量编辑"}
        </button>
      </div>
    </div>
  );
});

export default WorkbenchKvTable;