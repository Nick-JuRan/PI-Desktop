# 非专利检索 (`local.non-patent-search`)

A PI-Desktop agent-tool plugin for non-patent literature. Version 0.3.0 ships
the CNKI (中国知网) family; further academic databases are meant to join as
additional tool families in this same plugin. It is a fork island: it hooks no
upstream file (see `Extensions/AGENTS.md` and `FORK-STANDARD.md`).

The CNKI tools are a port of [Mangofang/CNKICrawlerMCP](https://github.com/Mangofang/CNKICrawlerMCP)
from a standalone MCP executable into in-process plugin tools, reshaped as
follows:

| CNKICrawlerMCP | This plugin |
| --- | --- |
| `ScanPaper` (title, authors, source, impact factors, `withFactors`, `pageSize`) | `CNKI_ScanPaper` — no `withFactors`, fixed 20 papers per page; returns `Title`, `Abstract`, `HTML_READING_URL` per paper in that order plus `totalPage` |
| `GetPaperInfo` (abstract, CAJ/PDF/HTML links from an abstract page) | merged into `CNKI_ScanPaper`, which reads every hit's abstract page |
| `GetPaperMainBody` (JSON-encoded text) | `CNKI_GetPaperMainBody` — plain text, no escape sequences; accepts the HTML reading link or a CNKI `bar.cnki.net/bar/download/order` link that redirects to it |
| `SetGlobalCookie` / `GetGlobalCookie` | removed; the cookie is prepared automatically before the first call |

## Tools

### `CNKI_ScanPaper`

Subject-field (主题) search on `https://kns.cnki.net/kns8s/brief/grid`.

- Arguments: `value` (required keyword) and `pageNum` (≥1, default 1).
  One call is one CNKI result page of a fixed 20 papers (`pageSize=20`, the
  size the original crawler defaults to); `totalPage` in the result is
  `ceil(totalHits / 20)`, so the caller starts at page 1 and increases
  `pageNum` to read on.
- The search itself is one request, exactly the original MCP's `ScanPaper`.
  The plugin then reads every hit's abstract page, which is where the
  abstract and the HTML reading link live. Each of those reads is throttled
  (see below), so a call takes roughly 30–60 s.
- Detail reads never fail the search. A page that cannot be read leaves
  `Abstract` / `HTML_READING_URL` empty and adds a `warnings` line; the first
  human-verification page (or a second login page after the automatic
  re-login) stops the remaining detail reads so a rate-limited session is not
  hammered further, and the closing warning says so. Detail reads also stop
  once 80 s of the call have elapsed, because the plugin host cancels a tool
  call at 110 s; the warning then asks for the same page again later.
- Paging caveats: the crawler's search form carries a fixed `turnpage`
  token, and the original author saw deeper pages come back with page 1's
  data. The plugin remembers each query's first page for the session and
  warns when a later page repeats it; a `pageNum` past `totalPage` returns
  an empty `papers` list with a warning.
- Result:

```json
{
  "ok": true,
  "pageNum": 1,
  "totalPage": 62,
  "totalHits": 1234,
  "papers": [
    {
      "Title": "…",
      "Abstract": "…",
      "HTML_READING_URL": "https://kns.cnki.net/kcms2/article/htmlreading?v=…"
    }
  ],
  "warnings": ["<title>: abstract page unavailable (…)"]
}
```

  `warnings` appears only when something was skipped or repeated (an
  unreadable abstract page, stopped detail reads, a repeated or out-of-range
  page); a skipped paper is still listed with empty `Abstract` /
  `HTML_READING_URL`.
- A page that reports hits but whose result list cannot be read (the table
  markup changed, or CNKI withheld the list) is an `UNEXPECTED_PAGE` error
  rather than an empty success; its details include the parser counters and
  a `markup` sample of the response so the parser can be fixed from the
  report.

### `CNKI_GetPaperMainBody`

- Argument: `HTML_READING_URL` — one `HTML_READING_URL` from `CNKI_ScanPaper`, or a CNKI
  `bar.cnki.net/bar/download/order` link from the paper detail page.
- The link redirects (usually twice) to a reader URL carrying `fileName`,
  `tableName`, `dbCode`, `invoice`. CNKI's `/reader/read` redirect may spell
  these as lowercase `filename`, `tablename` and `product`; the plugin maps
  those aliases before following the reader API. It follows those hops by
  hand, then calls
  `https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo` and turns the
  JSON answer into plain text: title, then each chapter heading followed by
  its paragraphs, chapters in `orderNum` order, tags and entities removed.
- The result is a **string**, so the model sees real line breaks rather than
  `\n` sequences. Failures come back as `{ "ok": false, "error": { "code",
  "message", … } }`; when CNKI answered with a page instead of data the error
  also carries `finalUrl`, `status`, `title` and a short visible-text
  `snippet` of that page, so it can be reported without guessing.

### Error codes

`INVALID_ARGUMENT`, `LOGIN_FAILED` (IP login rejected — the network is not on
the CNKI whitelist), `COOKIE_EXPIRED` (CNKI answered with its login page; the
plugin re-logs in once per tool call automatically), `BLOCKED` (CNKI asked for
human verification — slow down), `UNEXPECTED_PAGE`, `HTTP_ERROR`,
`MAIN_BODY_UNAVAILABLE` (no reader parameters or no reading permission),
`HOST_NOT_ALLOWED`, `CANCELLED`.

Login and verification pages are recognised the way a visitor would see them:
by the final URL after redirects (`login.cnki.net`, a `…/verify` or
`…/captcha` path), the page title and its visible text, or a script/form that
sends the visitor there. Ordinary CNKI pages link to `login.cnki.net` and load
captcha scripts in their markup, so raw-HTML matching would misreport healthy
pages; only the result-less search fragment is classified at all, and an
abstract page without the expected markup is reported as a warning, never as
a blocked session.

## Login and cookie

No cookie tool exists. On load the plugin starts an **IP login**
(`POST https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`, empty
JSON body); CNKI answers `IsSuccess` for whitelisted IPs and sets several
cookies, which are joined into one `Cookie` header and kept in memory. Every
tool call sends it verbatim on every request, exactly as CNKICrawlerMCP does;
a login page in any response triggers exactly one re-login and retry per
tool call.

For a machine outside the whitelist, put a browser cookie in the plugin's
private settings file — it takes precedence over IP login and is never shown
in the Settings UI:

```text
%USERPROFILE%\.pi-desktop\plugins\data\local.non-patent-search\settings.json     (packaged app)
%USERPROFILE%\.pi-desktop-dev\plugins\data\local.non-patent-search\settings.json (dev host)
```

```json
{ "cookie": "Ecp_ClientId=…; Ecp_LoginStuts=…; …" }
```

## Rate limiting and egress

One shared throttle spaces every CNKI request (login, search, abstract pages,
redirect hops, reader JSON) by 1.2 s plus up to 0.9 s of jitter, the pacing
the original crawler settled on to stay below CNKI's captcha threshold.

Every CNKI request is made by the plugin's own `node:https` client
(`src/http.mjs`), which sends the crawler's exact header set — form content
type, `Cookie`, Chrome user agent, `Referer: https://kns.cnki.net/`,
`Accept-Encoding: gzip` — follows redirects itself (at most 6 hops, each one
re-checked against `*.cnki.net`, cookies set inside a chain carried to the
next hop), and reports the final URL. The host's `pi.net.fetch` is **not**
used for CNKI on purpose: in the desktop it is Electron's `net.fetch`
(Chromium's network stack), and measured against a local server it

- replaces the plugin's `Cookie` header with Chromium's own session jar as
  soon as any earlier response has set a cookie for the host — so the
  IP-login cookie stopped reaching CNKI after the first request and CNKI
  treated the plugin as an anonymous client, which is what produced the
  human-verification pages the original MCP never saw;
- fails every 30x response with "Redirect was cancelled" instead of
  returning it, so redirect targets can never be inspected;
- collapses multiple `Set-Cookie` headers into one string.

The manifest still declares `net.fetch` and `net.domains` (`*.cnki.net`) as
the plugin's egress statement; the same allowlist is enforced by
`assertAllowedUrl` before every connection and every redirect hop. Requests
do not pass through the desktop's proxy settings (the whitelist network is
reached directly).

## Development

```powershell
node --test test/*.test.mjs
pnpm pi-plugin check .\Extensions\non-patent-search
pnpm pi-plugin pack .\Extensions\non-patent-search
```

`test/host-runtime.test.mjs` loads the folder in the real plugin runtime (a
forked plugin host process) with CNKI faked at the `https.request` boundary
(`test/helpers/fake-cnki.cjs`, loaded into the host with `--require`); it
needs `pnpm --filter @pi-desktop/desktop build:deps` first and skips itself
otherwise. No test contacts CNKI.

Load the folder with **Plugins → Load development plugin**, review
`agent.tool.register` and `net.fetch`, then use the tools in Agent mode. The
first real search on a whitelisted network is the acceptance test the
maintainer runs; the specification and E2E scenario live in
`docs/spec/90-fork/06-non-patent-search.md`.

## Adding another database

Add a `src/<db>.mjs` module plus tools named `<DB>_…` in `manifest.json`,
register them in `main.cjs`, and give them their own throttle/cookie manager
if the service is unrelated to CNKI. Keep the plugin an island: no upstream
file changes.
