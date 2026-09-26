# 90-05. Windows test-gate portability

Fork feature. The fork is developed and validated on Windows, so a few of
upstream's test gates and E2E scripts carry Windows-safe adaptations. These are
integration points in upstream files (registered in `FORK.md`), not islands;
each one is a candidate to send upstream as a `fix` and retire from the fork.
Upstream has already absorbed one such change (host-core test path joins,
vastsa/PI-Desktop#1103), which is the intended life cycle for this page.

## 1. Adaptations

The complete file list with line counts is the "windows portability /
test-gate adaptations" group in `FORK.md`. By category:

- **E2E scripts** — `scripts/e2e-keep-awake.mjs`: on Windows,
  `powercfg /requests` is asserted only when no other Electron power request is
  present and the runner can query it; an elevation-required response skips
  only that OS-level assertion and logs `SKIP`, while the Electron/Host profile
  assertion, controller lifecycle, and Host settings round-trip still run.
  `scripts/e2e-image-chat.mjs`: release-artifact and restart checks that do not
  assume a POSIX shell.
- **Desktop source-contract tests** — path- and line-ending-tolerant
  assertions (CRLF checkouts, `path.join` instead of `/` literals, Windows
  drive letters) in `apps/desktop/test/*.test.mjs` and the shared
  `apps/desktop/test/helpers/domain-source.mjs`; the macOS signing and release
  verification tests skip cleanly on a Windows runner instead of failing.
- **pi-host** — `apps/pi-host/src/host-operations.ts` and its tests resolve
  paths portably.
- **host-core tests** — expectations built with `Path::join` so they hold on
  Windows separators (`sessions/fork_files.rs`, `user_skills/tests.rs`,
  `mcp_servers/tests.rs`).
- **Build gates** — `apps/desktop/package.json` script portability,
  `apps/desktop/electron/main/logger.ts`, and `docs/architecture/allowlist.json`
  entries that keep the architecture check green on the fork's file set.

## 2. Rules for this page

- An adaptation must not change the behavior the upstream test verifies; it may
  only make the same verification hold on Windows or skip an OS-level assertion
  the runner cannot perform, and must say so in the test output.
- When upstream lands an equivalent change, the fork delta is dropped in the
  next sync (see `FORK-STANDARD.md` C2 rule 8) and the entry is removed here.

## 3. E2E scenarios

The upstream scenarios themselves are unchanged. The keep-awake scenario in
`06-delivery/04-e2e-test-plan.md` runs as written; on a Windows runner whose
shell cannot query `powercfg /requests`, the script reports the skipped
OS-level assertion instead of failing.
