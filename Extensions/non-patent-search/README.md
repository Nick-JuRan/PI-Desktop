# 非专利检索 (`local.non-patent-search`)

A PI-Desktop agent-tool plugin for non-patent literature. Version 0.1.0 ships
the CNKI (中国知网) family; further academic databases are meant to join as
additional tool families in this same plugin. It is a fork island: it hooks no
upstream file (see `Extensions/AGENTS.md` and `FORK-STANDARD.md`).

The CNKI tools are a port of [Mangofang/CNKICrawlerMCP](https://github.com/Mangofang/CNKICrawlerMCP)
from a standalone MCP executable into in-process plugin tools, reshaped as
follows:

| CNKICrawlerMCP | This plugin |
| --- | --- |
| `ScanPaper` (title, authors, source, impact factors, `withFactors`) | `CNKI_ScanPaper` — no `withFactors`; returns `Title`, `Href`, `Abstract`, `HTML_READING_URL` |
| `GetPaperInfo` (abstract, CAJ/PDF/HTML links from an abstract page) | merged into `CNKI_ScanPaper`, which reads each hit's abstract page |
| `GetPaperMainBody` (JSON-encoded text) | `CNKI_GetPaperMainBody` — plain text, no escape sequences |
| `SetGlobalCookie` / `GetGlobalCookie` | removed; the cookie is prepared automatically before the first call |

## Tools

### `CNKI_ScanPaper`

Subject-field (主题) search on `https://kns.cnki.net/kns8s/brief/grid`.

- Arguments: `value` (required keyword), `pageSize` (1–50, default 10),
  `pageNum` (≥1, default 1). CNKI serves pages of 10/20/50, so the request is
  rounded up to the nearest tier and paginated until `pageSize` unique papers
  are collected (capped at 50, because deeper pages depend on a session-bound
  `turnpage` token).
- For every hit the plugin then reads the abstract page, which is where the
  abstract and the HTML reading link live. Each of those reads is throttled
  (see below), so a page of 10 costs roughly 15–30 s and 50 costs 1–2 min.
  Keep `pageSize` small and paginate.
- Result:

```json
{
  "ok": true,
  "query": "格罗皮乌斯",
  "pageNum": 1,
  "requested": 10,
  "returned": 10,
  "totalHits": 1234,
  "papers": [
    {
      "Title": "…",
      "Href": "https://kns.cnki.net/kcms2/article/abstract?v=…",
      "Abstract": "…",
      "HTML_READING_URL": "https://kns.cnki.net/kcms2/article/htmlreading?v=…"
    }
  ],
  "warnings": ["<title>: abstract page unavailable (…)"]
}
```

  `warnings` appears only when an abstract page could not be read; the paper
  is still listed with empty `Abstract` / `HTML_READING_URL`.

### `CNKI_GetPaperMainBody`

- Argument: `href` — one `HTML_READING_URL` from `CNKI_ScanPaper`.
- The reading link redirects (usually twice) to a reader URL carrying
  `fileName`, `tableName`, `dbCode`, `invoice`; the plugin follows those hops
  by hand, then calls
  `https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo` and turns the
  JSON answer into plain text: title, then each chapter heading followed by
  its paragraphs, chapters in `orderNum` order, tags and entities removed.
- The result is a **string**, so the model sees real line breaks rather than
  `\n` sequences. Failures come back as `{ "ok": false, "error": { "code", "message" } }`.

### Error codes

`INVALID_ARGUMENT`, `LOGIN_FAILED` (IP login rejected — the network is not on
the CNKI whitelist), `COOKIE_EXPIRED` (CNKI answered with its login page; the
plugin re-logs in once automatically), `BLOCKED` (CNKI asked for human
verification — slow down), `UNEXPECTED_PAGE`, `HTTP_ERROR`,
`MAIN_BODY_UNAVAILABLE` (no reader parameters or no reading permission),
`HOST_NOT_ALLOWED`, `CANCELLED`.

## Login and cookie

No cookie tool exists. On load the plugin starts an **IP login**
(`POST https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`, empty
JSON body); CNKI answers `IsSuccess` for whitelisted IPs and sets several
cookies, which are joined into one `Cookie` header and kept in memory. Every
tool call reuses it; a login page in any response triggers exactly one
re-login and retry.

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

Page requests go through `pi.net.fetch`, so the host audits them and confines
them to `manifest.net.domains` (`*.cnki.net`). Two operations the host fetch
cannot express use a minimal `node:https` client confined to the same hosts:
reading every `Set-Cookie` header of the login response and reading a redirect
`Location` without following it.

## Development

```powershell
node --test test/*.test.mjs
pnpm pi-plugin check .\Extensions\non-patent-search
pnpm pi-plugin pack .\Extensions\non-patent-search
```

`test/host-runtime.test.mjs` loads the folder in the real plugin runtime (a
forked plugin host process) with CNKI stubbed through the runtime's fetch
service; it needs `pnpm --filter @pi-desktop/desktop build:deps` first and
skips itself otherwise. No test contacts CNKI.

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
