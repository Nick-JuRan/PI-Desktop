# AGENTS.md — fork-owned directory

Scope: agent-runtime logic for fork features (delegation depth and anything that must change how `runtime.ts` behaves). This directory is an **island** of the fork
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

- `runtime.ts` is the hottest upstream file in the repository. Put the rule in
  a module here and leave `runtime.ts` a one-line call or a thin private
  wrapper. Prompt changes go through a wrapper that receives upstream's
  literal untouched (see `delegation-depth.ts`,
  `withNestedDelegationGuidance`); at the upstream default the composed
  prompt must stay byte-identical to upstream.
- Import upstream modules with relative `../x.js` paths; import fork shared
  symbols from `@pi-desktop/shared/fork`.

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
