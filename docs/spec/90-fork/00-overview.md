# 90-00. Fork overview

This section belongs to the fork `Nick-JuRan/PI-Desktop`. Upstream
(`vastsa/PI-Desktop`) does not have it, so nothing here can conflict during
an upstream sync. Every fork-specific specification and E2E scenario lives in
this section; the upstream pages under `01`–`08` stay byte-identical to
upstream except for the one-line notes listed in `FORK.md`.

## 1. Why a separate section

The fork carries a small number of private features on top of upstream. The
repository policy for that is `FORK-STANDARD.md` at the repository root:
fork code lives in fork-owned files ("islands"), upstream files receive at
most one-line hooks, and fork documentation lives here rather than inside
upstream specification pages. `docs/spec/06-delivery/04-e2e-test-plan.md`
alone changes upstream hundreds of times a week; keeping fork scenarios out
of it is what makes `Sync fork` merge cleanly.

## 2. Fork features and their pages

- **Subagent depth** — bounded nested delegation controlled by
  `AppSettings.maxSubagentDepth`. See `01-subagent-depth.md`.
- **Subagent tool selection** — explicit Skill / MCP / plugin / trusted
  extension tool grants for a delegate definition. See
  `02-subagent-tool-selection.md`.
- **Fusion Search plugin** — `Extensions/fusion-search`, an authenticated
  semantic search plugin. See `03-fusion-search.md`.
- **Classification query plugin** — `Extensions/classification-queryer`, an
  IPC/CPC classification tree tool. See `04-classification-query.md`.
- **Windows test-gate portability** — Windows-safe adaptations of upstream's
  test gates and E2E scripts. See `05-windows-portability.md`.

## 3. How fork pages relate to upstream pages

Each page names the upstream specification sections it extends and the
upstream behavior it changes. Where the fork changes behavior an upstream page
describes (for example, delegation tools scoped to the calling agent), the
upstream page carries a single note pointing here and otherwise keeps
upstream's wording; this page is the authoritative description of the fork's
behavior.

## 4. Conventions

- New fork pages go in this directory with a `NN-slug.md` name and a Chinese
  mirror under `docs/zh-CN/spec/90-fork/`; both are listed in `NAV.md`.
- Fork ADRs use slug ids (`docs/adr/<slug>.md`) and are cited as `ADR <slug>`.
- Fork E2E scenario ids use a feature prefix (`E2E-SUBAGENT-…`,
  `E2E-PLUGIN-…`) rather than upstream's numeric sequence.
- Every upstream file a fork feature touches is registered in `FORK.md`.
