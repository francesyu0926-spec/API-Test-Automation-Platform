export type ParsedScriptLog = {
  phase?: "Pre-request" | "Tests";
  label?: string;
  payload?: unknown;
  payloadText?: string;
  plain: string;
};

export function parseScriptLogLine(line: string): ParsedScriptLog {
  const phaseM = line.match(/^\[(Pre-request|Tests)\]\s*(.*)$/s);
  const phase = phaseM ? (phaseM[1] as ParsedScriptLog["phase"]) : undefined;
  const rest = phaseM ? phaseM[2] : line;

  const jsonIdx = rest.search(/[{[]/);
  if (jsonIdx >= 0) {
    const label = rest.slice(0, jsonIdx).trim() || undefined;
    const candidate = rest.slice(jsonIdx).trim();
    try {
      return { phase, label, payload: JSON.parse(candidate), payloadText: candidate, plain: line };
    } catch {
      /* fall through */
    }
  }

  const trimmed = rest.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { phase, payload: JSON.parse(trimmed), payloadText: trimmed, plain: line };
    } catch {
      /* fall through */
    }
  }

  return { phase, label: rest.trim() || undefined, plain: line };
}