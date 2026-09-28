# 90-06. 非专利检索插件

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/06-non-patent-search) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。`Extensions/non-patent-search`（`local.non-patent-search`，显示名"非专利检索"）是通过常规插件机制加载的 fork 自有智能体工具插件，不钩入任何 upstream 文件。0.2.0 版提供 CNKI（中国知网）工具族，是把独立的 `CNKICrawlerMCP` 服务移植为进程内插件工具的结果。开发文档是 `Extensions/non-patent-search/README.md`。

## 1. 范围

- 两个智能体工具，都以 `CNKI_` 为前缀，便于以后其它数据库工具族并列放在同一插件里：
  - `CNKI_ScanPaper`——主题字段检索。参数 `value`（必填）、`pageSize`（1–50，默认 10）、`pageNum`（≥1）、`withDetails`（默认 true）。每条命中恰好返回 `Title`、`Href`、`Abstract`、`HTML_READING_URL`；检索本身与原 `ScanPaper` 一样只发一次请求，开启 `withDetails` 时再从每条命中的摘要页读取摘要和在线阅读链接，这把原来的 `GetPaperInfo` 工具并入了检索。`withDetails: false` 是单请求形式（只有标题和链接）。没有 `withFactors`，也不查影响因子。
  - `CNKI_GetPaperMainBody`——按一个 `HTML_READING_URL` 获取全文，以纯字符串返回（标题、章节标题、段落；真实换行，无 HTML，无 JSON 转义）。
- 没有 cookie 工具。插件在第一次调用前通过 IP 登录（`login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`）获取 CNKI 会话，保存在内存中，每次请求原样发送；当某次响应是登录页时，每次工具调用最多自动重新登录一次。对不在 CNKI 白名单内的机器，插件私有设置文件中的 cookie 优先于 IP 登录。
- 一个节流器为所有 CNKI 请求限速（1.2 s + 最多 0.9 s 抖动）。所有 CNKI 请求都由插件自己的 `node:https` 客户端发出，带爬虫的原样请求头（表单 content type、`Cookie`、Chrome UA、`Referer: https://kns.cnki.net/`、`Accept-Encoding: gzip`），重定向由插件在 `*.cnki.net` 内自行跟随（≤ 6 跳，链内 cookie 向后传递，报告最终 URL）。CNKI 请求不走 `pi.net.fetch`：在桌面端它就是 Electron 的 `net.fetch`，一旦任何响应为该主机设置过 cookie，Chromium 就会用自己的会话 cookie 罐替换插件的 `Cookie` 头（IP 登录会话因此再也到不了 CNKI，CNKI 对这个匿名客户端返回人机验证页），30x 响应直接失败而不是返回，多条 `Set-Cookie` 也会被合并成一条。manifest 中的 `net.fetch` / `net.domains = ["*.cnki.net"]` 仍是插件的出网声明；插件在每次连接和每一跳重定向前执行同一白名单。
- 错误是结构化的（`INVALID_ARGUMENT`、`LOGIN_FAILED`、`COOKIE_EXPIRED`、`BLOCKED`、`UNEXPECTED_PAGE`、`HTTP_ERROR`、`MAIN_BODY_UNAVAILABLE`、`HOST_NOT_ALLOWED`、`CANCELLED`）。

## 2. 工具契约细节

- 检索请求复现爬虫的表单：只含一个 `SU`/`TOPRANK` 条目的 `QueryJson`、`pageNum`、取值 {10, 20, 50} 的 `pageSize`、固定的 `productStr`、`searchFrom` 和 `turnpage` 令牌。逐页收集直到找到 `pageSize` 条唯一 href，上限 50。
- 既没有 `#countPageDiv` 工具栏也没有 `table.result-table-list` 表格的响应会被分类：登录页 → `COOKIE_EXPIRED`（自动重登一次），验证页 → `BLOCKED`，HTTP ≥ 400 → `HTTP_ERROR`，其它 → `UNEXPECTED_PAGE`。登录页和验证页按重定向后的最终 URL（`login.cnki.net`、`…/verify` 或 `…/captcha` 路径）、标题与可见文本、或脚本/表单跳转目标识别，而不是按原始标记——普通 CNKI 页面本来就链接到 `login.cnki.net` 并加载 captcha 脚本。这类错误带有 `finalUrl`、`status`、`title` 和可见文本 `snippet`，便于上报。
- 摘要页解析 `input#abstract_text[value]` 与 `.btn-html` 阅读链接。详情读取从不让检索失败：失败或无法识别的摘要页让该命中字段留空并在 `warnings` 增加一行；第一次 `BLOCKED`（或自动重登后的第二次 `COOKIE_EXPIRED`）会停止剩余的详情读取，并在结尾的 warning 中说明原因和 `withDetails: false` 的备选方式。
- 阅读链接通过手动跟随重定向（或读取最终页面内嵌的参数）解析出 `fileName`/`tableName`/`dbCode`/`invoice`，然后调用 `nzkhtml/knsread/litNotes/getPaperInfo`，把 `content.title` 与按 `orderNum` 排序的 `catalogInfos[]` 展平为文本。

## 3. E2E 场景

#### E2E-PLUGIN-cnki-scan-and-read

- **前提**：已加载 `local.non-patent-search` 开发插件并批准其 `agent.tool.register` / `net.fetch` 授权。桌面运行在 CNKI IP 白名单内的网络，或插件设置文件中有有效的 `cookie`。Agent 模式。
- **步骤**：1）开始新回合，要求智能体用 `CNKI_ScanPaper` 按主题关键词检索 CNKI，`pageSize` 为 5。2）检查结果。3）要求智能体用 `CNKI_GetPaperMainBody` 读取其中一条的全文，原样传入其 `HTML_READING_URL`。4）对一条 `HTML_READING_URL` 为空或订阅不覆盖阅读的命中请求全文。5）快速重复步骤 1 数次。6）用 `withDetails` 为 false 再做一次同样的检索。
- **预期**：步骤 1 不需要任何 cookie 交互；插件日志显示一次 IP 登录（或使用设置文件中的 cookie）。结果恰好列出五篇论文，只带 `Title`、`Href`、`Abstract`、`HTML_READING_URL`，并有 `totalHits`；无法读取的摘要页出现在 `warnings` 中而不是让检索失败。步骤 3 返回纯文本全文，标题在前、章节标题按序、没有 HTML 标签和 `\n` 序列。步骤 4 返回结构化的 `MAIN_BODY_UNAVAILABLE` 或 `INVALID_ARGUMENT` 错误。步骤 5 中请求间隔至少 1.2 s；若 CNKI 对检索返回验证页，工具返回 `BLOCKED`（带 `finalUrl`、`title`、`snippet`）而不重试；若是对摘要页返回验证页，检索仍然成功，剩余详情读取被跳过并有结尾 warning。步骤 6 只发一次 CNKI 请求，`Abstract` / `HTML_READING_URL` 为空。
- **关联规格**：本页；`07-plugins/03-plugin-api.md`；`07-plugins/13-plugin-permissions-matrix.md`；`Extensions/non-patent-search/README.md`
- **验收**：插件工具注册、自动 CNKI 登录、带合并摘要数据的检索、纯文本全文
- **状态**：解析、登录、检索、重定向解析和工具行为由 `Extensions/non-patent-search/test` 下的单元测试覆盖，包括在真实插件宿主中加载（`host-runtime.test.mjs`，CNKI 在 `https.request` 边界被伪造）；实网旅程需要白名单网络，由维护者运行。
