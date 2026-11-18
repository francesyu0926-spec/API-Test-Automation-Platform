export function newCaseYaml(caseName: string): string {
  const name = caseName.trim() || "new-case";
  return `name: ${name}
description: 新建用例
request:
  method: GET
  url: "{{base_url}}/path"
  headers:
    Accept: "application/json"
assertions:
  - type: status
    equals: 200
  - type: duration_ms
    max: 30000
`;
}