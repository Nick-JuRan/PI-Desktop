# 90-05. Windows 测试门禁可移植性

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/05-windows-portability) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。fork 在 Windows 上开发和验证，因此 upstream 的少数测试门禁和 E2E 脚本带有 Windows 安全的适配。这些是 upstream 文件里的集成点（登记在 `FORK.md`），不是岛屿；每一项都是可以作为 `fix` 提交给 upstream、然后从 fork 退役的候选。upstream 已经吸收了其中一项（host-core 测试路径拼接，vastsa/PI-Desktop#1103），这正是本页内容预期的生命周期。

## 1. 适配项

带行数的完整文件清单见 `FORK.md` 中的 "windows portability / test-gate adaptations" 分组。按类别：

- **E2E 脚本**——`scripts/e2e-keep-awake.mjs`：在 Windows 上，只有当基线没有其它 Electron 电源请求且运行器有权限查询时才断言 `powercfg /requests`；要求提升权限的响应只跳过这一条系统级断言并输出 `SKIP`，Electron/Host 配置断言、控制器生命周期和 Host 设置往返仍然运行。`scripts/e2e-image-chat.mjs`：不假定 POSIX shell 的发布产物与重启检查。
- **桌面源码契约测试**——`apps/desktop/test/*.test.mjs` 与共享的 `apps/desktop/test/helpers/domain-source.mjs` 中容忍路径与换行差异的断言（CRLF 检出、用 `path.join` 代替 `/` 字面量、Windows 盘符）；macOS 签名与发布校验测试在 Windows 运行器上干净地跳过而不是失败。
- **pi-host**——`apps/pi-host/src/host-operations.ts` 及其测试以可移植方式解析路径。
- **host-core 测试**——用 `Path::join` 构造测试期望，使其在 Windows 分隔符下成立（`sessions/fork_files.rs`、`user_skills/tests.rs`、`mcp_servers/tests.rs`）。
- **构建门禁**——`apps/desktop/package.json` 脚本可移植性、`apps/desktop/electron/main/logger.ts`，以及让架构检查在 fork 文件集上保持绿色的 `docs/architecture/allowlist.json` 条目。

## 2. 本页规则

- 适配不得改变 upstream 测试所验证的行为；它只能让同样的验证在 Windows 上成立，或跳过运行器无法执行的系统级断言，并且必须在测试输出中说明。
- 当 upstream 落地等价改动时，fork 差异在下一次同步中删除（见 `FORK-STANDARD.md` C2 第 8 条），并从本页移除对应条目。

## 3. E2E 场景

upstream 的场景本身不变。`06-delivery/04-e2e-test-plan.md` 中的 keep-awake 场景按原文运行；在 shell 无法查询 `powercfg /requests` 的 Windows 运行器上，脚本报告被跳过的系统级断言而不是失败。
