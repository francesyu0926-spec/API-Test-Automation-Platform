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