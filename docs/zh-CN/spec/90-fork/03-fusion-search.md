# 90-03. Fusion Search 插件

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/03-fusion-search) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。`Extensions/fusion-search` 是通过常规插件机制加载的 fork 自有插件，不钩入任何 upstream 文件。开发文档是 `Extensions/fusion-search/README.md`；本页保存规格层面的契约和 E2E 场景。

## 1. 范围

- 插件使用仅保存在插件私有设置中的专用测试账号对内网检索服务进行认证，并为单条专利权利要求提供语义基线准备。
- 面向智能体的工具是 `fusion_semantic_baseline`，恰好两个动作：`prepare`（创建远端基线并返回权利要求范围的术语和权重）和 `update_terms`（修正这些列表）。两个动作都会修改远端状态，在远端结果不明确时绝不自动重放。
- 凭据和令牌绝不出现在工具参数、结果或日志中。
- 布尔检索与结果阅读工具与基线工具并列；其契约见 README。
- `fusion_full_text` 读取结果页中列出的一篇专利的全文。唯一参数是结果页显示的 `pnId`；检索会话、查看数据库和申请号由插件从布尔检索与结果页经手过的信息中自行补齐。快速查看端点每次只解析一个身份——单个申请号（可同时携带合并公开号列表），或无申请号时的单个公开号——因此列出的多成员记录会被归约为这两种形状：先发首个申请号成员＋合并公开号列表，再退化为仅首个公开号成员。返回的是纯阅读文本——全部权利要求，然后是带服务端 `[000N]` 段号的说明书——不是摘要、不是片段、也不分页。调用只读，令牌刷新后重试一次，声明为 `risk: low`。

## 2. E2E 场景

#### E2E-PLUGIN-fusion-search-authenticated-semantic-baseline

- **前提**：已加载 `local.fusion-search` 开发插件；专用内网测试账号只配置在该插件的私有设置中；声明的认证与检索主机可达；用户已授予清单请求的高风险权限；有一个受控的测试权利要求引用。`prepare` 会创建远端基线，因此只使用批准承受该副作用的测试案例或目标权利要求文本。
- **步骤**：1）从没有已存令牌开始。2）以 `action=prepare`、明确的 `reference_kind`（`application_number`、`publication_number` 或 `text`）和受控引用调用 `fusion_semantic_baseline`。`text` 情况下提供你自己对该权利要求技术方案的简明改写；不要逐字复制，也不要使用整篇申请。3）检查返回的 `element_id` 以及中英文术语与权重，并与该条权利要求对照。4）必要时用修正后的列表调用 `update_terms`。检查插件设置时不显示凭据或令牌值。
- **预期**：首次调用完成内置登录链，在插件私有设置中持久化可用令牌，并立即返回基线术语与权重。工作流针对指定的一条权利要求而非整篇申请；不要假设案号响应已经是权利要求级别的。优先使用申请号/公开号，用 `update_terms` 精炼其术语，当案号基线仍不合适时退回到你自己对目标权利要求技术方案的改写。凭据和令牌都不出现在工具参数、结果或日志中。工具恰好暴露 `prepare` 和 `update_terms`；两者都修改远端状态，在远端结果不明确时绝不自动重放。
- **关联规格**：本页；`07-plugins/03-plugin-api.md`；`07-plugins/13-plugin-permissions-matrix.md`；`Extensions/fusion-search/README.md`
- **验收**：插件认证、私有持久化、以及带即时术语输出的语义基线准备
- **状态**：`Extensions/fusion-search/test` 下有自动化单元/集成覆盖；内网实测需要专用测试账号和可达的服务

#### E2E-PLUGIN-fusion-search-full-text-from-listed-record

- **前提**：已用可用账号加载 `local.fusion-search` 开发插件；对一个有全文的数据库（CNTXT）存在一个语义排序的布尔检索会话，且其中至少有一条记录的 `pnId` 与 `anId` 各自携带多个 `;` 分隔成员；快速查看主机可达。
- **步骤**：1）用 `fusion_semantic_result_page` 读该会话第 1 页，记下某条记录的 `pnId`，优先选择多成员记录。2）以恰好 `{ "pnId": <该值> }` 调用 `fusion_full_text`。3）对多公开号 `pnId`，只传其中一个 `;` 分隔的成员再调用一次。4）用一个插件从未列出过的 pnId 调用。5）对一条快速全文库未收录的记录调用。6）检查智能体转录和 设置 → Agent → Subagents 中的工具列表。
- **预期**：步骤 2 返回一个纯字符串：首行为 pnId 与标题，然后是 `权利要求` 下的全部权利要求，再是 `说明书`，标题行不带编号，段落以 `[000N]` 开头；没有 HTML、没有 JSON 外层、没有任何附加字段。请求带有该会话的 `ssid` 头、首个申请号成员作为 `anid`、合并公开号列表作为 `pnid`、以及作为 `viewDb` 的数据库，并且没有产生检索历史。步骤 3 返回同一篇文档；多成员记录一律以"首个申请号成员＋合并列表"请求，失败时退化为仅首个公开号成员，绝不发送 `;` 连接的 `anid` 或在 `anid` 为空时发送合并列表。步骤 4 发出裸请求（`anid`/`viewDb` 为空、无 `ssid`、仅首个公开号成员），要么返回正文，要么把服务端的拒绝作为错误对象返回。步骤 5 返回 `{ ok: false, error: { code: "FULL_TEXT_UNAVAILABLE", message } }`，`message` 为服务端原因。工具 schema 只列出 `pnId`，风险等级为 `low`，并作为可单独勾选的插件工具出现在子代理编辑器中。
- **关联规格**：本页；`02-subagent-tool-selection.md`；`07-plugins/03-plugin-api.md`；`Extensions/fusion-search/README.md`
- **验收**：单参数契约、纯文本输出的全文阅读；由插件自有记录登记表完成身份补齐
- **状态**：`Extensions/fusion-search/test` 下有单元覆盖（`full-text*`、`record-registry`、`main`、`tool-executor`）；实测路径为 `test/live-full-text.test.mjs`，需要专用账号、一个会话 id 和可达的快速查看主机
