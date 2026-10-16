# Fusion Search

`local.fusion-search` is a PI-Desktop agent-tool plugin for the intranet
Fusion Search service. Its tools share one token manager and private settings:
the legacy browser-extension token refresher and the `.token/neusipo_token.json`
file channel are both retired.

## Tools

### `fusion_boolean_search`

Run a Boolean search in one database using the displayed database code and a
query expression. Supported codes are `CNTXT`, `ENTXT`, `ENTXTC`, `VEN`, and
`DWPI`. `CTTXT` is accepted as an alias for the provider's canonical `CNTXT`
code. The tool loads the current database catalog and resolves its internal
`dbId`; callers never need to know or provide that identifier.

The tool uses the active semantic baseline (the most recently prepared by this
plugin, or the account's selected baseline) and retains up to 400 candidates
for later pages. If no semantic baseline is selected, prepare one with
`fusion_semantic_baseline` first. The result is intentionally compact:

```json
{ "ok": true, "database": "CNTXT", "total_hits": 123, "session_id": "..." }
```

`session_id` is the opaque provider `ssId`, not a visible history number such
as `mixSsNum`. It can be passed to the result-page API to retrieve pages from
the same search. The tool returns no patent records. A Boolean search creates
remote search history, and the plugin never automatically replays it after an
uncertain outcome; check the remote history before manually retrying.
If search execution returned a session but its count lookup fails, the error
also includes that `session_id` so result retrieval can resume without
submitting a duplicate search.

#### The result set is frozen at search time

The provider pages the semantically sorted list (`fusionResult/results`) from a
cache that is shared per account and holds only the most recent semantic
search. With two sessions open, page requests for session A come back with
rows whose `ssId` is B — the plugin used to refuse them with
`RESULT_SESSION_MISMATCH`, which is what five parallel library searches ran
into. Sending `semanticParam` with the page request does not make the provider
recompute (verified live), so the only read guaranteed to be the session's own
set is the `forOverview` call made right after the search.

The plugin therefore asks that call for the whole retained set (`size` 400,
abstracts on; about 6 s for ~390 hits), checks every row's `ssId` against the
session, and freezes the rows in an in-process store keyed by `session_id`
(most recent 20 sessions, roughly 1 MB each). Session creation and the overview
run under one in-process lock so concurrent searches never interleave their
semantic computations; a caller that waits more than 60 s receives
`SEARCH_BUSY` before anything was sent, so it can simply retry the same search.
The provider reports `semSortCounts` one below `hitCounts` when a row carries
no semantic score; such rows stay at the tail of the snapshot with `null`
`simVal`/`semanticSort`. The frozen rows also feed the full-text record
registry, so `fusion_full_text` can open any listed record before it was paged.

### `fusion_semantic_result_page`

Read one page from an existing semantically sorted session:

```json
{ "session_id": "...", "page": 1 }
```

Pages are served from the result set frozen when the session was searched, so
any number of sessions can be read in parallel without a token or a network
request; `totalPage` is the ceiling of the frozen row count / 20. A session the
plugin does not hold (after a reload, or one it did not create) falls back to the
live provider page described below, whose mismatch error now says to rerun the
Boolean search and page the new `session_id`.

The page size is fixed at 20; `start` is calculated from the one-based page.
Each record includes `pnId`, `ti`, `simVal`, `semanticSort`, `abview`, and
`clms`. `abview` and `clms` are plain-text strings, not provider detail objects:
the tool takes the first non-empty field value, removes HTML/XML markup, decodes
common HTML/XML entities, and keeps paragraph breaks. Provider field labels such
as `摘要` / `AB` or `中文权利要求` / `CLMS` are not included. Missing content is
an empty string. The response also includes `totalPage`, calculated as the
ceiling of `listCounts / 20`, and the requested `page`. The tool checks that
every returned row carries semantic scores/ranks and belongs to the requested
session; an ordinary, unranked, or mismatched page is reported as an error,
never presented as a semantic list. `clms` is the provider's main-claim field;
the complete claims and the description come from `fusion_full_text`.

### `fusion_full_text`

Read one patent in full for comparison work:

```json
{ "pnId": "CN115123456A" }
```

`pnId` is the only argument — the value listed in a `fusion_semantic_result_page`
record, whole or any one of its `;`-joined members. The quick-view endpoint
(`neusipo-app-view/fastFullText/queryFullText`) also wants the search session
(`ssid` header), the view database and, as a fallback identity, the application
number; the plugin supplies them from an in-process registry: the Boolean search
remembers which database each session was run against, and the result page
remembers the raw rows (`ssId`, `anId`, `dbName`, `ti`) behind the records it
projects. A pnId the plugin never listed (after a restart, or typed from
elsewhere) is requested bare and the provider decides.

The endpoint resolves exactly one identity per request and rejects a
`;`-joined application number, or a `;`-joined publication number sent with no
application number, with "未检索到收录的文献！" even when the record has full
text. The plugin therefore reduces a listed record to the members the endpoint
accepts: first the first application-number member with the merged publication
list (the shape the web QuickView page sends), then the first publication
member alone. The merged list is what the tool names in its output line, so a
family is read once and cited by the value the result page showed.

The result is a plain string, not JSON — the host hands strings to the model
verbatim, so no escaping reaches the transcript:

```text
CN115123456A  一种可调节预紧力的弹簧阻尼器

权利要求
1. 一种可调节预紧力的弹簧阻尼器，其特征在于，……
2. 根据权利要求1所述的弹簧阻尼器，其特征在于，……

说明书
技术领域
[0002] 本发明涉及减振装置技术领域……
背景技术
[0004] 现有弹簧阻尼器……
具体实施方式
[0017] 如图1所示……〔图〕……
```

Claims keep their original numbering text. Description paragraphs carry the
provider's `description_N` number as `[000N]`, so a second call for the same
pnId returns the same numbers and the agent can cite `[0017]`; heading rows
("技术领域", "背景技术", …) occupy a number in the source but are printed
without one. `<img>` becomes `〔图〕` or `〔图：alt〕`. Nothing is paginated,
summarized or cut: a 300,000-character safety valve ends a pathological
response with `[全文超长，已截断于第 N 段]`, which ordinary patents never reach.

Failures keep the plugin's uniform error object. A record the quick-view store
has not indexed (HTTP 200, `t: null`) is `FULL_TEXT_UNAVAILABLE` with the
provider's `message`; HTML without claim or description cells is
`FULL_TEXT_UNPARSED`. The call is read-only and creates no search history, so it
is retried once after a token refresh and is declared `risk: low`, which never
opens an approval card.

### `fusion_semantic_baseline`

`fusion_semantic_baseline` has two actions:

- `prepare`: create a baseline and immediately return its `element_id`, active
  Chinese and English terms, and weights. The workflow targets one specified
  patent claim, not the application as a whole. A case-number source may yield
  broader terms, so compare and refine them against the target claim. Prefer a
  case-number baseline by specifying `reference_kind=application_number` or
  `reference_kind=publication_number`; compare the returned terms and weights
  with the target claim. Keep suitable terms or first refine them with
  `update_terms`. If the case-number baseline remains unsuitable, use
  `reference_kind=text` with your own concise paraphrase of the technical
  solution in that claim. Base it on your understanding; do not copy the claim
  verbatim or use the full application, then refine the returned terms and
  weights as needed. Case-number mode accepts only application or
  publication numbers; other case identifiers are not accepted.
- `update_terms`: submit one or both complete language lists. An omitted
  language is preserved. Removed existing terms are sent with `wt: 0`; new
  terms use `isAdd: "1"`; retained terms use `isAdd: 0`. The default
  `verify=true` reads the saved lists back after the write and returns the
  verified active terms and weights.

Weights are integers from 1 to 5. Text baselines must contain 20 to 25,000
characters. Application and publication numbers are normalized by removing
dots and spaces, matching the legacy UI request shape. The `get_terms` action
is no longer public; `prepare` returns generated terms immediately, while
`update_terms` returns the saved terms when verification is enabled.

## Authentication

Boolean-search and semantic-baseline API calls go through the host's audited
`pi.net.fetch` to `10.160.28.16` only.

Token acquisition is built in. The plugin runs the same HTTP chain as the
legacy `auth_http_login.py` script — slider captcha solved by luminance
matching, AES-encrypted login, OAuth authorize chain, code exchange — using
its own `node:http` client. It permits only these exact origins on every request
and redirect hop: `http://10.160.47.100:19090`,
`http://10.160.47.100:6100`, and `http://10.160.28.16` (port 80). Its cookie jar
honors cookie host and path scope, expiration, and secure attributes, so auth
cookies are not sent to the separate search-server host. Sensitive explicit
headers are stripped on cross-origin redirects. The custom client is needed
because `pi.net.fetch` hides the final URL after redirects, where the OAuth code
lives, and collapses repeated Set-Cookie headers, which carry the login
 encryption keys.

Tokens are stored and lazily refreshed: each tool call checks the JWT `exp`,
and a token inside the 30-minute margin triggers one single-flight re-login.
A 401/403 triggers one forced re-login. Semantic baseline creation/update and
Boolean searching mutate remote state, so none of these operations is
automatically replayed after an authentication rejection. The read-only
result-page and full-text operations are retried once after token refresh.
Mutating operations
return `REMOTE_AUTH_REJECTED_NOT_RETRIED` after refresh; inspect remote state
before manually retrying.

Tool cancellation stops that caller's authentication wait and aborts a shared
authentication chain only when no other caller is waiting. It prevents that
tool call from starting later requests.
The current PI host `pi.net.fetch` contract does not carry an `AbortSignal`, so
an already submitted remote request cannot be assumed to have stopped. A
cancellation during a semantic mutation or Boolean search may leave the remote
outcome unknown. A result-page read is safe to retry with the same
`session_id`/`page` pair, and a full-text read with the same `pnId`.

## Credentials (one-time setup)

Put the intranet credentials in the plugin's private settings file — the
plugin data directory of the running PI-Desktop profile:

```text
%USERPROFILE%\.pi-desktop\plugins\data\local.fusion-search\settings.json     (packaged app)
%USERPROFILE%\.pi-desktop-dev\plugins\data\local.fusion-search\settings.json (dev host)
```

```json
{ "username": "188...", "password": "..." }
```

The file is outside every git repository, is never shown in the Settings UI
(the keys are not declared in `contributes.settings`), and never crosses the
tool boundary. The token itself lands in the same file under `token`.

## Development

```powershell
node --test test/*.test.mjs
$env:FUSION_TEST_USERNAME = "..."; $env:FUSION_TEST_PASSWORD = "..."; node --test test/live-login.test.mjs
$env:FUSION_TEST_REFERENCE_KIND = "publication_number"; $env:FUSION_TEST_REFERENCE = "..."; node --test test/live-tool.test.mjs
$env:FUSION_TEST_SETTINGS_PATH = "..."; $env:FUSION_TEST_DATABASE = "CNTXT"; $env:FUSION_TEST_BOOLEAN_QUERY = 'A01B1/00/IC AND PD < "1900.01.01"'; node --test test/live-boolean-search.test.mjs
$env:FUSION_TEST_SETTINGS_PATH = "..."; $env:FUSION_TEST_SESSION_ID = "..."; node --test test/live-semantic-result-page.test.mjs
$env:FUSION_TEST_SETTINGS_PATH = "..."; $env:FUSION_TEST_SESSION_ID = "..."; $env:FUSION_TEST_PNID = "..."; node --test test/live-full-text.test.mjs
pnpm pi-plugin check .\Extensions\fusion-search
pnpm pi-plugin pack .\Extensions\fusion-search
```

`vendor/pngjs` is the single vendored dependency (MIT, zero transitive
dependencies) for decoding the captcha images.

Load the folder with **Plugins → Load development plugin**, review
`agent.tool.register` and `net.fetch`, then use either tool in Agent mode. Both
tools create remote state and are not safe for Goal-mode planning. The optional
live semantic test requires a dedicated account and a controlled case-number
or claim-solution paraphrase reference. The live Boolean-search test requires a
dedicated account, a database code, and a query approved for a real
search-history entry.
