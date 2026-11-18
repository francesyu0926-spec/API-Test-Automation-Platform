import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { applyDefinedVariablesToDraft, substituteVars } from "../../shared/vars";
import { buildUrl, headersForSend, rowsToRecord } from "./apiWorkbenchModel";
import type { HttpSendPayload } from "../../shared/apiWorkbenchTypes";

export function resolveWorkbenchPayload(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
): HttpSendPayload {
  const method = draft.method.toUpperCase();
  const merged = applyDefinedVariablesToDraft(draft, variables);
  const resolved: WorkbenchDraft = {
    ...merged,
    url: substituteVars(merged.url, variables),
    query: merged.query.map((r) => ({
      ...r,
      value: r.enabled && r.value ? substituteVars(r.value, variables) : r.value,
    })),
    headers: merged.headers.map((h) => ({
      ...h,
      value: h.enabled && h.value ? substituteVars(h.value, variables) : h.value,
    })),
    body:
      merged.bodyMode === "raw" && merged.body ? substituteVars(merged.body, variables) : merged.body,
  };
  const url = buildUrl(resolved.url, resolved.query);
  const headers = headersForSend(resolved);
  const hasBody =
    resolved.bodyMode === "raw" && resolved.body !== "" && method !== "GET" && method !== "HEAD";
  const body = hasBody ? resolved.body : undefined;
  return { method, url, headers, body };
}

export function resolveWorkbenchWsConnect(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
): { url: string; headers: Record<string, string> } {
  const merged = applyDefinedVariablesToDraft(draft, variables);
  const resolved: WorkbenchDraft = {
    ...merged,
    url: substituteVars(merged.url, variables),
    query: merged.query.map((r) => ({
      ...r,
      value: r.enabled && r.value ? substituteVars(r.value, variables) : r.value,
    })),
    headers: merged.headers.map((h) => ({
      ...h,
      value: h.enabled && h.value ? substituteVars(h.value, variables) : h.value,
    })),
  };
  const url = buildUrl(resolved.url, resolved.query);
  const headers = rowsToRecord(
    resolved.headers.filter(
      (h) =>
        h.enabled &&
        h.key.trim() &&
        !["host", "connection", "upgrade", "sec-websocket-key", "sec-websocket-version"].includes(
          h.key.trim().toLowerCase(),
        ),
    ),
  );
  return { url, headers };
}