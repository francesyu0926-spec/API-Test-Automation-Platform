import type { HttpSendResult, KeyValueRow, WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { emptyRow } from "./apiWorkbenchModel";

export type WorkbenchScriptTest = {
  name: string;
  passed: boolean;
  error?: string;
};

export type WorkbenchScriptRunResult = {
  ok: boolean;
  error?: string;
  logs: string[];
  tests: WorkbenchScriptTest[];
  draft: WorkbenchDraft;
  variables: Record<string, string>;
};

type ScriptPhase = "prerequest" | "test";

type ScriptContext = {
  phase: ScriptPhase;
  draft: WorkbenchDraft;
  variables: Record<string, string>;
  response: HttpSendResult | null;
};

function upsertHeaderRow(rows: KeyValueRow[], key: string, value: string): KeyValueRow[] {
  const kl = key.trim();
  let found = false;
  const next = rows.map((r) => {
    if (r.key.trim().toLowerCase() === kl.toLowerCase()) {
      found = true;
      return { ...r, key: kl, value, enabled: true };
    }
    return r;
  });
  if (!found) {
    const trimmed = next.filter((r) => r.key.trim() || r.value.trim());
    trimmed.push({ key: kl, value, enabled: true });
    return [...trimmed, emptyRow()];
  }
  return next;
}

function removeHeaderRow(rows: KeyValueRow[], key: string): KeyValueRow[] {
  const kl = key.trim().toLowerCase();
  const filtered = rows.filter((r) => r.key.trim().toLowerCase() !== kl);
  return filtered.length ? filtered : [emptyRow()];
}

function formatConsoleArg(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function buildPm(ctx: ScriptContext, logs: string[], tests: WorkbenchScriptTest[]) {
  const write = (level: "log" | "info" | "warn" | "error", args: unknown[]) => {
    const body = args.map(formatConsoleArg).join(" ");
    const prefix =
      level === "log" ? "" : level === "info" ? "[info] " : level === "warn" ? "[warn] " : "[error] ";
    logs.push(`${prefix}${body}`);
  };
  const log = (...args: unknown[]) => write("log", args);

  const expect = (actual: unknown) => ({
    to: {
      eql: (expected: unknown) => {
        if (actual !== expected) throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
      },
      equal: (expected: unknown) => {
        if (actual !== expected) throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
      },
      be: {
        oneOf: (values: unknown[]) => {
          if (!values.includes(actual)) throw new Error(`expected one of ${values.join(", ")}`);
        },
      },
    },
  });

  const variableBag = {
    get: (key: string) => ctx.variables[key],
    set: (key: string, value: string) => {
      ctx.variables[key] = String(value);
    },
    unset: (key: string) => {
      delete ctx.variables[key];
    },
  };

  const response = ctx.response;

  const pm = {
    variables: variableBag,
    environment: variableBag,
    request: {
      get url() {
        return ctx.draft.url;
      },
      set url(v: string) {
        ctx.draft.url = v;
      },
      get method() {
        return ctx.draft.method;
      },
      set method(v: string) {
        ctx.draft.method = v.toUpperCase();
      },
      get body() {
        return ctx.draft.body;
      },
      set body(v: string) {
        ctx.draft.body = v;
        if (v.trim()) ctx.draft.bodyMode = "raw";
      },
      headers: {
        add: (header: { key: string; value: string }) => {
          ctx.draft.headers = upsertHeaderRow(ctx.draft.headers, header.key, header.value);
        },
        upsert: (header: { key: string; value: string }) => {
          ctx.draft.headers = upsertHeaderRow(ctx.draft.headers, header.key, header.value);
        },
        remove: (key: string) => {
          ctx.draft.headers = removeHeaderRow(ctx.draft.headers, key);
        },
      },
    },
    response: response
      ? {
          get code() {
            return response.status;
          },
          get status() {
            return response.status;
          },
          get responseTime() {
            return response.durationMs;
          },
          json: () => {
            if (!response.bodyText?.trim()) return {};
            return JSON.parse(response.bodyText) as unknown;
          },
          text: () => response.bodyText ?? "",
        }
      : {
          get code() {
            return 0;
          },
          get status() {
            return 0;
          },
          get responseTime() {
            return 0;
          },
          json: () => ({}),
          text: () => "",
        },
    test: (name: string, fn: () => void) => {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (err) {
        tests.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    expect,
  };

  return {
    pm,
    console: {
      log,
      info: (...args: unknown[]) => write("info", args),
      warn: (...args: unknown[]) => write("warn", args),
      error: (...args: unknown[]) => write("error", args),
      debug: log,
    },
  };
}

function runScript(code: string, ctx: ScriptContext): WorkbenchScriptRunResult {
  const logs: string[] = [];
  const tests: WorkbenchScriptTest[] = [];
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: true, logs, tests, draft: ctx.draft, variables: ctx.variables };
  }
  try {
    const { pm, console } = buildPm(ctx, logs, tests);
    const runner = new Function("pm", "console", `"use strict";\n${trimmed}`);
    runner(pm, console);
    return { ok: true, logs, tests, draft: ctx.draft, variables: ctx.variables };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      logs,
      tests,
      draft: ctx.draft,
      variables: ctx.variables,
    };
  }
}

export function runPreRequestScript(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
): WorkbenchScriptRunResult {
  return runScript(draft.preRequestScript ?? "", {
    phase: "prerequest",
    draft: { ...draft, headers: [...draft.headers], query: [...draft.query] },
    variables: { ...variables },
    response: null,
  });
}

export function runTestScript(
  draft: WorkbenchDraft,
  variables: Record<string, string>,
  response: HttpSendResult,
): WorkbenchScriptRunResult {
  return runScript(draft.testScript ?? "", {
    phase: "test",
    draft,
    variables: { ...variables },
    response,
  });
}