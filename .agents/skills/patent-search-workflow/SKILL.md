---
name: patent-search-workflow
description: 主代理用：对一份专利申请执行完整的现有技术检索工作流——申请文件整理、理解发明、分类、关键词、特征基准、语义基准、五库并行检索与全文阅读对比、汇总报告。主代理只委派和验收，不检索、不阅读。用户要求"检索这份申请/找对比文件/做新颖性创造性检索"时加载。
---

# 专利检索工作流（主代理）

你是调度者和验收者。所有实际工作由 7 个子代理完成；你不调用检索、翻页、全文工具，不读对比文件，不自己拆特征。你只做三件事：按顺序委派、按清单验收、最后汇总。

## 输入

- 申请材料：工作区内的文件路径或用户内联的全文。
- 目标权利要求 x：用户未指定时为 1。
- 库：默认 `CNTXT、ENTXT、ENTXTC、DWPI、VEN` 五库；用户可缩减。
- 每库轮次上限：默认 6。

## 产物目录

```text
reports/<发明名称>/
├── 申请文件/        基本信息.md  权利要求书.md  说明书.md
├── 理解发明/        权x.md
└── 检索/
    ├── 特征基准.md            全部权利要求的特征编号 x.n（冻结）
    ├── 特征对比表.md          全申请唯一一张总表（charter 建表头，阅读者只向末尾追加行，五库结束后 charter 整理合并）
    ├── 语义基准-权x.md        element_id，五库共用，并行前建好
    ├── 检索日志-权x-<库>.md   每库一份
    └── 阅读日志-权x-<库>-R<轮次>-<k>.md   每库每轮每个阅读者切片一份
```

## 流程

第 1–4a 步串行：每步 `Task` + `TaskWait`，通过验收再进行下一步。第 4b 步五库并行，第 4c 步整理总表。

### 第 1 步　整理申请文件（每份申请一次）

`Task(patent-splitter)`，简报：工作区、申请材料路径或内联全文。
验收：`status` 为 completed/partial；三个文件存在；`missing` 为空或已向用户说明。

### 第 2 步　理解发明（每个目标权x 一次）

依次：
1. `Task(patent-analyst)`，简报：报告目录、申请文件目录、权x。验收：`理解发明/权x.md` 存在，要素树已填要素名。
2. `Task(patent-classifier)`，简报：`说明书.md`、`权x.md` 路径。验收：`elements_classified = elements_total`。
3. `Task(patent-keyworder)`，简报：同上。验收：`elements_completed = elements_total`。

### 第 3 步　特征基准与空总表（每份申请一次）

`检索/特征基准.md` 不存在时 `Task(patent-claim-charter)`，简报：报告目录。
验收：各权利要求都有一节；编号连续；抽查 3 条特征原文能在 `权利要求书.md` 逐字找到；★ 已标；`检索/特征对比表.md` 已建好表头和特征原文行，且文件以特征原文行结尾。已存在则跳过。

### 第 4a 步　语义基准（每个权x 一次，并行之前）

`检索/语义基准-权x.md` 不存在时：

```text
Task(agent: "patent-searcher", description: "建立语义基准 权x", task: "任务模式：仅建立语义基准。报告目录：reports/<发明名称>；目标权利要求：权x；数据库：CNTXT。建好并写入 检索/语义基准-权x.md 后立即回执，不检索、不委派阅读者。")
TaskWait
```

验收：文件存在且含 `element_id`。没有这个文件不得进入 4b。

### 第 4b 步　五库并行检索（每个权x）

**在同一条消息里**发出全部 Task，一库一个，然后等待：

```text
Task(agent: "patent-searcher", description: "检索 权x CNTXT",  task: <简报(CNTXT)>)
Task(agent: "patent-searcher", description: "检索 权x ENTXT",  task: <简报(ENTXT)>)
Task(agent: "patent-searcher", description: "检索 权x ENTXTC", task: <简报(ENTXTC)>)
Task(agent: "patent-searcher", description: "检索 权x DWPI",   task: <简报(DWPI)>)
Task(agent: "patent-searcher", description: "检索 权x VEN",    task: <简报(VEN)>)
TaskWait(timeoutSeconds: 900)   # 超时不是失败；重复等待直到五份回执都到
```

检索者简报固定写法（只换库名）：

```text
报告目录：reports/<发明名称>
目标权利要求：权x
数据库：<库>          ← 只此一个库，不得换库
轮次上限：6
已有文件：检索/特征基准.md、检索/语义基准-权x.md、检索/特征对比表.md
要求：语义基准已存在，不得再 prepare；命中数 <400 即按页交错分片委派最多 5 个 patent-reader（每轮新开，不 resume）；汇总各切片回执的 gaps 和 search_direction 多轮调整，直到本库 done；结束时用 <patent-searcher-result> 回执。
```

并行期间：某个库的回执先到，先按下面清单验收它，再继续等其余库；不要用 `TaskStop` 打断某个库，除非用户要求。

每份 `<patent-searcher-result>` 的验收：
- `library_status: done`；`stop_reason` 为 library_done 或 max_rounds（max_rounds 时把 `gaps` 记下，汇总时说明）；
- 每轮的阅读日志 `阅读日志-权x-<库>-R<轮次>-<k>.md` 齐全，k 覆盖该轮的全部切片；各切片读过的页号互不重叠；
- `特征对比表.md` 中标注该库的行：每个"公开 / 公开（公知）"单元格都带出处（权利要求N、[NNNN]、图N）；没有"部分公开"；"类型"列与单元格一致；
- `x_list`、`y_list` 与总表"类型"列一致。
并发期间同一公开号在表中出现多行（各库各一行）是预期行为，不算不通过；第 4c 步会合并。
不通过 → 等其余库全部结束后，用同一库再派一次 `patent-searcher`（简报写明不通过的原因），单独等待。

不要自己委派 `patent-reader`：它只接受 `patent-searcher` 的委派。

### 第 4c 步　整理总表（五库回执齐全后）

```text
Task(agent: "patent-claim-charter", description: "整理总表 权x", task: "任务模式：整理总表。报告目录：reports/<发明名称>。")
TaskWait
```

验收：同一公开号只剩一行；行数等于去重后的公开号数；回执 `notes` 列出的分歧公开号在表中带有"〔… 判定：…〕"标注；表头与特征原文行未变。第 5 步只依据整理后的表。

### 第 5 步　汇总（整理完成后）

只依据整理后的 `检索/特征对比表.md`，不重读文献：

1. X 文献：类型为 X 的行，列公开号、库、每个特征的出处所在列。
2. Y 组合：类型为 Y 的行中，挑能互补覆盖权x 全部 ★ 关键特征的组合（通常两篇），写明各覆盖哪些特征编号。
3. 缺口：任何 X/Y 组合都未覆盖的特征编号；附各库回执的 `gaps`。
4. 全文不可用的高相似度文献（各库 `notes`），建议人工取全文。

报告结构：

```text
目标：权x　库：<已完成的库>　总表：reports/<发明名称>/检索/特征对比表.md
X 文献：<公开号列表或"未找到">
Y 组合：<公开号A + 公开号B：A 公开 …，B 公开 …> 或 "无可用组合"
仍未覆盖：<特征编号或 none>
需人工处理：<全文不可用的文献、max_rounds 的库；没有则 none>
```

## 多个权利要求

`特征基准.md` 和总表已含全部权利要求，不重建。对新的权y：重复第 2 步（生成 `权y.md`）、第 4a 步（权y 的语义基准）、第 4b 步和第 4c 步。

## 异常

- 子代理回执 `status: failed`：读 `notes`，修正简报后同一角色重派一次；再失败停止并报告用户。
- 4a 失败（prepare 报错）：检查 `fusion-search` 插件凭据；不要自己准备基准，不要带着缺失的基准进入 4b。
- 某库阅读者全文大量不可用（该库 `notes`）：该库结论标"初判"，汇总时单列。
- 任何子代理要求你做判断（选词、判 X/Y）：拒绝，让它按自己的提示词决定；你只验收结果。

## 前提（首次运行前确认一次）

- Settings → Agent → Subagents：Maximum subagent depth = 2；7 个代理 `patent-splitter / patent-analyst / patent-classifier / patent-keyworder / patent-claim-charter / patent-searcher / patent-reader` 均启用。
- `local.fusion-search` 插件 ≥0.6.0 已加载并配置凭据（0.6.0 起检索时冻结结果集，五库并行才不会串号）；`classification-queryer` 已授权。
- PI-Desktop 已包含 PR #45（`MAX_SUBAGENT_CONCURRENCY = 50`：五库并行最多 5 × (1 + 5) = 30 个运行中的子代理）和 PR #47（可续链按父级限额）。
- 会话权限 auto（或各代理定义里的 `permission: auto`）。
