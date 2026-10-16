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
- A Boolean search freezes its session's result set. The provider pages the
  semantically sorted list from a per-account cache holding only the latest
  semantic search, so parallel sessions overwrite each other's pages; the
  `forOverview` call made right after the search is the only read that is the
  session's own set. The plugin requests it for the whole retained set (400,
  with abstracts), validates every row's `ssId`, and serves
  `fusion_semantic_result_page` from that snapshot. Session creation and
  overview run under one in-process lock; `SEARCH_BUSY` is returned before
  anything is sent when the wait exceeds 60 s. A session without a snapshot
  falls back to the live page read with the existing integrity check.
- `fusion_full_text` reads one listed patent in full. Its only argument is the
  `pnId` shown in a result page; the plugin supplies the search session, view
  database and application number from what the Boolean search and result
  page already passed through it. The quick-view endpoint accepts exactly one
  identity per request — a single application number (with the merged
  publication list alongside), or a single publication number with no
  application number — so a listed multi-member record is reduced to those
  shapes: first the first application-number member with the merged
  publication list, then the first publication member alone. The result is
  plain reading text — all claims, then the description with the provider's
  `[000N]` paragraph numbers — never a summary, an excerpt or a paginated
  view. The call is read-only, retried once after a token refresh and declared
  `risk: low`.

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

#### E2E-PLUGIN-fusion-search-full-text-from-listed-record

- **Preconditions**: The `local.fusion-search` development plugin is loaded with
  a working account; a semantically sorted Boolean search session exists for a
  database that carries full text (CNTXT), and it lists at least one record
  whose `pnId` and `anId` each carry several `;`-joined members; the quick-view
  host is reachable.
- **Steps**: 1) Read page 1 of the session with `fusion_semantic_result_page`
  and note one record's `pnId`, preferring a multi-member one. 2) Call
  `fusion_full_text` with exactly `{ "pnId": <that value> }`. 3) Call it again
  with one `;`-separated member of a multi-number `pnId`. 4) Call it with a
  pnId the plugin never listed. 5) Call it for a record the quick-view store
  has not indexed. 6) Inspect the agent transcript and the tool list in
  Settings → Agent → Subagents.
- **Expected**: Step 2 returns one plain string that starts with the pnId and
  title line, then `权利要求` with every claim, then `说明书` with heading rows
  unnumbered and paragraphs prefixed `[000N]`; no HTML, no JSON wrapper, no
  additional fields. The request carried the session's `ssid` header, the
  first application-number member as `anid`, the merged publication list as
  `pnid`, the database as `viewDb`, and no search history was created. Step 3
  returns the same document; a multi-member record is requested with the first
  application member plus the merged list, falling back to the first
  publication member alone, never with a `;`-joined `anid` or a merged list
  under an empty `anid`. Step 4 sends a bare request
  (`anid`/`viewDb` empty, no `ssid`, first publication member only) and either
  returns the text or the provider's refusal as an error object. Step 5 returns
  `{ ok: false, error: { code: "FULL_TEXT_UNAVAILABLE", message } }` with the
  provider's reason. The tool's schema lists `pnId` only, it is `risk: low`, and
  it appears as an individually selectable plugin tool for subagents.
- **Specs linked**: this page; `02-subagent-tool-selection.md`;
  `07-plugins/03-plugin-api.md`; `Extensions/fusion-search/README.md`
- **Acceptance**: Full-text reading with a one-argument contract and plain-text
  output; identity resolution from the plugin's own record registry
- **Status**: Unit-covered under `Extensions/fusion-search/test` (`full-text*`,
  `record-registry`, `main`, `tool-executor`); the live path is
  `test/live-full-text.test.mjs` and needs the dedicated account, a session id
  and a reachable quick-view host

#### E2E-PLUGIN-fusion-search-parallel-sessions-page-their-own-rows

- **Preconditions**: The `local.fusion-search` development plugin is loaded with
  a working account and a prepared semantic baseline; two Boolean queries with
  disjoint result sets, each with fewer than 400 hits, are available for one
  database.
- **Steps**: 1) Run `fusion_boolean_search` with query A, then immediately with
  query B. 2) Read page 1 of session A and page 1 of session B with
  `fusion_semantic_result_page`, in either order and concurrently. 3) Compare
  the pages with the first 20 rows of each session's own `forOverview`
  response. 4) Read `fusion_full_text` for a record listed in A without having
  paged A. 5) Start six Boolean searches in one message. 6) Reload the plugin
  and page session A again.
- **Expected**: Each page contains only its own session's rows in `semanticSort`
  order with `abview`/`clms`, identical to that session's overview, and no
  `fusionResult/results` request is made for a frozen session. Rows the
  provider left unscored appear last with `null` scores and `totalPage` counts
  them. Step 4 succeeds with the session's `ssid` and database supplied by the
  plugin. In step 5 the searches complete one after another behind the lock; a
  search that waited past the budget returns `SEARCH_BUSY` with no remote
  history created and succeeds when retried. After the reload, step 6 reaches
  the provider again and a mismatch, if the cache has moved on, is reported
  with the hint to rerun the search.
- **Specs linked**: this page; `Extensions/fusion-search/README.md`
- **Acceptance**: Stable, parallel-safe result pages; no change to the tool
  contracts
- **Status**: Unit-covered under `Extensions/fusion-search/test`
  (`result-snapshot`, `boolean-search`, `tool-executor`, `main`); the live
  behaviour of `forOverview` at size 400 with abstracts was confirmed against the
  deployment (388 of 389 hits returned in one 6 s request, `semanticSort` 1→388,
  all rows carrying the session's `ssId`)
