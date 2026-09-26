# 90-03. Fusion Search 插件

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/03-fusion-search) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。`Extensions/fusion-search` 是通过常规插件机制加载的 fork 自有插件，不钩入任何 upstream 文件。开发文档是 `Extensions/fusion-search/README.md`；本页保存规格层面的契约和 E2E 场景。

## 1. 范围

- 插件使用仅保存在插件私有设置中的专用测试账号对内网检索服务进行认证，并为单条专利权利要求提供语义基线准备。
- 面向智能体的工具是 `fusion_semantic_baseline`，恰好两个动作：`prepare`（创建远端基线并返回权利要求范围的术语和权重）和 `update_terms`（修正这些列表）。两个动作都会修改远端状态，在远端结果不明确时绝不自动重放。
- 凭据和令牌绝不出现在工具参数、结果或日志中。
- 布尔检索与结果阅读工具与基线工具并列；其契约见 README。

## 2. E2E 场景

#### E2E-PLUGIN-fusion-search-authenticated-semantic-baseline

- **前提**：已加载 `local.fusion-search` 开发插件；专用内网测试账号只配置在该插件的私有设置中；声明的认证与检索主机可达；用户已授予清单请求的高风险权限；有一个受控的测试权利要求引用。`prepare` 会创建远端基线，因此只使用批准承受该副作用的测试案例或目标权利要求文本。
- **步骤**：1）从没有已存令牌开始。2）以 `action=prepare`、明确的 `reference_kind`（`application_number`、`publication_number` 或 `text`）和受控引用调用 `fusion_semantic_baseline`。`text` 情况下提供你自己对该权利要求技术方案的简明改写；不要逐字复制，也不要使用整篇申请。3）检查返回的 `element_id` 以及中英文术语与权重，并与该条权利要求对照。4）必要时用修正后的列表调用 `update_terms`。检查插件设置时不显示凭据或令牌值。
- **预期**：首次调用完成内置登录链，在插件私有设置中持久化可用令牌，并立即返回基线术语与权重。工作流针对指定的一条权利要求而非整篇申请；不要假设案号响应已经是权利要求级别的。优先使用申请号/公开号，用 `update_terms` 精炼其术语，当案号基线仍不合适时退回到你自己对目标权利要求技术方案的改写。凭据和令牌都不出现在工具参数、结果或日志中。工具恰好暴露 `prepare` 和 `update_terms`；两者都修改远端状态，在远端结果不明确时绝不自动重放。
- **关联规格**：本页；`07-plugins/03-plugin-api.md`；`07-plugins/13-plugin-permissions-matrix.md`；`Extensions/fusion-search/README.md`
- **验收**：插件认证、私有持久化、以及带即时术语输出的语义基线准备
- **状态**：`Extensions/fusion-search/test` 下有自动化单元/集成覆盖；内网实测需要专用测试账号和可达的服务
