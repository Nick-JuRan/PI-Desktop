# 融合检索 (Fusion Search)

`local.fusion-search` is a PI-Desktop agent-tool plugin for the intranet
Fusion Search service. This version acquires its own authentication tokens:
the legacy browser-extension token refresher and the `.token/neusipo_token.json`
file channel are both retired.

## Tool

`fusion_semantic_baseline` has three actions:

- `prepare`: create a semantic baseline from `reference_kind=application_number`
  or `reference_kind=text`, then return the server `element_id`, active Chinese
  and English terms, and their weights.
- `get_terms`: read the active Chinese and English terms and retained weights
  for an existing `element_id`. Zero-weight deletion markers are reported
  under `deleted_terms`.
- `update_terms`: submit one or both complete language lists. An omitted
  language is preserved. Removed existing terms are sent with `wt: 0`; new
  terms use `isAdd: "1"`; retained terms use `isAdd: 0`. The default
  `verify=true` reads the saved lists back after the write.

Weights are integers from 1 to 5. Text baselines must contain 20 to 25,000
characters. Application numbers are normalized by removing dots and spaces,
matching the legacy UI request shape.

## Authentication

Semantic-baseline calls go through the host's audited `pi.net.fetch` to
`10.160.28.16` only.

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
A 401/403 triggers one forced re-login. The read-only `get_terms` action is
replayed once with the replacement token; mutating `prepare` and `update_terms`
actions are not automatically replayed. They return
`REMOTE_AUTH_REJECTED_NOT_RETRIED` after refreshing credentials, so inspect the
remote state before explicitly retrying a mutation.

Tool cancellation stops that caller's authentication wait and aborts a shared
authentication chain only when no other caller is waiting. It prevents that
tool call from starting later requests.
The current PI host `pi.net.fetch` contract does not carry an `AbortSignal`, so
an already submitted semantic request cannot be assumed to have stopped. A
cancelled `get_terms` returns `CANCELLED`; if cancellation intersects `prepare`
or `update_terms`, the tool returns `REMOTE_OUTCOME_UNKNOWN`. Review remote state
before retrying either mutation.

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
pnpm pi-plugin check .\Extensions\fusion-search
pnpm pi-plugin pack .\Extensions\fusion-search
```

`vendor/pngjs` is the single vendored dependency (MIT, zero transitive
dependencies) for decoding the captcha images.

Load the folder with **Plugins → Load development plugin**, review
`agent.tool.register` and `net.fetch`, then use the tool in Agent mode.
`get_terms` is the only action declared safe for Goal-mode planning; baseline
creation and term updates are mutating remote operations.
