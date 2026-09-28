# 90-06. Non-patent search plugin

Fork feature. `Extensions/non-patent-search` (`local.non-patent-search`,
display name 非专利检索) is a fork-owned agent-tool plugin loaded through the
regular plugin mechanism; it hooks no upstream file. Version 0.3.0 ships the
CNKI (中国知网) tool family, a port of the standalone `CNKICrawlerMCP` server
into in-process plugin tools. Its authoring documentation is
`Extensions/non-patent-search/README.md`.

## 1. Scope

- Two agent tools, both prefixed `CNKI_` so later database families can sit
  beside them in the same plugin:
  - `CNKI_ScanPaper` — subject-field search. Arguments `value` (required)
    and `pageNum` (≥1, default 1). One call is one result page of a fixed 20
    papers; the result is `{ ok, pageNum, totalPage, totalHits, papers,
    warnings? }` with `totalPage = ceil(totalHits / 20)`, and each paper
    carries exactly `Title`, `Abstract`, `HTML_READING_URL` in that order. The
    search is one request like the original `ScanPaper`; the abstract and
    the reading link are then read from each hit's abstract page, which
    merges the original `GetPaperInfo` tool into the search. There is no
    `pageSize`, no `withDetails`, no `withFactors` and no impact-factor
    lookup.
  - `CNKI_GetPaperMainBody` — full text for one `HTML_READING_URL` or a CNKI
    `bar.cnki.net/bar/download/order` link, returned as a plain string (title,
    chapter headings, paragraphs; real newlines, no HTML, no JSON escaping).
- No cookie tools. The plugin obtains its CNKI session before the first call
  by IP login (`login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`),
  keeps it in memory, sends it verbatim on every request, and re-logs in at
  most once per tool call when a response is the login page. A cookie in the
  plugin's private settings file overrides IP login for machines outside the
  CNKI whitelist.
- One throttle spaces every CNKI request (1.2 s + up to 0.9 s jitter). Every
  CNKI request is made by the plugin's own `node:https` client with the
  crawler's exact header set (form content type, `Cookie`, Chrome user agent,
  `Referer: https://kns.cnki.net/`, `Accept-Encoding: gzip`), redirects
  followed by the plugin within `*.cnki.net` (≤ 6 hops, chain cookies carried
  forward, final URL reported). `pi.net.fetch` is not used for CNKI: in the
  desktop it is Electron's `net.fetch`, which replaces the plugin's `Cookie`
  header with Chromium's session jar once any response has set a cookie for
  the host (the IP-login session then never reaches CNKI and CNKI answers the
  anonymous client with human verification), fails 30x responses instead of
  returning them, and collapses multiple `Set-Cookie` headers. The manifest's
  `net.fetch` / `net.domains = ["*.cnki.net"]` remain the plugin's egress
  statement; the plugin enforces the same allowlist before every connection
  and redirect hop.
- Errors are structured (`INVALID_ARGUMENT`, `LOGIN_FAILED`, `COOKIE_EXPIRED`,
  `BLOCKED`, `UNEXPECTED_PAGE`, `HTTP_ERROR`, `MAIN_BODY_UNAVAILABLE`,
  `HOST_NOT_ALLOWED`, `CANCELLED`).

## 2. Tool contract details

- Search requests reproduce the crawler's form: `QueryJson` with a single
  `SU`/`TOPRANK` item, `pageNum`, `pageSize` fixed at 20, the fixed
  `productStr`, `searchFrom`, and `turnpage` token. One request per call;
  duplicate hrefs inside the page are dropped. Because the `turnpage` token
  is fixed, a later page may repeat page 1; the plugin remembers each query's
  first page for the session and warns when that happens, and a `pageNum`
  past `totalPage` returns an empty list with a warning.
- A response with neither the `#countPageDiv` toolbar nor the
  `table.result-table-list` grid is classified: login page → `COOKIE_EXPIRED`
  (one automatic re-login), verification page → `BLOCKED`, HTTP ≥ 400 →
  `HTTP_ERROR`, anything else → `UNEXPECTED_PAGE`. Login and verification are
  recognised from the final URL after redirects (`login.cnki.net`, a
  `…/verify` or `…/captcha` path), the title and visible text, or a
  script/form target — not from raw markup, because ordinary CNKI pages link
  to `login.cnki.net` and load captcha scripts. Such errors carry `finalUrl`,
  `status`, `title` and a visible-text `snippet` for reporting.
- The result grid is read from `table.result-table-list` rows (`td.name
  a.fz14` with an `/kcms2/article/abstract` href, falling back to any
  abstract link in the row); compact CNKI tags whose quoted attributes run
  together are tolerated, as are omitted `</tr>` / `</td>` end tags and nested
  tables. A page that reports hits but yields no rows while the requested page
  is inside `totalPage` is `UNEXPECTED_PAGE` with the parser counters and a
  `markup` sample in the error details, never an empty success.
- Abstract pages are parsed for `input#abstract_text[value]` and the
  `.btn-html` reading link. Detail reads never fail the search: a failed or
  unrecognised abstract page keeps the hit with empty fields and adds a
  `warnings` line; the first `BLOCKED`, a second `COOKIE_EXPIRED` after the
  automatic re-login, or 80 s of elapsed call time (the host cancels a tool
  call at 110 s) stops the remaining detail reads and a closing warning names
  the cause.
- The reading link is resolved to `fileName`/`tableName`/`dbCode`/`invoice`
  by following redirects by hand (or by reading the parameters embedded in a
  final page). The `/reader/read` aliases `filename`/`tablename`/`product`
  are accepted, so a `bar.cnki.net/bar/download/order` link can be used too.
  Then `nzkhtml/knsread/litNotes/getPaperInfo` is called and its
  `content.title` + `catalogInfos[]` (sorted by `orderNum`) are flattened to
  text.

## 3. E2E scenarios

#### E2E-PLUGIN-cnki-scan-and-read

- **Preconditions**: The `local.non-patent-search` development plugin is loaded
  and its `agent.tool.register` / `net.fetch` grants approved. The desktop runs
  on a network inside the CNKI IP whitelist, or the plugin settings file holds
  a valid `cookie`. Agent mode.
- **Steps**: 1) Start a new turn and ask the agent to search CNKI for a
  subject keyword with `CNKI_ScanPaper` (page 1). 2) Inspect the result.
  3) Ask the agent to read the full text of one hit with
  `CNKI_GetPaperMainBody`, passing its `HTML_READING_URL` unchanged. 4) Ask
  for the full text of a detail-page `bar.cnki.net/bar/download/order` link.
  5) Ask for the full text of a hit whose `HTML_READING_URL` is empty or whose
  reading is not covered by the subscription. 6) Repeat step 1 quickly
  several times. 7) Ask for page 2 of the same search.
- **Expected**: Step 1 needs no cookie interaction; the plugin log shows one
  IP login (or the settings cookie). The result is `{ ok, pageNum: 1,
  totalPage, totalHits, papers }` with 20 papers carrying `Title`, `Abstract`,
  `HTML_READING_URL` in that order and nothing else, `totalPage` equal to
  `ceil(totalHits / 20)`; any unreadable abstract page appears in `warnings`
  rather than failing the search, and a hit count without a readable list is
  an `UNEXPECTED_PAGE` error carrying a `markup` sample. Step 3 returns the article as plain text with the
  title first and chapter headings in order, without HTML tags or `\n`
  sequences. For a live/readable order link, Step 4 returns the same plain
  text after the bar download redirect, including its lowercase reader
  parameters; an expired order or unavailable subscription returns the
  structured error. Step 5 returns a
  structured `MAIN_BODY_UNAVAILABLE` or `INVALID_ARGUMENT` error. Step 6 shows
  requests spaced by at least 1.2 s; if
  CNKI answers the search with a verification page the tool returns `BLOCKED`
  (with `finalUrl`, `title`, `snippet`) instead of retrying, and if it answers
  an abstract page that way the search still succeeds with the remaining
  detail reads skipped and a closing warning. Step 7 returns `pageNum: 2`
  with 20 different papers, or the same list plus a warning that CNKI
  repeated page 1.
- **Specs linked**: this page; `07-plugins/03-plugin-api.md`;
  `07-plugins/13-plugin-permissions-matrix.md`;
  `Extensions/non-patent-search/README.md`
- **Acceptance**: Plugin tool registration, automatic CNKI login, search with
  merged abstract data, plain-text full text
- **Status**: Parsing, login, search, redirect resolution, and tool behavior
  are unit-covered under `Extensions/non-patent-search/test`, including a
  real plugin-host load (`host-runtime.test.mjs`) with CNKI faked at the
  `https.request` boundary; the live journey requires a whitelisted network
  and is run by the maintainer.
