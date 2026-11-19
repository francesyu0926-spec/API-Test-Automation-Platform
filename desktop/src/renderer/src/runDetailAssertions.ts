export type RunAssertion = {
  ok?: boolean;
  name?: string;
  message?: string;
  type?: string;
  expected?: number;
  actual?: number;
  max?: number;
  text?: string;
  error?: string;
};

export type AssertionExprPart =
  | { kind: "actual"; text: string }
  | { kind: "plain"; text: string };

export function formatRunAssertion(a: RunAssertion): { key: string; expr: string } {
  const { key, parts } = formatRunAssertionParts(a);
  if (parts.length === 0) return { key, expr: "" };
  return { key, expr: parts.map((p) => p.text).join("") };
}

const ASSERTION_LABELS: Record<string, string> = {
  status: "状态码",
  duration_ms: "耗时",
  body_contains: "正文包含",
  error: "执行错误",
};

export function assertionRowLabels(typeOrName?: string): { short: string; long: string } {
  const key = typeOrName ?? "断言";
  const short = ASSERTION_LABELS[key] ?? key;
  return { short, long: key === short ? key : `${short} (${key})` };
}

/** 表格展示：期望 / 实际分列 */
export function assertionTableCells(a: RunAssertion): {
  label: string;
  expect: string;
  actual: string;
} {
  const { long } = assertionRowLabels(a.type ?? a.name);
  if (a.type === "status" || a.name === "status") {
    return {
      label: long,
      expect: String(a.expected ?? "—"),
      actual: String(a.actual ?? "—"),
    };
  }
  if (a.type === "duration_ms" || a.name === "duration_ms") {
    const act =
      typeof a.actual === "number" ? `${Math.round(a.actual)} ms` : String(a.actual ?? "—");
    const max = a.max != null ? `< ${a.max} ms` : "—";
    return { label: long, expect: max, actual: act };
  }
  if ((a.type === "body_contains" || a.name === "body_contains") && a.text) {
    return { label: long, expect: `包含「${a.text}」`, actual: a.ok ? "匹配" : "未匹配" };
  }
  const { key, parts } = formatRunAssertionParts(a);
  const expr = parts.map((p) => p.text).join("");
  return {
    label: assertionRowLabels(key).long,
    expect: "—",
    actual: a.message ?? a.error ?? (expr || (a.ok ? "通过" : "失败")),
  };
}

export function formatRunAssertionParts(a: RunAssertion): { key: string; parts: AssertionExprPart[] } {
  const key = a.type ?? a.name ?? "断言";
  if (key === "status") {
    const exp = String(a.expected ?? "?");
    const act = String(a.actual ?? "?");
    return {
      key,
      parts: [
        { kind: "actual", text: act },
        { kind: "plain", text: " == " },
        { kind: "plain", text: exp },
      ],
    };
  }
  if (key === "duration_ms") {
    const act =
      typeof a.actual === "number" ? String(Math.round(a.actual)) : String(a.actual ?? "?");
    const max = String(a.max ?? "?");
    return {
      key,
      parts: [
        { kind: "actual", text: act },
        { kind: "plain", text: ` ≤ ${max} ms` },
      ],
    };
  }
  if (key === "body_contains" && a.text) {
    return { key, parts: [{ kind: "plain", text: `包含「${a.text}」` }] };
  }
  if (a.message) return { key, parts: [{ kind: "plain", text: a.message }] };
  if (a.error) return { key, parts: [{ kind: "plain", text: a.error }] };
  return { key, parts: [] };
}