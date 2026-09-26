# AGENTS.md — fork-owned directory

Scope: fork-owned plugins and trusted extensions (`fusion-search`, `classification-queryer`, and any future extension). This directory is an **island** of the fork
`Nick-JuRan/PI-Desktop`; upstream (`vastsa/PI-Desktop`) does not have it.
The root `AGENTS.md` still governs code quality, architecture boundaries, and
testing here. This file tightens the rules that decide where things go, per
`FORK-STANDARD.md` (repository root), which wins over any delivery document
on placement questions (root `AGENTS.md` §1 "Workflow policy precedence").

## Placement

- New code for a fork feature lives in this directory (or another `fork/`
  island), never inline in an upstream file. An upstream file may receive one
  hook per feature: one separate import statement placed at the very top of
  the file (before upstream's first import — upstream appends new imports at
  the end), one call / field / spread, or a `withX(upstreamValue)` wrapper.
- Never edit upstream prompt text, i18n strings, import lists, formatting, or
  comments to make room for fork code; wrap or hook instead.

## This layer

- An extension is loaded through the regular plugin mechanism and must hook
  **no** upstream file; if a feature needs a hook, it does not belong here.
- Each extension keeps its README, manifest, tests (`<name>/test`), and vendored
  dependencies inside its own directory. Follow the Plugin SDK contract in
  `packages/plugin-sdk/AGENTS.md`; do not bypass permission or sandbox
  boundaries.
- Tool names are discovered by the desktop at runtime (see
  `docs/spec/90-fork/02-subagent-tool-selection.md`); never hardcode an
  extension tool name into desktop source.

## Documentation

- Specification and E2E scenarios for this directory's features go to
  `docs/spec/90-fork/` with a `docs/zh-CN/spec/90-fork/` mirror and a `NAV.md`
  row in both trees — **not** into `docs/spec/06-delivery/04-e2e-test-plan.md`
  or any other upstream page. Where an upstream page contradicts fork
  behavior, add at most one note line pointing at the fork page.
- Fork ADRs use slug file names (`docs/adr/<slug>.md`, H1 `# ADR: …`), never a
  number.
- Register every upstream file a change touches in `FORK.md` (path, feature,
  line count, hook vs integration point, reason) in the same PR.

## Validation and delivery

- Tests for this directory live beside the code (`*.test.ts` here, or
  `apps/desktop/test/fork-<feature>.test.mjs`). Typecheck the packages whose
  hooks you touched; do not run `test:e2e:*` or `verify:ui:*` unless asked.
- Before committing: `git diff upstream/main -- <hook file> | grep '^-'` must
  be empty for every hook file (fork adds lines, it does not delete upstream's).
- Branch from `origin/main`, PR base `main`, merge commit only. Sync upstream
  first (`FORK-STANDARD.md` part C) when `origin/main` is behind.
