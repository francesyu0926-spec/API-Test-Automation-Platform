import yaml from "js-yaml";

import { buildUrl, headersForSend } from "./apiWorkbenchModel";
import { caseYamlToWorkbenchDraft } from "./caseYaml";
import type { WorkbenchDraft } from "../../shared/apiWorkbenchTypes";
import { partialSubstitute } from "../../shared/vars";

export type JmxExportOptions = {
  planName: string;
  threadGroupName: string;
  threads: number;
  rampUpSec: number;
  loops: number;
  /** 注入 environments/{env}.yaml 与 *.local.yaml 中的 token / secret 等 */
  envName: string;
  injectEnv: boolean;
};

const JMETER_ENV_KEYS = ["token", "secret", "terminalenv", "access_token", "base_url"] as const;

export type JmxCaseInput = { label: string; yaml: string };

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "&#xd;\n");
}

/** ATP 用例 {{var}} → JMeter ${var} */
export function toJmeterPropertyRefs(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, "${$1}");
}

function jmxPropertyValue(
  text: string,
  variables: Record<string, string> | undefined,
  injectEnv: boolean,
): string {
  let v = text;
  if (injectEnv && variables) {
    v = partialSubstitute(v, variables);
  }
  if (/\{\{\w+\}\}/.test(v)) {
    v = toJmeterPropertyRefs(v);
  }
  return escapeXmlText(v);
}

const AUTH_HEADER_KEYS = ["token", "secret", "terminalenv"] as const;

/** 合并用例头与环境变量，保证 token / secret 为字面量（非空 ${token}） */
function mergeAuthHeaders(
  headers: Record<string, string>,
  variables: Record<string, string> | undefined,
  injectEnv: boolean,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  for (const key of AUTH_HEADER_KEYS) {
    const existingKey = Object.keys(out).find((k) => k.toLowerCase() === key);
    let value = existingKey ? String(out[existingKey]) : "";
    if (injectEnv && variables) {
      if (value.trim()) {
        value = partialSubstitute(value, variables);
      } else if (variables[key]?.trim()) {
        value = variables[key];
      }
    } else if (/\{\{\w+\}\}/.test(value)) {
      value = toJmeterPropertyRefs(value);
    }
    if (existingKey && existingKey !== key) {
      delete out[existingKey];
    }
    if (value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

function buildUserDefinedVariablesXml(variables: Record<string, string> | undefined): string {
  if (!variables) return "";
  const unique = JMETER_ENV_KEYS.filter((k) => variables[k]?.trim());
  if (!unique.length) return "";
  return unique
    .map(
      (k) => `        <elementProp name="${escapeXmlText(k)}" elementType="Argument">
          <stringProp name="Argument.name">${escapeXmlText(k)}</stringProp>
          <stringProp name="Argument.value">${escapeXmlText(variables[k]!)}</stringProp>
          <stringProp name="Argument.metadata">=</stringProp>
        </elementProp>`,
    )
    .join("\n");
}

function threadGroupAuthHeaderXml(
  variables: Record<string, string> | undefined,
  injectEnv: boolean,
  host: string,
): string {
  if (!injectEnv || !variables) return "";
  const token = variables.token?.trim();
  const secret = variables.secret?.trim();
  const terminalenv = variables.terminalenv?.trim() ?? "prd";
  if (!token && !secret) return "";

  const rows: string[] = [];
  if (token) {
    rows.push(`              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">token</stringProp>
                <stringProp name="Header.value">${escapeXmlText(token)}</stringProp>
              </elementProp>`);
  }
  if (secret) {
    rows.push(`              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">secret</stringProp>
                <stringProp name="Header.value">${escapeXmlText(secret)}</stringProp>
              </elementProp>`);
  }
  rows.push(`              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">terminalenv</stringProp>
                <stringProp name="Header.value">${escapeXmlText(terminalenv)}</stringProp>
              </elementProp>`);

  return `        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="ATP 鉴权头" enabled="true">
            <collectionProp name="HeaderManager.headers">
${rows.join("\n")}
            </collectionProp>
          </HeaderManager>
        <hashTree/>`;
}

type UrlParts = {
  protocol: string;
  domain: string;
  port: string;
  path: string;
};

function urlToJmeterParts(rawUrl: string): UrlParts | null {
  const templated = toJmeterPropertyRefs(rawUrl.trim());
  const baseOnly = templated.match(/^\$\{base_url\}(\/.*)?$/i);
  if (baseOnly) {
    const pathOnly = baseOnly[1] ?? "/";
    return { protocol: "https", domain: "${BASE_URL}", port: "", path: pathOnly };
  }

  const probe = templated.replace(/\$\{[^}]+\}/g, "localhost");
  try {
    const u = new URL(probe.includes("://") ? probe : `https://${probe}`);
    const path = `${u.pathname}${u.search}`;
    const defaultPort = u.protocol === "https:" ? "443" : "80";
    const port = u.port && u.port !== String(defaultPort) ? u.port : "";
    const hostMatch = templated.match(/^https?:\/\/([^/?#]+)/i);
    const domain = hostMatch?.[1] ?? u.hostname;
    const portStr =
      port && !domain.includes(":") ? port : domain.includes(":") ? domain.split(":")[1] ?? "" : port;
    const domainOnly = domain.includes(":") ? domain.split(":")[0] : domain;
    return {
      protocol: u.protocol.replace(":", ""),
      domain: domainOnly,
      port: portStr,
      path: path || "/",
    };
  } catch {
    return null;
  }
}

function isJsonBody(contentType: string | undefined, body: string): boolean {
  if (contentType?.includes("json")) return true;
  const t = body.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function isFormBody(contentType: string | undefined, body: string): boolean {
  if (contentType?.includes("x-www-form-urlencoded")) return true;
  return /^[^=&\s]+=/.test(body.trim()) && !body.trim().startsWith("{");
}

function httpSamplerXml(
  draft: WorkbenchDraft,
  testName: string,
  variables: Record<string, string> | undefined,
  injectEnv: boolean,
): string {
  const method = draft.method.toUpperCase();
  const fullUrl = buildUrl(draft.url, draft.query);
  const parts = urlToJmeterParts(fullUrl);
  if (!parts) {
    throw new Error(`无法解析 URL：${fullUrl}`);
  }

  const headers = mergeAuthHeaders(headersForSend(draft), variables, injectEnv);
  const contentType = headers["Content-Type"] ?? headers["content-type"] ?? draft.bodyContentType;
  let bodyPrepared = draft.body ?? "";
  if (injectEnv && variables) {
    bodyPrepared = partialSubstitute(bodyPrepared, variables);
  }
  const bodyRaw =
    /\{\{\w+\}\}/.test(bodyPrepared) ? toJmeterPropertyRefs(bodyPrepared) : bodyPrepared;
  const useRaw =
    method !== "GET" &&
    method !== "HEAD" &&
    draft.bodyMode === "raw" &&
    bodyRaw.trim() !== "" &&
    (isJsonBody(contentType, bodyRaw) || !isFormBody(contentType, bodyRaw));

  let argumentsBlock: string;
  if (useRaw) {
    argumentsBlock = `<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${escapeXmlText(bodyRaw)}&#xd;
 </stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>`;
  } else if (method !== "GET" && method !== "HEAD" && bodyRaw.trim() && isFormBody(contentType, bodyRaw)) {
    const pairs = bodyRaw.split("&").filter(Boolean);
    const args = pairs
      .map((pair) => {
        const eq = pair.indexOf("=");
        const name = eq < 0 ? pair : pair.slice(0, eq);
        const value = eq < 0 ? "" : pair.slice(eq + 1);
        return `              <elementProp name="${escapeXmlText(name)}" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${jmxPropertyValue(value, variables, injectEnv)}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
                <boolProp name="HTTPArgument.use_equals">true</boolProp>
                <stringProp name="Argument.name">${escapeXmlText(name)}</stringProp>
              </elementProp>`;
      })
      .join("\n");
    argumentsBlock = `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments">
${args}
            </collectionProp>
          </elementProp>`;
  } else {
    argumentsBlock = `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>`;
  }

  const headerRows = Object.entries(headers)
    .filter(([k]) => k.toLowerCase() !== "host" && k.toLowerCase() !== "content-length")
    .map(
      ([k, v]) => `              <elementProp name="" elementType="Header">
                <stringProp name="Header.name">${escapeXmlText(k)}</stringProp>
                <stringProp name="Header.value">${jmxPropertyValue(String(v), variables, injectEnv)}</stringProp>
              </elementProp>`,
    )
    .join("\n");

  const headerBlock =
    headerRows.length > 0
      ? `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
            <collectionProp name="HeaderManager.headers">
${headerRows}
            </collectionProp>
          </HeaderManager>
          <hashTree/>`
      : "";

  const safeName = escapeXmlText(testName);

  return `        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${safeName}" enabled="true">
          ${argumentsBlock}
          <stringProp name="HTTPSampler.domain">${escapeXmlText(parts.domain)}</stringProp>
          <stringProp name="HTTPSampler.port">${escapeXmlText(parts.port)}</stringProp>
          <stringProp name="HTTPSampler.protocol">${escapeXmlText(parts.protocol)}</stringProp>
          <stringProp name="HTTPSampler.contentEncoding"></stringProp>
          <stringProp name="HTTPSampler.path">${escapeXmlText(parts.path)}</stringProp>
          <stringProp name="HTTPSampler.method">${method}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
          <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
          <stringProp name="HTTPSampler.embedded_url_re"></stringProp>
          <stringProp name="HTTPSampler.connect_timeout"></stringProp>
          <stringProp name="HTTPSampler.response_timeout"></stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          ${headerBlock}
        </hashTree>`;
}

const AGGREGATE_REPORT = `        <ResultCollector guiclass="StatVisualizer" testclass="ResultCollector" testname="Aggregate Report" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>true</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>`;

function domainFromDraft(draft: WorkbenchDraft): string {
  try {
    const u = new URL(draft.url.includes("://") ? draft.url : `https://${draft.url}`);
    return u.hostname;
  } catch {
    return "";
  }
}

export type JmxDraftInput = { label: string; draft: WorkbenchDraft };

export function buildJmxFromWorkbenchDrafts(
  items: JmxDraftInput[],
  opts: JmxExportOptions,
  envVariables?: Record<string, string>,
): { xml: string; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const samplers: string[] = [];
  const injectEnv = opts.injectEnv && Boolean(envVariables);

  if (opts.injectEnv && !envVariables?.token?.trim()) {
    warnings.push("环境未配置 token：请在 API 工作台「变量」保存 token，或编辑 projects/<id>/environments/dev.local.yaml");
  }
  if (opts.injectEnv && envVariables?.token?.trim() && !envVariables.secret?.trim()) {
    warnings.push("环境未配置 secret，南财接口可能返回未登录");
  }

  let authHost = "";
  for (const c of items) {
    const draft = c.draft;
    if (!authHost) {
      try {
        const fullUrl = buildUrl(draft.url, draft.query);
        const probe = (injectEnv && envVariables ? partialSubstitute(fullUrl, envVariables) : fullUrl).replace(
          /\$\{[^}]+\}/g,
          "localhost",
        );
        authHost = new URL(probe.includes("://") ? probe : `https://${probe}`).hostname;
      } catch {
        authHost = domainFromDraft(draft);
      }
    }
    try {
      samplers.push(httpSamplerXml(draft, draft.name?.trim() || c.label, envVariables, injectEnv));
    } catch (e) {
      errors.push(`${c.label}：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!samplers.length) {
    return { xml: "", errors: errors.length ? errors : ["没有可导出的 HTTP 请求"], warnings };
  }

  const plan = escapeXmlText(opts.planName);
  const tgName = escapeXmlText(opts.threadGroupName);
  const udv = buildUserDefinedVariablesXml(injectEnv ? envVariables : undefined);
  const authHeaders = threadGroupAuthHeaderXml(envVariables, injectEnv, authHost || "sfccn.com");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.5">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${plan}" enabled="true">
      <stringProp name="TestPlan.comments">由 API Test Automation Platform 生成</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments">
${udv}
        </collectionProp>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${tgName}" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">${opts.loops}</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${opts.threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${opts.rampUpSec}</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <stringProp name="ThreadGroup.delay"></stringProp>
        <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
      </ThreadGroup>
      <hashTree>
${authHeaders}
${samplers.join("\n")}
${AGGREGATE_REPORT}
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;

  return { xml, errors, warnings };
}

export function buildJmxFromCaseYamls(
  cases: JmxCaseInput[],
  opts: JmxExportOptions,
  envVariables?: Record<string, string>,
): { xml: string; errors: string[]; warnings: string[] } {
  const items: JmxDraftInput[] = [];
  const errors: string[] = [];
  for (const c of cases) {
    const draft = caseYamlToWorkbenchDraft(c.yaml);
    if (!draft) {
      errors.push(`${c.label}：YAML 无法解析`);
      continue;
    }
    items.push({ label: c.label, draft });
  }
  const built = buildJmxFromWorkbenchDrafts(items, opts, envVariables);
  return { xml: built.xml, errors: [...errors, ...built.errors], warnings: built.warnings };
}

/** 从 YAML 文本解析展示名 */
export function caseLabelFromYaml(yamlText: string, fallback: string): string {
  try {
    const doc = yaml.load(yamlText) as { name?: string };
    return doc?.name?.trim() || fallback;
  } catch {
    return fallback;
  }
}