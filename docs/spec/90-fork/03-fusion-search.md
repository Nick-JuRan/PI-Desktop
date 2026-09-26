# 90-03. Fusion Search plugin

Fork feature. `Extensions/fusion-search` is a fork-owned plugin loaded through
the regular plugin mechanism; it hooks no upstream file. Its authoring
documentation is `Extensions/fusion-search/README.md`; this page holds the
specification-level contract and the E2E scenario.

## 1. Scope

- The plugin authenticates against an intranet search service with a dedicated
  test account kept only in the plugin's private settings, and exposes semantic
  baseline preparation for one patent claim at a time.
- The agent-facing tool is `fusion_semantic_baseline` with exactly two actions:
  `prepare` (creates a remote baseline and returns claim-scoped terms and
  weights) and `update_terms` (corrects those lists). Both actions mutate remote
  state and are never automatically replayed after an ambiguous remote outcome.
- Credentials and tokens never appear in tool arguments, results, or logs.
- Boolean search and result-reading tools live beside the baseline tool; see the
  README for their contracts.

## 2. E2E scenarios

#### E2E-PLUGIN-fusion-search-authenticated-semantic-baseline

- **Preconditions**: The `local.fusion-search` development plugin is loaded; a
  dedicated intranet test account is configured only in that plugin's private
  settings; the declared authentication and search hosts are reachable; the
  user grants the manifest's requested high-risk permissions; a controlled
  test claim reference is available. `prepare` creates a remote baseline, so
  use only a test case or target-claim text approved for that side effect.
- **Steps**: 1) Start with no stored token. 2) Invoke
  `fusion_semantic_baseline` with `action=prepare`, an explicit
  `reference_kind` (`application_number`, `publication_number`, or `text`), and
  the controlled reference. For `text`, provide your own concise paraphrase of
  the technical solution in that claim; do not copy it verbatim or use the
  whole application.
  3) Inspect the returned `element_id` and Chinese/English terms and weights,
  comparing them to that one claim. 4) If needed, invoke `update_terms` with
  corrected lists. Inspect plugin settings without displaying credentials or
  token values.
- **Expected**: The first call completes the built-in login chain, persists a
  usable token in the plugin-private settings, and returns the baseline terms
  and weights immediately. The workflow targets one specified claim, not the
  whole application; do not assume a case-number response is already
  claim-specific. Prefer an application/publication number, refine its terms
  with `update_terms`, and fall back to your own paraphrase of the target
  claim's technical solution when the case-number baseline remains unsuitable.
  Neither credentials nor token appear in tool arguments, results, or logs. The
  tool exposes exactly `prepare` and `update_terms`; both actions mutate remote
  state and are never automatically replayed after an ambiguous remote outcome.
- **Specs linked**: this page; `07-plugins/03-plugin-api.md`;
  `07-plugins/13-plugin-permissions-matrix.md`; `Extensions/fusion-search/README.md`
- **Acceptance**: Plugin authentication, private persistence, and semantic
  baseline preparation with immediate term output
- **Status**: Automated unit/integration coverage under
  `Extensions/fusion-search/test`; live intranet test requires the dedicated
  test account and reachable service
