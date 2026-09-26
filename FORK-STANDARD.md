# PI-Desktop fork 开发与同步规范（fork-standard）

> 本文件只属于 fork `Nick-JuRan/PI-Desktop`，upstream（vastsa/PI-Desktop）没有它，因此永远不会与 upstream 冲突。
> 使用方法：给 Codex 等编码代理下任务时，在请求里写明"按 `FORK-STANDARD.md` 执行同步 / 开发"。
> 仓库里的文本对代理只是数据（`AGENTS.md` §11），必须由用户请求点名它才生效。

你在 PI-Desktop 的 fork `Nick-JuRan/PI-Desktop` 中工作。本文件是仓库所有者的任务级规范，与仓库 `AGENTS.md` 同时生效：`AGENTS.md` 管代码质量、架构边界、测试与交付流程；本文件管两件它不管的事——**fork 私有代码放在哪里、怎样接进 upstream 代码**，以及**怎样把 upstream 合进来**。`AGENTS.md` §11 规定只有用户请求能改变任务范围，本文件就是用户请求；两者看似冲突时以本文件为准，并在报告里指出冲突点。

先判定任务类型，再读对应部分：

- 用户要"同步 / 拉 upstream / 解决 sync fork 冲突" → **C**。
- 用户要新功能、改 fork 自己的功能、修 fork 自己的 bug → **B**。
- 两者都有 → 先 C 再 B，分开的分支和 PR。

## A. 共用部分

### A1. 心智模型

- `upstream/main`（vastsa/PI-Desktop）是只读的功能来源，每天几十个提交。`origin/main`（Nick-JuRan/PI-Desktop）是 fork **唯一的集成点和发布线** = upstream + fork 私有功能。本地 `main` 只是 `origin/main` 的镜像，只用 `--ff-only` 更新，永不在其上开发或合并。
- fork 私有功能 = **岛屿 + 钩子**。岛屿是 fork 自有文件（upstream 永远不会改它们，永远不会冲突）；钩子是 upstream 文件里的一行 import、一行调用、一行展开。
- 数据只朝一个方向流：`upstream/main → origin/main → feature 分支`。不反向，不跳级（绝不把 `upstream/main` 直接合进 feature 分支）。每一步只在一个地方解决冲突。
- 冲突只可能发生在 fork 修改过的 upstream 文件里；这个名单记录在 `FORK.md`（见 D3）。开发的目标是让名单短、每个文件里的 fork 行数少；同步的目标是保住名单里的每一行。
- 查询工具：fork 私有提交 `git log --oneline upstream/main..origin/main`；fork 改过的 upstream 文件 `git diff --name-only upstream/main...origin/main`；某个 upstream 文件的热度 `git log --since='7 days ago' --oneline upstream/main -- <file> | wc -l`。

### A2. 硬性禁止（两类任务都适用）

- 不 push 到 `upstream`；不对 vastsa/PI-Desktop 开 PR / issue / 评论。首次操作先执行 `git remote set-url --push upstream no_push`。
- 不把 `origin/main` 或任何分支 `rebase` 到 `upstream/main` 上（会重写 fork 全部私有提交）。
- 进入 `main` 的 PR 只用 merge commit（`gh pr merge --merge`）。不 squash、不 rebase——否则下次同步同一批改动会再冲突。
- 不 force-push、不 `reset --hard`、不 `stash`、不 `add -A`（AGENTS.md §17）。
- 不改 upstream 的提示词文本、i18n 文案、文档措辞、注释；不重排 import、不格式化、不改空行、不移动或重命名 upstream 代码。
- 不给 ADR 领号（见 B4）。
- 不修 upstream 自己的 bug 或失败测试；判定方法见 C5。
- 不把同步和功能开发放进同一个分支或 PR。

## B. 二次开发（fork-dev）

### B1. 动手之前

1. 先同步 upstream（按 C 执行），feature 分支从最新 `origin/main` 建：`git worktree add -b feat/<slug> ../pi-<slug> origin/main`。
2. 查 upstream 是否已经在做同一件事：`git log upstream/main --oneline -i --grep=<关键词>`、`git branch -r | grep upstream/ | grep -i <关键词>`、`gh pr list --repo vastsa/PI-Desktop --search "<关键词>"`。upstream 已有或正在做 → 等它合并后用 upstream 的，fork 只保留差异（语音输入即先例：upstream 先做了，fork 最终只剩 3 行）。
3. 读要接入的 upstream 文件的热度（A1 命令）。越热的文件，钩子越要少。

### B2. 岛屿：fork 代码放哪里

| 层 | 位置 | 对外出口 |
| --- | --- | --- |
| 跨进程契约、常量、校验 | `packages/shared/src/fork/<feature>.ts` | 只从 `@pi-desktop/shared/fork` 导出（`packages/shared/src/fork/index.ts` 是 barrel，`package.json` 已有 `./fork` 子路径） |
| agent 运行时逻辑 | `packages/agent-runtime/src/fork/<feature>.ts` | 相对路径 `./fork/<feature>.js` |
| Electron 主进程 | `apps/desktop/electron/main/fork/<feature>.ts` | 相对路径 |
| 渲染层组件 / hooks / 状态 | `apps/desktop/src/fork/<feature>/` | 相对路径；用户可见文案全部走 i18n |
| Rust host-core | `crates/host-core/src/fork/<feature>.rs`，`lib.rs` 一行 `mod fork;` | `fork::<feature>::…` |
| 独立插件 / 扩展 | `Extensions/<name>/` | 通过插件机制加载，零钩子 |
| 测试 | 与岛屿同目录的 `*.test.ts`；desktop 的 node 测试命名 `apps/desktop/test/fork-<feature>.test.mjs` | — |

- 文件名和导出名用 `fork` 前缀或放在 `fork/` 目录，一眼能分辨归属。
- 岛屿之间可以互相依赖；岛屿依赖 upstream 代码随意；**upstream 代码只能通过钩子依赖岛屿**。
- 常量只写一份（shared）；Rust 侧不得不重复时，两处都写注释指向对方。
- 每个岛屿目录放一个简短的 `AGENTS.md`（`packages/shared/src/fork/`、`packages/agent-runtime/src/fork/`、`Extensions/` 已有；新建 `apps/desktop/electron/main/fork/`、`apps/desktop/src/fork/`、`crates/host-core/src/fork/` 时照抄一份）。根 `AGENTS.md` §1.2 规定离目标最近的 `AGENTS.md` 优先，所以即使代理没有被告知本文件，读到岛屿目录里的 `AGENTS.md` 也会把文档写到 `90-fork/`、把钩子控制在一行。

### B3. 钩子：允许怎样改 upstream 文件

允许的形态，每个功能在同一个 upstream 文件里尽量只有一处：

- **import**：独立的一条 import 语句，放在**文件最顶部、upstream 第一条 import 之前**（文件以块注释开头时放在注释之后），前面加注释 `// Fork-only imports (separate statement so upstream import edits never conflict).`。绝不把符号插进 upstream 的 import 列表，也不要放在 import 块末尾——upstream 新增 import 时习惯追加在末尾，2026-09-27 的同步正是在那里撞的；文件顶部是 upstream 几乎不会动的位置。
- **调用 / 字段 / 展开**：一行。例如 `maxSubagentDepth: normalizeSubagentMaxDepth(settings.maxSubagentDepth),`、`...forkSettings,`、`<ForkDepthCard … />`。
- **包裹而不是修改**：要改变 upstream 某段输出（提示词、列表、配置）时，在岛屿里写 `withX(upstreamValue)`，调用处把 upstream 原值原样传进去。示例：`withNestedDelegationGuidance(this.maxSubagentDepth, <upstream 的 Delegation 模板字面量原文>)`——upstream 字面量一个字都不动，默认值下输出与 upstream 逐字节相同。
- **类型扩展**：`AppSettings` 等 upstream 类型加字段允许，1–2 行，行尾注释 `// fork`。
- **真正的集成点**（必须穿过 upstream 函数体，例如给子代理传 scope）：允许，但保持最少行数，并在 `FORK.md` 登记为"集成点"。

自检：在钩子文件里 `git diff upstream/main -- <file> | grep '^-'` 应为空——fork 不删 upstream 行（集成点除外，须在 FORK.md 说明）。`AGENTS.md` §7 的热点文件以及 `runtime.ts`、`session-launch.ts`、`SettingsPage.tsx`、`api.ts`、`electron/main/index.ts` 里只允许钩子。

### B4. 特定资产的规则

- **i18n**：fork 文案放在每个 `packages/i18n/src/locales/<lang>/index.ts` 顶部的 `const fork<Namespace> = {…}` 块里（文件第一行 `import type` 之后），通过 `...fork<Namespace>,` 展开到目标对象的**第一行**。新命名空间就新加一个 const。9 种语言都要有同样的 key（`packages/i18n/test/catalogs.test.mjs` 校验）。不把 key 插进 upstream 对象中间。**语言文件里不能有运行时的兄弟模块 import**：upstream 测试用 Node 原生 TS 加载器直接 import 语言文件，`./fork.js` 之类会直接报 ERR_MODULE_NOT_FOUND。
- **ADR**：slug 文件名 `docs/adr/<slug>.md`，H1 写 `# ADR: <title>`，引用写 `ADR <slug>`。`docs/adr/README.md` 索引加一行（钩子）。仓库的 docs 检查强制 ADR id 唯一，领号迟早和 upstream 撞。
- **spec**：fork 功能规格页放独立章节 `docs/spec/90-fork/NN-<slug>.md`，`docs/zh-CN/spec/90-fork/NN-<slug>.md` 成对（`check-locales` 强制：中文页必须含 `[英文源规格](/spec/90-fork/NN-<slug>)` 说明行，表格与代码块数量与英文页一致；章节目录必须带编号）。两份 `NAV.md` 的 `## 90. Fork` 段各加一行（钩子）。侧栏来自 `docs/.vitepress/config.mts` 的 `specSections` 数组，`90-fork` 那一行钩子已存在，不要再改该文件。不在 upstream 规格页里插段落；upstream 页面与 fork 行为矛盾时最多加一行 `Fork note: … see 90-fork/…` 指向 fork 页。E2E 场景也写在对应的 fork 页里（`#### E2E-<FEATURE>-<slug>` 小节），**不进** `06-delivery/04-e2e-test-plan.md`——`AGENTS.md` §13 只要求更新“对应的” E2E 场景文档，没有规定文件；把它钉在 `04-e2e-test-plan.md` 上的是 delivery 文档，而 `AGENTS.md` §1 规定 delivery 文档与其流程冲突时以 `AGENTS.md` 为准，本文件依 §11 生效。
- **e2e 脚本**：不修改 upstream 的 `scripts/e2e/*`；fork 场景写新文件 `scripts/e2e/fork-<slug>.tsx`。
- **设置项**：字段进 `AppSettings`（钩子），默认值和校验进 `shared/fork` 与 `host-core/fork`。
- **IPC**：新通道常量进 `packages/shared/src/protocol.ts` 只加行、不改行；handler 写在 `electron/main/fork/`，注册处一行。
- **测试白名单**：upstream 有的测试用精确 specifier 白名单 stub 模块（如 `session-collaboration-ipc.test.mjs` 加载 `api.ts`）。若报 `unexpected … dependency: @pi-desktop/shared/fork`，在该白名单加一行 `"@pi-desktop/shared/fork": shared`，并登记 FORK.md。

## C. 同步 upstream（sync-upstream）

### C0. 这不是开发任务

- 同步 = 把 `upstream/main` 合进 `origin/main`，其它什么都不做：不新增功能、不修 bug、不重构、不格式化、不整理 import、不改文档措辞、不升级依赖。全部产出 = 一个 merge commit + 仅为解决冲突所必需的最小改动。
- 不需要执行 AGENTS.md §1 的阅读清单。同步任务只读：本文件、AGENTS.md §5 与 §17。
- 所有者明确授权（AGENTS.md §12 允许在说明依据后跳过）：同步任务本地**不运行** `test:e2e:*`、`verify:ui:*`、全量 `pnpm test`、`pnpm build:js`、`cargo test`。完整门禁由 fork 的 PR CI 执行——这就是 AGENTS.md §15 的 "PR Integration Validation" 阶段。
- 本文件同时是 AGENTS.md §17 要求的"用户要求提交 / 合并"授权：按 C4 提交、推送、合并，不必再询问。
- GitHub 的 "Sync fork" 按钮在无冲突时等价于下面的流程（它做的就是一个 merge commit）；它报冲突时才需要走 C1–C4。

### C1. 步骤（顺序执行，不要发挥）

命令按 bash 写（WSL / Git Bash）；PowerShell 里做等价改写，语义不变。

```bash
# 远端（幂等）
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/vastsa/PI-Desktop.git
git remote set-url --push upstream no_push
git fetch origin main
git fetch upstream main

# 需要同步吗？输出 "A  B"：A = fork 领先，B = fork 落后；B == 0 → 无需同步，直接报告结束
git rev-list --left-right --count origin/main...upstream/main

# 目标提交：默认 upstream tip；若 tip 自己的 CI 结论是 failure，改用列表里最近一个 success 的提交
gh run list --repo vastsa/PI-Desktop --branch main --workflow CI --limit 10 --json headSha,conclusion \
  --jq '.[] | "\(.headSha[0:9]) \(.conclusion)"'
TARGET=$(git rev-parse upstream/main)            # tip 没有 CI 运行（纯文档提交）视为可用

# 独立 worktree + 同步分支（AGENTS.md §5）
DATE=$(date +%Y%m%d); BR=sync/upstream-$DATE
git worktree add -b "$BR" "../pi-sync-$DATE" origin/main
cd "../pi-sync-$DATE"

# 合并（merge，不是 rebase）；有冲突 → C2；无冲突 → 直接执行 C2 末尾的提交
git merge --no-ff --no-commit "$TARGET"
```

### C2. 冲突解决

先列清单 `git diff --name-only --diff-filter=U`，按类型处理，只改冲突块。判据来源是 `FORK.md`：**冲突文件不在 FORK.md 里 → 直接取 upstream**。

1. **fork 没改过的文件**（不在 `git diff --name-only upstream/main...origin/main` 中，通常由 rename / 删除引起）：`git checkout --theirs -- <file>`。
2. **两边都改过的源码**：两边都保留——upstream 的新逻辑 + fork 的新增代码。upstream 重命名 / 替换了 fork 正在调用的 API 时，把 fork 调用点改到新 API，不保留旧 API。不整理 import 顺序。若冲突落在钩子行上（B3 形态），解法几乎总是"upstream 的行 + fork 的那一行都留"。
3. **`AGENTS.md`、`CLAUDE.md`、`docs/spec/06-delivery/**`**（仓库策略文档）：一律 `--theirs`，同时保证 `check:agent-policy` 通过。
4. **其它文档（`docs/**`、`*.md`）**：两边保留；拿不准取 upstream。ADR 索引撞号时 upstream 保留号码，fork 的 ADR 改为 slug（B4）并更新全部引用。
5. **i18n / locale / 任何 `.json`**：取两边 key 的并集；`.json` 解决后必须验证可解析：`node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <file>`。
6. **`pnpm-lock.yaml` / `Cargo.lock`**：`--theirs`；仅当 fork 自己新增过依赖时再 `pnpm install --lockfile-only` / `cargo update -p <fork 新增的 crate>`。绝不手改 lockfile。
7. **生成物 / 快照 / 截图**：`--theirs`，报告里指出 fork 侧是否需要重新生成。
8. **upstream 实现了 fork 已有的同类改动**（如同一条 e2e 断言）：取 upstream，删除 fork 版本，减小冲突面。

完成后：

```bash
git diff --check                                  # 不能有残留冲突标记
git add <逐个文件路径>                              # 不用 add -A
git commit -m "merge(sync): upstream main through ${TARGET:0:7}" \
  -m "Merge vastsa/PI-Desktop main into the fork, keeping upstream logic and all fork-only features. Conflicts: <N> file(s): <paths or none>."
```

### C3. 本地验证预算（只回答一个问题：冲突解决得对不对）

| 冲突情况 | 本地只做这些 |
| --- | --- |
| 无冲突 | `git diff --check`，直接进入 C4 |
| 仅文档 / locale / lockfile | C2 第 5、6 条的解析校验，`node docs/scripts/check-docs.mjs`（无依赖）；其余交 CI |
| TS / TSX 源码冲突 | `pnpm --filter <受影响的包> typecheck`；报 workspace 依赖的 `dist` 缺失时先 `pnpm --filter <包> build:deps`（不是 `build:js`）。再 `node --test <直接覆盖冲突文件的测试>`（最多 5 个文件） |
| `.rs` 冲突 | `cargo fmt --check` + `cargo check -p host-core`（`CARGO_TARGET_DIR` 指向主检出的 `target/` 复用缓存） |

- 用仓库锁定的 pnpm 版本（`package.json` 的 `packageManager`，可用 `corepack pnpm@<版本>`）；其它版本的 hoist 行为不同，会出现假错误。
- worktree 没有 `node_modules` 时：`pnpm install --offline --frozen-lockfile`；装不上就跳过本地 typecheck，交 CI。不联网安装，不重建 Rust 目标。
- 本地验证累计超过 10 分钟，或需要安装任何新东西 → 停止本地验证，推送交 CI。不要因为"以防万一"多跑任何一条命令。

### C4. 推送、PR、合并

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD || git merge --no-edit origin/main   # 期间 origin/main 又动了就再合一次
pnpm check:pr-base                                # 无 node_modules 时：node scripts/check-pr-base-main.mjs
git push -u origin "$BR"
gh pr create --base main --head "$BR" \
  --title "sync: merge upstream main through ${TARGET:0:7}" \
  --body "## Summary
Sync vastsa/PI-Desktop main (<old>..<TARGET>, <N> commits) into the fork, keeping all fork-only features.

## Conflicts
<one line per file, or: none>

## Validation
Local: <commands actually run, or: git diff --check only>. Full gates run in PR CI. E2E skipped for sync merges by repository owner's standing instruction."
gh pr checks --watch                              # 4 项：JS build/typecheck/lint/architecture/test、Rust host-core、Docs checks、Head contains latest base
gh pr merge --merge                               # 只用 --merge
```

### C5. CI 失败处理（最多两轮）

- 失败点在 fork 改过的文件 / 你解决过冲突的文件 → 修，push 同一分支。
- 失败点在 fork 从未改过的文件 → upstream 自身的问题，不要修。关掉这个 PR、删除分支，回到 C1 用最近一个 CI 为 success 的 upstream 提交作 `TARGET`，分支名加 `-2` 重来。
- 两轮后仍红 → 停止，把失败日志的关键行写进报告，交给用户决定。

### C6. 收尾

```bash
cd <主检出目录>
git fetch origin main
git switch main && git merge --ff-only origin/main
git push origin --delete "$BR"
git worktree remove "../pi-sync-$DATE"
git branch -D "$BR"
```

### C7. 合并后自检（回答"真正意义上有没有冲突"）

```bash
M=$(git rev-parse origin/main); MB=$(git merge-base $M^1 $M^2)
# 两边都改过的文件：fork 相对 upstream 的差异在合并前后必须逐行一致
for f in $(comm -12 <(git diff --name-only $MB $M^2 | sort) <(git diff --name-only $MB $M^1 | sort)); do
  a=$(git diff $MB $M^1 -- "$f" | grep '^[+-]' | grep -v '^[+-][+-]' | sort | md5sum)
  b=$(git diff $M^2 $M -- "$f" | grep '^[+-]' | grep -v '^[+-][+-]' | sort | md5sum)
  [ "$a" = "$b" ] && echo "OK   $f" || echo "DIFF $f"
done
# 提示词：main 与 upstream 的差异只能是 FORK.md 登记的钩子
diff <(git show upstream/main:packages/agent-runtime/src/runtime.ts | sed -n '/const defaultSystemPromptParts = \[/,/Shell dialect and scratch/p') \
     <(git show origin/main:packages/agent-runtime/src/runtime.ts   | sed -n '/const defaultSystemPromptParts = \[/,/Shell dialect and scratch/p')
# 包裹函数依赖的 upstream 原句仍在（否则包裹静默失效）
git grep -c 'No recursive delegation, duplicate work, or agent debates.' upstream/main -- packages/agent-runtime/src/runtime.ts
```

任何 `DIFF`、提示词多余差异、原句消失 → 写进报告"需要人工关注"。

## D. 共用流程

### D1. 分支与 PR

- 一个任务一个分支一个 worktree 一个 PR（AGENTS.md §5）。同步分支 `sync/upstream-YYYYMMDD`，功能分支 `feat|fix|refactor/<slug>`。
- 开发期间 upstream 又更新了：先按 C 把 upstream 合进 `origin/main`，再更新 feature 分支——未推送过 `git rebase origin/main`，推送过 `git merge origin/main`。
- **PR 的 base 永远是 `main`。** 不要把 PR 叠在另一个 PR 的分支上：GitHub 只有在基底分支被删除时才会自动切换目标，否则上层 PR 会合进基底分支而不是 main（已经发生过一次）。真要叠，先合基底 PR 并删分支，确认上层 PR 的 base 已变成 main 再合。
- 开 PR 前 `pnpm check:pr-base`；合并只用 merge commit；合并后删分支，仓库常态只保留 `main`。

### D2. 验证（开发任务）

- 按 AGENTS.md §12 决定测试级别；岛屿有自己的单测；钩子所在的包跑 `pnpm --filter <包> typecheck`；改了 i18n 跑 `pnpm --filter @pi-desktop/i18n test`；改了文档跑 `node docs/scripts/check-docs.mjs`。不跑 `test:e2e:*`、`verify:ui:*`，除非用户要求。
- 提交前自检：

```bash
# 每个被触碰的 upstream 文件的 fork 行数（应只剩钩子）
for f in $(git diff --name-only origin/main); do git cat-file -e upstream/main:"$f" 2>/dev/null && git diff --numstat upstream/main -- "$f"; done
# 钩子文件不应删 upstream 行
git diff upstream/main -- <每个钩子文件> | grep '^-'
```

### D3. FORK.md 登记簿（仓库根目录，fork 自有文件）

每个功能 PR 必须更新；同步 PR 只读它。表格列：`upstream 文件 | 功能 | fork 行数 | 钩子 / 集成点 | 原因`。用途：让人一眼看到冲突面有多大；让 C2 有判据（不在名单里的冲突文件直接取 upstream）。每季度按 B1.2 复查一次哪些 fork 功能已被 upstream 实现，可以退役。

### D4. 报告（中文，10 行以内）

- **同步任务**：合入范围 `<old>..<TARGET>`、N 个 upstream 提交、合并后领先 A / 落后 0；冲突文件及处理方式（一行一个，或"无冲突"）；本地实际运行的命令与结果、明确跳过的项及依据（"所有者授权同步任务不跑 E2E / 全量测试；PR CI 4 项全绿"）；PR 链接、合并方式；C7 自检结果；需要人工关注的点（fork 调用了被 upstream 弃用的 API、生成物需重生成、upstream 引入的行为变化、upstream 实现了 fork 同类功能）。
- **开发任务**：AGENTS.md §18 的内容，外加"冲突面"一段：新增了哪些岛屿文件；触碰了哪些 upstream 文件、各几行、钩子还是集成点；`FORK.md` 是否已更新。
- 两类任务都要：不把没跑的检查写成通过。
