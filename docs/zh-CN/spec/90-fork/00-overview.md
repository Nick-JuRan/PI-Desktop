# 90-00. Fork 总览

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/00-overview) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

本章节属于 fork `Nick-JuRan/PI-Desktop`。upstream（`vastsa/PI-Desktop`）没有这个章节，因此这里的任何内容都不会在同步 upstream 时产生冲突。fork 私有的全部规格与 E2E 场景都写在本章节；`01`–`08` 各章节的 upstream 页面与 upstream 保持逐字节一致，只允许 `FORK.md` 登记过的一行提示。

## 1. 为什么单独一个章节

fork 在 upstream 之上只维护少量私有功能。相应的仓库策略是根目录的 `FORK-STANDARD.md`：fork 代码放在 fork 自有文件里（"岛屿"），upstream 文件最多接受一行钩子，fork 文档写在这里而不是插进 upstream 的规格页。仅 `docs/spec/06-delivery/04-e2e-test-plan.md` 一个文件，upstream 每周就要改上百次；把 fork 场景移出它，`Sync fork` 才能干净地合并。

## 2. fork 功能与对应页面

- **子智能体深度**——由 `AppSettings.maxSubagentDepth` 控制的有界嵌套委派。见 `01-subagent-depth.md`。
- **子智能体工具选择**——为委派定义显式授予 Skill / MCP / 插件 / 可信扩展工具。见 `02-subagent-tool-selection.md`。
- **Fusion Search 插件**——`Extensions/fusion-search`，带认证的语义检索插件。见 `03-fusion-search.md`。
- **分类查询插件**——`Extensions/classification-queryer`，IPC/CPC 分类树工具。见 `04-classification-query.md`。
- **Windows 测试门禁可移植性**——对 upstream 测试门禁与 E2E 脚本的 Windows 适配。见 `05-windows-portability.md`。

## 3. fork 页面与 upstream 页面的关系

每个页面都写明它扩展了哪些 upstream 规格章节、改变了哪些 upstream 描述的行为。当 fork 改变了某个 upstream 页面所描述的行为（例如委派工具被限定到调用方的直接子代理），该 upstream 页面只保留一行指向这里的提示，其余措辞与 upstream 相同；fork 行为的权威描述在本章节。

## 4. 约定

- 新的 fork 页面放在本目录，命名为 `NN-slug.md`，并在 `docs/zh-CN/spec/90-fork/` 下提供中文镜像；两者都要列入 `NAV.md`。
- fork 的 ADR 使用 slug 编号（`docs/adr/<slug>.md`），引用写作 `ADR <slug>`。
- fork 的 E2E 场景编号使用功能前缀（`E2E-SUBAGENT-…`、`E2E-PLUGIN-…`），不占用 upstream 的数字序列。
- fork 功能触碰的每个 upstream 文件都登记在 `FORK.md`。
