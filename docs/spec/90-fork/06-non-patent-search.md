# 90-06. Non-patent search plugin

Fork feature. `Extensions/non-patent-search` (`local.non-patent-search`,
display name 非专利检索) is a fork-owned agent-tool plugin loaded through the
regular plugin mechanism; it hooks no upstream file. Version 0.1.0 ships the
CNKI (中国知网) tool family, a port of the standalone `CNKICrawlerMCP` server
into in-process plugin tools. Its authoring documentation is
`Extensions/non-patent-search/README.md`.

## 1. Scope

- Two agent tools, both prefixed `CNKI_` so later database families can sit
  beside them in the same plugin:
  - `CNKI_ScanPaper` — subject-field search. Arguments `value` (required),
    `pageSize` (1–50, default 10), `pageNum` (≥1). Returns, per hit, exactly
    `Title`, `Href`, `Abstract`, `HTML_READING_URL`; the abstract and the
    reading link are read from each hit's abstract page, which merges the
    original `GetPaperInfo` tool into the search. There is no `withFactors`
    and no impact-factor lookup.
  - `CNKI_GetPaperMainBody` — full text for one `HTML_READING_URL`, returned
    as a plain string (title, chapter headings, paragraphs; real newlines, no
    HTML, no JSON escaping).
- No cookie tools. The plugin obtains its CNKI session before the first call
  by IP login (`login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`),
  keeps it in memory, and re-logs in once when a response is the login page.
  A cookie in the plugin's private settings file overrides IP login for
  machines outside the CNKI whitelist.
- One throttle spaces every CNKI request (1.2 s + up to 0.9 s jitter). Page
  requests use `pi.net.fetch` under `net.domains = ["*.cnki.net"]`; the login
  response's multiple `Set-Cookie` headers and redirect `Location` values,
  which the host fetch cannot surface, are read with a `node:https` client
  confined to the same hosts.
- Errors are structured (`INVALID_ARGUMENT`, `LOGIN_FAILED`, `COOKIE_EXPIRED`,
  `BLOCKED`, `UNEXPECTED_PAGE`, `HTTP_ERROR`, `MAIN_BODY_UNAVAILABLE`,
  `HOST_NOT_ALLOWED`, `CANCELLED`).

## 2. Tool contract details

- Search requests reproduce the crawler's form: `QueryJson` with a single
  `SU`/`TOPRANK` item, `pageNum`, `pageSize` in {10, 20, 50}, the fixed
  `productStr`, `searchFrom`, and `turnpage` token. Results are collected
  page by page until `pageSize` unique hrefs are found, capped at 50.
- A response with neither the `#countPageDiv` toolbar nor the
  `table.result-table-list` grid is classified: login page → `COOKIE_EXPIRED`
  (one automatic re-login), verification page → `BLOCKED`, anything else →
  `UNEXPECTED_PAGE`.
- Abstract pages are parsed for `input#abstract_text[value]` and the
  `.btn-html` reading link; a failed abstract page keeps the hit in the result
  with empty fields and adds a `warnings` line.
- The reading link is resolved to `fileName`/`tableName`/`dbCode`/`invoice`
  by following redirects by hand (or by reading the parameters embedded in a
  final page), then `nzkhtml/knsread/litNotes/getPaperInfo` is called and its
  `content.title` + `catalogInfos[]` (sorted by `orderNum`) are flattened to
  text.

## 3. E2E scenarios

#### E2E-PLUGIN-cnki-scan-and-read

- **Preconditions**: The `local.non-patent-search` development plugin is loaded
  and its `agent.tool.register` / `net.fetch` grants approved. The desktop runs
  on a network inside the CNKI IP whitelist, or the plugin settings file holds
  a valid `cookie`. Agent mode.
- **Steps**: 1) Start a new turn and ask the agent to search CNKI for a
  subject keyword with `CNKI_ScanPaper`, `pageSize` 5. 2) Inspect the result.
  3) Ask the agent to read the full text of one hit with
  `CNKI_GetPaperMainBody`, passing its `HTML_READING_URL` unchanged. 4) Ask for
  the full text of a hit whose `HTML_READING_URL` is empty or whose reading is
  not covered by the subscription. 5) Repeat step 1 quickly several times.
- **Expected**: Step 1 needs no cookie interaction; the plugin log shows one
  IP login (or the settings cookie). The result lists exactly five papers
  carrying `Title`, `Href`, `Abstract`, `HTML_READING_URL` and nothing else,
  with `totalHits`; any unreadable abstract page appears in `warnings` rather
  than failing the search. Step 3 returns the article as plain text with the
  title first and chapter headings in order, without HTML tags or `\n`
  sequences. Step 4 returns a structured `MAIN_BODY_UNAVAILABLE` or
  `INVALID_ARGUMENT` error. Step 5 shows requests spaced by at least 1.2 s; if
  CNKI answers with a verification page the tool returns `BLOCKED` instead of
  retrying.
- **Specs linked**: this page; `07-plugins/03-plugin-api.md`;
  `07-plugins/13-plugin-permissions-matrix.md`;
  `Extensions/non-patent-search/README.md`
- **Acceptance**: Plugin tool registration, automatic CNKI login, search with
  merged abstract data, plain-text full text
- **Status**: Parsing, login, search, redirect resolution, and tool behavior
  are unit-covered under `Extensions/non-patent-search/test`, including a
  real plugin-host load (`host-runtime.test.mjs`) with CNKI stubbed; the live
  journey requires a whitelisted network and is run by the maintainer.
