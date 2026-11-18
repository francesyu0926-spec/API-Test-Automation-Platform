/** 环境名 → 指示圆点样式（dev 绿、prod 红等） */
export function envIndicatorDotClass(envName: string): string {
  const n = envName.trim().toLowerCase();
  if (n === "prod" || n === "production" || n === "prd") return "env-indicator-dot env-indicator-dot--prod";
  if (n === "staging" || n === "stage" || n === "pre" || n === "uat") return "env-indicator-dot env-indicator-dot--stage";
  if (n === "test" || n === "qa" || n === "sit") return "env-indicator-dot env-indicator-dot--test";
  if (n === "dev" || n === "local" || n === "development") return "env-indicator-dot env-indicator-dot--dev";
  return "env-indicator-dot env-indicator-dot--other";
}