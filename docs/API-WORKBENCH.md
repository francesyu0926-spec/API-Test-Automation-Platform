# API 工作台（Postman 风格）

桌面端侧栏 **API 工作台** 提供：

- 左侧 **集合 / 文件夹** 树（数据存于 `projects/<项目>/collections/*.json`）
- 方法 + URL + **Send**（主进程 `fetch`，无浏览器 CORS 限制）
- **Params / Headers / Body** 页签
- 下方 **Response**（状态、耗时、Body / Headers）
- 抓包明细 **在工作台打开** → 编辑后 **保存** 进集合
- **性能** 页签：并发压测、p50/p95/p99、吞吐、延迟直方图；报告保存到 `projects/<项目>/perf/*.json`

## 集合文件格式

见 `projects/example-service/collections/default.json`。每个请求含 `method`、`url`、`headers`、`query`、`bodyMode`、`body`，可选 `folder` 用于分组。

## 保存为自动化用例

抓包 **交易明细** 或 API 工作台可点 **保存为用例**，写入 `projects/<项目>/cases/<name>.yaml`，可选加入 `suites/*.yaml`。

生成规则：

- URL 中域名替换为 `{{base_url}}`（请在 `environments/dev.yaml` 配置 `base_url`）
- `token` / `Authorization` 等写入 `{{token}}` / `{{access_token}}`，密钥放 `environments/*.local.yaml`
- 断言：抓包响应状态码（或 200）+ `duration_ms` 上限

在 **执行记录** 选套件与环境后 **运行套件** 即可回归。

## 后续可扩展

- Postman Collection v2.1 导入导出