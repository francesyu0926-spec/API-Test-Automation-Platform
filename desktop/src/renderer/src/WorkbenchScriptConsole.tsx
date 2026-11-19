import { useMemo, useState } from "react";

import CaptureCodeBlock from "./CaptureCodeBlock";
import JsonResponseView from "./JsonResponseView";
import { parseScriptLogLine } from "./workbenchConsoleLog";

type LogMode = "visual" | "json";

function ConsoleLogEntry({ line }: { line: string }) {
  const parsed = useMemo(() => parseScriptLogLine(line), [line]);
  const [mode, setMode] = useState<LogMode>("visual");
  const hasJson = parsed.payload !== undefined && parsed.payloadText;

  const jsonDisplay = useMemo(() => {
    if (!hasJson) return "";
    try {
      return JSON.stringify(parsed.payload, null, 2);
    } catch {
      return parsed.payloadText ?? "";
    }
  }, [hasJson, parsed.payload, parsed.payloadText]);

  return (
    <li className="workbench-script-console-entry">
      <div className="workbench-script-console-entry-head">
        {parsed.phase ? (
          <span className="workbench-script-console-phase">{parsed.phase}</span>
        ) : null}
        {parsed.label && !hasJson ? (
          <span className="workbench-script-console-entry-label">{parsed.label}</span>
        ) : null}
        {parsed.label && hasJson ? (
          <span className="workbench-script-console-entry-label">{parsed.label}</span>
        ) : null}
        {hasJson ? (
          <div className="workbench-segmented workbench-script-console-mode" role="tablist" aria-label="输出视图">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "visual"}
              className={`workbench-segmented-btn${mode === "visual" ? " active" : ""}`}
              onClick={() => setMode("visual")}
            >
              可视化
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "json"}
              className={`workbench-segmented-btn${mode === "json" ? " active" : ""}`}
              onClick={() => setMode("json")}
            >
              JSON
            </button>
          </div>
        ) : null}
      </div>
      {hasJson ? (
        mode === "visual" ? (
          <JsonResponseView
            data={parsed.payload}
            className="workbench-script-console-visual"
            enableRowSelection={false}
            enableColumnResize={false}
          />
        ) : (
          <CaptureCodeBlock
            fullText={jsonDisplay}
            language="json"
            hideToolbar
            jsonPretty
            maxHeight="min(240px, 32vh)"
            ariaLabel="Console JSON"
            className="workbench-script-console-json-block"
          />
        )
      ) : (
        <pre className="workbench-script-console-plain">{parsed.plain}</pre>
      )}
    </li>
  );
}

type Props = {
  lines: string[];
};

export default function WorkbenchScriptConsole({ lines }: Props) {
  if (!lines.length) return null;
  return (
    <div className="workbench-script-console-block">
      <p className="workbench-script-console-title">Console</p>
      <ul className="workbench-script-console-entries">
        {lines.map((line, i) => (
          <ConsoleLogEntry key={`${i}:${line.slice(0, 24)}`} line={line} />
        ))}
      </ul>
    </div>
  );
}