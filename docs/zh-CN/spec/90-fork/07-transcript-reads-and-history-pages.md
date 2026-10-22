# 90-07. 有界的对话记录读取与顶层历史页

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/07-transcript-reads-and-history-pages) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。渲染层永远不持有整份对话记录：它的每一次读取都是有界窗口，每一次对话记录重写都由 host 执行，主对话背后的历史页只含顶层行——委派产生的行在打开该委派时才读取。这项工作由一个始终打不开的会话驱动：3,794 行、331 MB，其中 3,645 行（96%）、315 MB（99.7%）是 `Task` 调用之下产生的行，而主 agent 自己的对话只有 150 行、约 1 MB。渲染层取到的每一页都是 5–15 MB 的委派工具载荷，在 host 上被解析成对话流根本不显示的行的 64 KiB 预览。

本页为 fork 修订 upstream 的 D199、D390、D269、ADR 0120、ADR 0216 与 ADR 0279。这些 fork 决策最初以 D660 / D665–D669 写进了 `08-meta/decisions-log.md`，两次与 upstream 的编号相撞；按 `FORK-STANDARD.md` B4 的要求，fork 决策从现在起记录在本页，决策日志归 upstream。

## 1. 有界的渲染层读取与 host 侧改写

- 渲染层发起的 `session/get` 若未带 `messageLimit` / `contentLimit`，由 Electron main 补上边界（`ipc/session-read-bounds.ts`：200 条、每条 64 KiB，并按 host 的 1000 条上限钳制）。渲染层因此永远不会在一次回复里收到整份对话记录。sidecar 通过自己的 host 代理用无上限的 `session.get` 重建模型上下文，这条路径未改动：模型在当前轮次、下一轮以及委派 `resume` 时看到的内容与此前逐字节相同。
- 实时流只保存每条工具结果的展示副本。`tool_end` 与 `tool_update` 经过 `lib/tool-result-display.ts`，它镜像 host-core 的 `record_to_ui_for_display`（同样的 64 KiB 预算、同样的标记文本），打开的会话不再因后台委派产出的每个完整工具载荷而增长渲染层堆内存。磁盘上的对话记录以及主进程持久化的 `tool_end` 不变。
- 渲染层拥有的对话记录重写已移除。删除消息与 Stop 撤回未被回复的提问调用 `session.deleteMessage({ sessionId, messageId })`：host 套用用户轮次规则（用户行带走其后直到下一条用户行之前的全部行；其他行单独删除），经 `session.replaceMessages` 路径重写，并返回 `deletedIds` 供渲染层与其窗口对账。`session.activateRevision` 的 `prefix` 变为可选；渲染层不再传递它并改为重新读取一页有界窗口，根消息不在对话记录中时返回 `NOT_FOUND`，而不是用空的或不完整的前缀重写。编辑与重试通过一次 `messageAround` 窗口获取目标消息（被聚焦的消息保留完整文本）；复制对话按有界分页遍历并复制展示形式。
- 顺序为何重要：若先给读取加上限，渲染层的 `replaceMessages` 写回会把一个分页且被展示截断的窗口重写进对话记录——这是用户数据丢失。因此改写在同一变更中搬到 host，任何方向都不再有渲染层数组跨越 IPC。
- 即便第 3 节的中间方案已撤回，这些边界仍然有效：没有它们，Stop、删除、重试与编辑会重新把整份对话记录读进渲染层，大会话上的删除会超过 host 的 64 MiB 请求上限。

## 2. 历史页只含顶层行；委派的行在打开时读取

- 对话记录 layout 缓存（格式 3）在每条消息偏移旁记录其委派父级——`meta` 中的 `parentToolCallId`，顶层行记为 `-`。扫描从它已经读到的行中取得：没有该键则不解析；有该键则忽略 `blocks` 解析；载荷里仅仅提到该键的行解析为无父级。版本 2 的缓存被忽略并重建一次。
- `session.get` 接受 `topLevelOnly: true`：窗口的行空间是没有委派父级的行，`messageBefore` / `messageStart` / `messageEnd` / `hasMore*` 在该空间内计数，落在委派内的 `messageAround` 目标以其父 `Task` 行为中心。也接受 `delegateOf: [callId, …]`（1–64 个 id，必须带 `messageLimit`，与 `topLevelOnly` 互斥）：这些调用下产生的行，按文件顺序，在该集合上开窗。两种空间里被排除的行都既不读取也不反序列化。
- 主对话流背后的每次读取都是顶层的：打开、预取、空读重试、中止/删除/切换修订后的落定刷新、编辑与重试的水合、阅读位置恢复、复制。搜索跳转及其窗口的翻页保留全部物理行，因为委派内部的命中需要它的行。
- 打开某个委派即读取页面漏掉的内容：工作面板标签页请求链上尚无行的调用，行内展开的 `Task` 行请求自己的调用，都经由 `loadDelegateRows`——每组调用一次最多 1000 行的有界读取，合并到其 `Task` 下，进行中共享、完成后只记一次，因此没有产出的委派不会被反复询问。失败的读取会提示，下次打开可重试。委派运行时其行仍实时到达。
- 历史页只含顶层行之后，这项工作针对的那个会话以自己 150 行的代价打开和翻页。持续内存耗尽的渲染进程是本节需要诊断的回归，而不是需要识别的状态。
- 此前把行归于主 agent 的统计来自 Windows `findstr`，它不匹配超过 8 KiB 的行——这类会话几乎每一行都如此。

## 3. 已撤回的中间方案

在第 1 节的边界和第 2 节的顶层历史页之间，曾有两项绕行方案上线，并在第 2 节从原因上消除症状后撤回。记录在此是为了避免它们引入过的文案、测试与控件被误认为缺失的功能。

- 有预算的历史推进：顶部边界观察器只在已加载行数少于 `TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET`（600）时读取更早的页，超过预算后边界处显示 `chat.loadEarlierMessages` 控件。已撤回：自动历史推进重新不设预算（D269），边界观察器与滚动到顶部取下一更早页，视口锚定在读者所在的行。
- 从边界直达对话开头：`chat.openConversationStart` 控件以历史阅读窗口读取第一页，显式加载更早一页时在页面落地期间把 `scrollTop` 保持为 0。与预算一并撤回；`openTranscriptStart` 动作、顶部保持与两条文案均已移除。
- 随第 1 节上线的渲染层恢复熔断（五分钟内自动重载三次后停止，在 `renderer.process.gone` 记录上写入 `recovery: "crash-loop"`，并弹出重载或退出的对话框）与上述两项控件一并撤回：渲染层恢复回到 upstream 的模块——消失的主渲染进程在 2 秒冷却后重载，记录带 `reason`、`exitCode` 与 `reloaded`。

## 4. 不变的部分

- 磁盘上的对话记录、持久化 outbox 与 sidecar 的模型上下文不受本页任何部分影响。
- 协议版本保持 11；`topLevelOnly` 与 `delegateOf` 是 `session.get` 的增量选项。
- 已加载的规范历史保持加载：长历史 E2E 的不变量（选择会话与后台增量不得丢弃已加载的行）不变。限制实时尾部的行数——把跟随中的实时对话记录最旧的行释放回 host——与该不变量冲突，另行决定。
- `truncateDisplayText` / `previewValue` 最多扫描 `limit` 个码点，不再为数 MB 的载荷物化字符数组；对 1 MB 工具结果施加 64 KiB 上限的代价是 O(64 KiB)。

## 5. 岛屿与集成点

- 岛屿（fork 自有文件，永不冲突）：`apps/desktop/electron/main/ipc/session-read-bounds.ts`、`apps/desktop/src/lib/tool-result-display.ts`、`apps/desktop/src/lib/conversation-read.ts`，以及它们的测试 `apps/desktop/test/session-read-bounds.test.mjs`、`apps/desktop/test/tool-result-display.test.mjs`、`apps/desktop/test/conversation-read.test.mjs`、`apps/desktop/test/delegate-rows-on-demand.test.mjs`。
- 集成点（fork 改动的 upstream 文件；带行数的完整清单见 `FORK.md` 的 "transcript reads / history pages" 分组）：`crates/host-core/src/sessions.rs`（顶层与委派窗口、`session.deleteMessage`）、`crates/host-core/src/transcripts/layout.rs`（带委派父级的 layout 格式 3）、`crates/host-core/src/transcripts.rs`、`apps/desktop/electron/main/ipc/session-ipc.ts`（有界 `session/get`、`sessionDeleteMessage`）、`apps/desktop/src/stores/slices/transcript-slice.ts` 与 `apps/desktop/src/stores/runtime/session-runtime.ts`（顶层读取、`loadDelegateRows`、展示截断的实时结果）、`apps/desktop/src/stores/slices/events-slice.ts`、`apps/desktop/src/features/chat/transcript/ChatTranscript.tsx` 与 `ToolRow.tsx`（打开时读取委派行）、`apps/desktop/src/lib/remote-project-session.ts`、`apps/desktop/src/lib/transcript-reading.ts`，以及为有界契约调整过的 upstream 测试。
- 带有本功能 fork 段落的 upstream 页面：`03-runtime/01-ipc-protocol.md`、`03-runtime/04-data-storage.md`、`03-runtime/06-host-rpc-protocol.md` 与 `04-ux/08-component-spec.md`。它们各自回指本页，而不是某个决策编号。

## 6. 测试

- Host：`crates/host-core/src/sessions.rs`（`delete_message_*`、`activate_message_revision_without_a_prefix_*`、`a_top_level_window_*`、`a_delegate_window_*`）、`crates/host-core/src/transcripts_layout_tests.rs`（`the_layout_records_each_lines_delegate_parent_and_persists_it`）。
- Desktop：`apps/desktop/test/session-read-bounds.test.mjs`、`apps/desktop/test/tool-result-display.test.mjs`、`apps/desktop/test/conversation-read.test.mjs`、`apps/desktop/test/delete-message-preserves-transcript.test.mjs`、`apps/desktop/test/transcript-reading.test.mjs`、`apps/desktop/test/delegate-rows-on-demand.test.mjs`、`apps/desktop/test/transcript-window.test.mjs`、`apps/desktop/test/session-switch-performance.test.mjs`，以及 `apps/desktop/test/renderer-recovery.test.mjs`（upstream 的契约）。

## 7. 相关 upstream 页面

`03-runtime/01-ipc-protocol.md`（渲染层 `session/get` 与 `sessionDeleteMessage`）、`03-runtime/04-data-storage.md`（layout 缓存格式 3）、`03-runtime/06-host-rpc-protocol.md`（`session.get` 选项、`session.deleteMessage`、`session.activateRevision`）、`03-runtime/09-logging-and-observability.md`（`renderer.process.gone`）与 `04-ux/08-component-spec.md`（会话小地图与对话记录历史）。
