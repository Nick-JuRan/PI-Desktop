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

### `fusion_semantic_result_page`

Read one page from an existing semantically sorted session:

```json
{ "session_id": "...", "page": 1 }
```

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
never presented as a semantic list.

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
result-page operation is retried once after token refresh. Mutating operations
return `REMOTE_AUTH_REJECTED_NOT_RETRIED` after refresh; inspect remote state
before manually retrying.

Tool cancellation stops that caller's authentication wait and aborts a shared
authentication chain only when no other caller is waiting. It prevents that
tool call from starting later requests.
The current PI host `pi.net.fetch` contract does not carry an `AbortSignal`, so
an already submitted remote request cannot be assumed to have stopped. A
cancellation during a semantic mutation or Boolean search may leave the remote
outcome unknown. A result-page read is safe to retry with the same
`session_id`/`page` pair.

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
