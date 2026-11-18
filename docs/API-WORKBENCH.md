# API 工作台（Postman 风格）

桌面端侧栏 **API 工作台** 提供：

- 左侧 **集合 / 文件夹** 树（数据存于 `projects/<项目>/collections/*.json`）
- 方法 + URL + **Send**（主进程 `fetch`，无浏览器 CORS 限制）
- **Params / Headers / Body** 页签
- 下方 **Response**（状态、耗时、Body / Headers）
- 抓包明细 **在工作台打开** → 编辑后 **保存** 进集合
- **发送到压测**：把当前 HTTP 请求带到侧栏 **负载测试**（JMeter 式线程组）

## 负载测试（JMeter 风格）

侧栏 **负载测试**：

- **测试计划** → **线程组**（线程数、Ramp-Up 秒、循环次数、预热、超时）
- **HTTP 请求** 采样器：从项目 **集合模块** 选择已保存接口（带入 URL / Headers / Query / Body），或手动编辑
- **聚合报告** 监听器：吞吐、p50/p95/p99、延迟分布、察看结果树
- 报告可保存到 `projects/<项目>/perf/*.json`

## 集合文件格式

见 `projects/example-service/collections/default.json`。每个请求含 `method`、`url`、`headers`、`query`、`bodyMode`、`body`，可选 `folder` 用于分组。

## 保存为自动化用例

抓包 **交易明细** 仍可 **保存为用例**；API 工作台 **保存到集合** 时会同步写入 `projects/<项目>/cases/<name>.yaml`（默认加入 `smoke` 套件）。若用例重名，可覆盖、另存为或取消。

生成规则：

- URL 中域名替换为 `{{base_url}}`（请在 `environments/dev.yaml` 配置 `base_url`）
- `token` / `Authorization` 等写入 `{{token}}` / `{{access_token}}`，密钥放 `environments/*.local.yaml`
- 断言：抓包响应状态码（或 200）+ `duration_ms` 上限

在 **执行记录** 选套件与环境后 **运行套件** 即可回归。

## 导出 JMeter（.jmx）

**项目与用例** 页：

- **生成 JMX（全部）**：把一个项目下全部 YAML 用例合成一个测试计划（单线程组、多 HTTP 采样器、聚合报告）
- 单个用例详情栏 **生成 JMX**：仅导出当前用例

可 **保存到项目** `projects/<id>/jmx/<名称>.jmx`，或 **另存为** 到任意目录（例如外部压测仓库）。ATP 的 `{{变量}}` 会转为 JMeter 的 `${变量}`；登录/setUp、JSON 提取器等复杂链路请在 JMeter 中按需补充（可参考既有 `行情接口 v2.jmx` 结构）。

## 后续可扩展

- Postman Collection v2.1 导入导出