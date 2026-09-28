import { cnkiRequest, formEncode } from "./http.mjs";
import { describePage, looksLikeLogin, looksLikeVerify, markupSample, parseSearchPage } from "./cnki-html.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * CNKI subject search (`kns8s/brief/grid`), ported from CNKICrawlerMCP.
 *
 * One tool call is one result page of a fixed 20 papers — the page size the
 * original crawler defaults to and CNKI is known to serve. `totalPage` is
 * `ceil(totalHits / 20)`; the caller pages with `pageNum`.
 */
export const SEARCH_ENDPOINT = "https://kns.cnki.net/kns8s/brief/grid";
export const PAGE_SIZE = 20;

export function buildQueryJson(value) {
  return {
    Platform: "",
    Resource: "CROSSDB",
    Classid: "WD0FTY92",
    Products:
      "CJFQ,CAPJ,WWJD,CJTL,CDFD,CMFD,CPFD,IPFD,CPVD,WWPD,CCND,SCSF,SCHF,SCSD,SOSD,SNAD,CCJD,WBFD,WWBD,CCVD,CJFN",
    QNode: {
      QGroup: [
        {
          Key: "Subject",
          Title: "",
          Logic: 0,
          Items: [{ Field: "SU", Value: value, Operator: "TOPRANK", Logic: 0, Title: "主题" }],
          ChildItems: [],
        },
      ],
    },
    ExScope: 1,
    SearchType: 2,
    Rlang: "BOTH",
    KuaKuCode: "YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV",
    Expands: {},
    SearchFrom: 4,
  };
}

export function buildSearchForm(value, pageNum, pageSize) {
  return {
    QueryJson: JSON.stringify(buildQueryJson(value)),
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    productStr:
      "YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,R79MZMCB,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,EMRPGLPA,J708GVCE,ML4DRIDX,NLBO1Z6R,NN3FJMUV,",
    searchFrom: "资源范围：总库",
    turnpage: "vLP2bNpghntZLRq9Q5Y7Qg!!",
  };
}

/**
 * Classify a response that carries neither the toolbar nor the result table.
 * Login is checked before verification, as in the Go crawler: login pages also
 * mention verification. Error details carry the final URL, status, title and a
 * text snippet so the page can be reported without guessing.
 */
export function classifyUnexpectedPage(response) {
  const bodyText = typeof response === "string" ? response : response.bodyText ?? "";
  const finalUrl = typeof response === "string" ? SEARCH_ENDPOINT : response.finalUrl ?? SEARCH_ENDPOINT;
  const status = typeof response === "string" ? undefined : response.status;
  const details = { url: SEARCH_ENDPOINT, ...describePage(bodyText, { finalUrl, status }) };
  if (looksLikeLogin(bodyText, { finalUrl })) {
    return new CnkiError(ERROR_CODES.COOKIE_EXPIRED, "CNKI answered with its login page; the session cookie is missing or expired", details);
  }
  if (looksLikeVerify(bodyText, { finalUrl })) {
    return new CnkiError(ERROR_CODES.BLOCKED, "CNKI asked for human verification; slow down and retry later", details);
  }
  if (status !== undefined && status >= 400) {
    return new CnkiError(ERROR_CODES.HTTP_ERROR, `CNKI search returned HTTP ${status}`, details);
  }
  return new CnkiError(
    ERROR_CODES.UNEXPECTED_PAGE,
    `CNKI returned an unexpected page (${bodyText.length} characters); the endpoint may have changed or the request was throttled`,
    details,
  );
}

/**
 * A page that reports hits but yields no paper rows although the requested
 * page exists: the list markup was not recognised (or CNKI withheld it).
 * The error carries the parser counters and a markup sample for reporting.
 */
export function missingListError(response, page, pageNum) {
  return new CnkiError(
    ERROR_CODES.UNEXPECTED_PAGE,
    `CNKI reported ${page.total} hits for page ${pageNum} but the result list could not be read (table ${page.hasResultsTable ? "present" : "absent"}, ${page.counts.rows} rows, ${page.counts.nameCells} title cells, ${page.counts.abstractLinks} abstract links)`,
    {
      url: SEARCH_ENDPOINT,
      ...describePage(response.bodyText, { finalUrl: response.finalUrl, status: response.status }),
      markup: markupSample(response.bodyText),
    },
  );
}

export async function fetchSearchPage({ value, pageNum, cookie, request, throttle, signal }) {
  await throttle?.waitTurn(signal);
  const response = await cnkiRequest(
    {
      url: SEARCH_ENDPOINT,
      method: "POST",
      cookie,
      body: formEncode(buildSearchForm(value, pageNum, PAGE_SIZE)),
      signal,
    },
    request ? { request } : undefined,
  );
  const page = parseSearchPage(response.bodyText);
  if (!page.hasToolbar && !page.hasResultsTable) {
    throw classifyUnexpectedPage(response);
  }
  return { page, response };
}

/** `ceil(totalHits / PAGE_SIZE)`; CNKI's own page mark when the hit count is unknown. */
export function totalPagesFor(total, cnkiTotalPage) {
  if (total >= 0) return Math.ceil(total / PAGE_SIZE);
  return cnkiTotalPage > 0 ? cnkiTotalPage : 0;
}

/**
 * One result page: `{ papers: [{ title, href }], total, totalPage }` with the
 * page's duplicate hrefs dropped. A page past the end is empty and fine; a page
 * inside the range that yields no rows is `UNEXPECTED_PAGE` with diagnostics.
 */
export async function searchPapers({ value, pageNum = 1, cookie, request, throttle, signal }) {
  const keyword = String(value ?? "").trim();
  if (!keyword) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "value (the search keyword) must not be empty");
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  const { page: parsed, response } = await fetchSearchPage({ value: keyword, pageNum: page, cookie, request, throttle, signal });
  const totalPage = totalPagesFor(parsed.total, parsed.totalPage);
  const papers = [];
  const seen = new Set();
  for (const paper of parsed.papers) {
    if (seen.has(paper.href)) continue;
    seen.add(paper.href);
    papers.push(paper);
  }
  if (papers.length === 0 && parsed.total > 0 && (totalPage === 0 || page <= totalPage)) {
    throw missingListError(response, parsed, page);
  }
  return { papers, total: parsed.total, totalPage };
}
