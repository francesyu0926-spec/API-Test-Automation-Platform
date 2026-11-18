import { useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";

import type { JtlSample } from "../../shared/jtl";

const ROW_HEIGHT = 38;
const VIEWPORT_HEIGHT = 420;
const VIRTUAL_MIN_ROWS = 48;

type Props = {
  rows: JtlSample[];
  totalRows?: number;
};

function Row({ index, style, data }: ListChildComponentProps<JtlSample[]>) {
  const s = data[index];
  const ok = s.success;
  return (
    <div
      style={style}
      className={`virtual-sample-row${ok ? "" : " virtual-sample-row--fail"}`}
      title={s.label}
    >
      <span className="virtual-sample-cell virtual-sample-cell--idx">{index + 1}</span>
      <span className={`virtual-sample-cell virtual-sample-cell--badge${ok ? " ok" : " err"}`}>
        {ok ? "成功" : "失败"}
      </span>
      <span className="virtual-sample-cell virtual-sample-cell--code">{s.responseCode || "—"}</span>
      <span className="virtual-sample-cell virtual-sample-cell--ms">{s.elapsed} ms</span>
      <span className="virtual-sample-cell virtual-sample-cell--label">{s.label}</span>
    </div>
  );
}

export default function JtlSampleVirtualTable({ rows, totalRows }: Props) {
  const useVirtual = rows.length >= VIRTUAL_MIN_ROWS;
  const height = Math.min(VIEWPORT_HEIGHT, Math.max(ROW_HEIGHT * 6, rows.length * ROW_HEIGHT));

  const header = (
    <div className="virtual-sample-head" role="row">
      <span className="virtual-sample-cell virtual-sample-cell--idx">#</span>
      <span className="virtual-sample-cell virtual-sample-cell--badge">结果</span>
      <span className="virtual-sample-cell virtual-sample-cell--code">状态</span>
      <span className="virtual-sample-cell virtual-sample-cell--ms">耗时</span>
      <span className="virtual-sample-cell virtual-sample-cell--label">标签</span>
    </div>
  );

  const footnote = useMemo(() => {
    if (!totalRows || totalRows <= rows.length) return null;
    return `预览 ${rows.length} / ${totalRows} 条（虚拟滚动渲染，未展开全部 DOM）`;
  }, [rows.length, totalRows]);

  if (!rows.length) return null;

  return (
    <section className="loadtest-samples-card jtl-preview-samples" aria-labelledby="jtl-preview-samples-title">
      <header className="loadtest-samples-head">
        <div>
          <h4 id="jtl-preview-samples-title" className="loadtest-samples-title">
            JTL 样本预览
          </h4>
          {footnote ? <p className="hint">{footnote}</p> : null}
        </div>
      </header>
      <div className="virtual-sample-table">
        {header}
        {useVirtual ? (
          <FixedSizeList
            className="virtual-sample-list"
            height={height}
            width="100%"
            itemCount={rows.length}
            itemSize={ROW_HEIGHT}
            itemData={rows}
            overscanCount={8}
          >
            {Row}
          </FixedSizeList>
        ) : (
          <div className="virtual-sample-static">
            {rows.map((s, i) => {
              const ok = s.success;
              return (
                <div
                  key={`${s.timeStamp}-${i}`}
                  className={`virtual-sample-row${ok ? "" : " virtual-sample-row--fail"}`}
                  title={s.label}
                >
                  <span className="virtual-sample-cell virtual-sample-cell--idx">{i + 1}</span>
                  <span className={`virtual-sample-cell virtual-sample-cell--badge${ok ? " ok" : " err"}`}>
                    {ok ? "成功" : "失败"}
                  </span>
                  <span className="virtual-sample-cell virtual-sample-cell--code">{s.responseCode || "—"}</span>
                  <span className="virtual-sample-cell virtual-sample-cell--ms">{s.elapsed} ms</span>
                  <span className="virtual-sample-cell virtual-sample-cell--label">{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}