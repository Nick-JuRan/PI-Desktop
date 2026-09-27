# 90-06. 非专利检索插件

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/06-non-patent-search) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。`Extensions/non-patent-search`（`local.non-patent-search`，显示名"非专利检索"）是通过常规插件机制加载的 fork 自有智能体工具插件，不钩入任何 upstream 文件。0.1.0 版提供 CNKI（中国知网）工具族，是把独立的 `CNKICrawlerMCP` 服务移植为进程内插件工具的结果。开发文档是 `Extensions/non-patent-search/README.md`。

## 1. 范围

- 两个智能体工具，都以 `CNKI_` 为前缀，便于以后其它数据库工具族并列放在同一插件里：
  - `CNKI_ScanPaper`——主题字段检索。参数 `value`（必填）、`pageSize`（1–50，默认 10）、`pageNum`（≥1）。每条命中恰好返回 `Title`、`Href`、`Abstract`、`HTML_READING_URL`；摘要和在线阅读链接从每条命中的摘要页读取，这把原来的 `GetPaperInfo` 工具并入了检索。没有 `withFactors`，也不查影响因子。
  - `CNKI_GetPaperMainBody`——按一个 `HTML_READING_URL` 获取全文，以纯字符串返回（标题、章节标题、段落；真实换行，无 HTML，无 JSON 转义）。
- 没有 cookie 工具。插件在第一次调用前通过 IP 登录（`login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`）获取 CNKI 会话，保存在内存中；当某次响应是登录页时自动重新登录一次。对不在 CNKI 白名单内的机器，插件私有设置文件中的 cookie 优先于 IP 登录。
- 一个节流器为所有 CNKI 请求限速（1.2 s + 最多 0.9 s 抖动）。页面请求走 `pi.net.fetch`，受 `net.domains = ["*.cnki.net"]` 约束；登录响应的多条 `Set-Cookie` 和重定向的 `Location` 是宿主 fetch 无法暴露的，改用限定同一批主机的 `node:https` 客户端读取。
- 错误是结构化的（`INVALID_ARGUMENT`、`LOGIN_FAILED`、`COOKIE_EXPIRED`、`BLOCKED`、`UNEXPECTED_PAGE`、`HTTP_ERROR`、`MAIN_BODY_UNAVAILABLE`、`HOST_NOT_ALLOWED`、`CANCELLED`）。

## 2. 工具契约细节

- 检索请求复现爬虫的表单：只含一个 `SU`/`TOPRANK` 条目的 `QueryJson`、`pageNum`、取值 {10, 20, 50} 的 `pageSize`、固定的 `productStr`、`searchFrom` 和 `turnpage` 令牌。逐页收集直到找到 `pageSize` 条唯一 href，上限 50。
- 既没有 `#countPageDiv` 工具栏也没有 `table.result-table-list` 表格的响应会被分类：登录页 → `COOKIE_EXPIRED`（自动重登一次），验证页 → `BLOCKED`，其它 → `UNEXPECTED_PAGE`。
- 摘要页解析 `input#abstract_text[value]` 与 `.btn-html` 阅读链接；摘要页失败时该命中仍保留在结果中，字段留空，并在 `warnings` 增加一行。
- 阅读链接通过手动跟随重定向（或读取最终页面内嵌的参数）解析出 `fileName`/`tableName`/`dbCode`/`invoice`，然后调用 `nzkhtml/knsread/litNotes/getPaperInfo`，把 `content.title` 与按 `orderNum` 排序的 `catalogInfos[]` 展平为文本。

## 3. E2E 场景

#### E2E-PLUGIN-cnki-scan-and-read

- **前提**：已加载 `local.non-patent-search` 开发插件并批准其 `agent.tool.register` / `net.fetch` 授权。桌面运行在 CNKI IP 白名单内的网络，或插件设置文件中有有效的 `cookie`。Agent 模式。
- **步骤**：1）开始新回合，要求智能体用 `CNKI_ScanPaper` 按主题关键词检索 CNKI，`pageSize` 为 5。2）检查结果。3）要求智能体用 `CNKI_GetPaperMainBody` 读取其中一条的全文，原样传入其 `HTML_READING_URL`。4）对一条 `HTML_READING_URL` 为空或订阅不覆盖阅读的命中请求全文。5）快速重复步骤 1 数次。
- **预期**：步骤 1 不需要任何 cookie 交互；插件日志显示一次 IP 登录（或使用设置文件中的 cookie）。结果恰好列出五篇论文，只带 `Title`、`Href`、`Abstract`、`HTML_READING_URL`，并有 `totalHits`；无法读取的摘要页出现在 `warnings` 中而不是让检索失败。步骤 3 返回纯文本全文，标题在前、章节标题按序、没有 HTML 标签和 `\n` 序列。步骤 4 返回结构化的 `MAIN_BODY_UNAVAILABLE` 或 `INVALID_ARGUMENT` 错误。步骤 5 中请求间隔至少 1.2 s；若 CNKI 返回验证页，工具返回 `BLOCKED` 而不重试。
- **关联规格**：本页；`07-plugins/03-plugin-api.md`；`07-plugins/13-plugin-permissions-matrix.md`；`Extensions/non-patent-search/README.md`
- **验收**：插件工具注册、自动 CNKI 登录、带合并摘要数据的检索、纯文本全文
- **状态**：解析、登录、检索、重定向解析和工具行为由 `Extensions/non-patent-search/test` 下的单元测试覆盖，包括在真实插件宿主中加载（`host-runtime.test.mjs`，CNKI 被打桩）；实网旅程需要白名单网络，由维护者运行。
