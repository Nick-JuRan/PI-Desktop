import { cnkiRequest, formEncode } from "./http.mjs";
import { describePage, looksLikeLogin, looksLikeVerify, parseSearchPage } from "./cnki-html.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * CNKI subject search (`kns8s/brief/grid`), ported from CNKICrawlerMCP.
 *
 * CNKI accepts only page sizes 10, 20 and 50 and answers other values with a
 * page that has no result table; deeper paging relies on a session-bound
 * `turnpage` token, so a single call is capped at 50 papers. `searchPapers`
 * accumulates pages until `want` papers are collected, deduplicating on href.
 */
export const SEARCH_ENDPOINT = "https://kns.cnki.net/kns8s/brief/grid";
export const VALID_PAGE_SIZES = Object.freeze([10, 20, 50]);
export const MAX_TOTAL_RESULTS = 50;
export const DEFAULT_PAGE_SIZE = 10;

export function normalizePageSize(want) {
  if (!Number.isFinite(want) || want <= 0) return 20;
  for (const size of VALID_PAGE_SIZES) if (want <= size) return size;
  return VALID_PAGE_SIZES[VALID_PAGE_SIZES.length - 1];
}

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

export async function fetchSearchPage({ value, pageNum, pageSize, cookie, request, throttle, signal }) {
  await throttle?.waitTurn(signal);
  const response = await cnkiRequest(
    {
      url: SEARCH_ENDPOINT,
      method: "POST",
      cookie,
      body: formEncode(buildSearchForm(value, pageNum, pageSize)),
      signal,
    },
    request ? { request } : undefined,
  );
  const page = parseSearchPage(response.bodyText);
  if (!page.hasToolbar && !page.hasResultsTable) {
    throw classifyUnexpectedPage(response);
  }
  return page;
}

/**
 * Collect up to `want` papers starting at `pageNum`. Always resolves with an
 * array; partial results win over a later page error.
 */
export async function searchPapers({ value, pageNum = 1, want = DEFAULT_PAGE_SIZE, cookie, request, throttle, signal }) {
  const keyword = String(value ?? "").trim();
  if (!keyword) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "value (the search keyword) must not be empty");
  let page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  const target = Math.min(Math.max(Math.floor(want) || DEFAULT_PAGE_SIZE, 1), MAX_TOTAL_RESULTS);
  const perPage = normalizePageSize(target);

  const papers = [];
  const seen = new Set();
  let total = -1;
  while (papers.length < target) {
    let result;
    try {
      result = await fetchSearchPage({ value: keyword, pageNum: page, pageSize: perPage, cookie, request, throttle, signal });
    } catch (error) {
      if (papers.length > 0) break;
      throw error;
    }
    if (result.total >= 0) total = result.total;
    if (result.papers.length === 0) break;
    let added = 0;
    for (const paper of result.papers) {
      if (seen.has(paper.href)) continue;
      seen.add(paper.href);
      papers.push(paper);
      added += 1;
      if (papers.length >= target) break;
    }
    if (added === 0) break;
    page += 1;
    if (result.totalPage > 0 && page > result.totalPage) break;
  }
  return { papers, total };
}
