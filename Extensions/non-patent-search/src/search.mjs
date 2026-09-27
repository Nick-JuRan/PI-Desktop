import { hostFetch, cnkiHeaders, formEncode } from "./http.mjs";
import { looksLikeLogin, looksLikeVerify, parseSearchPage } from "./cnki-html.mjs";
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

/** Classify a response that carries neither the toolbar nor the result table. */
export function classifyUnexpectedPage(bodyText) {
  if (looksLikeLogin(bodyText)) {
    return new CnkiError(ERROR_CODES.COOKIE_EXPIRED, "CNKI answered with its login page; the session cookie is missing or expired", {
      url: SEARCH_ENDPOINT,
    });
  }
  if (looksLikeVerify(bodyText)) {
    return new CnkiError(ERROR_CODES.BLOCKED, "CNKI asked for human verification; slow down and retry later", {
      url: SEARCH_ENDPOINT,
    });
  }
  return new CnkiError(
    ERROR_CODES.UNEXPECTED_PAGE,
    `CNKI returned an unexpected page (${bodyText.length} characters); the endpoint may have changed or the request was throttled`,
    { url: SEARCH_ENDPOINT },
  );
}

export async function fetchSearchPage({ value, pageNum, pageSize, cookie, fetchImpl, throttle, signal }) {
  await throttle?.waitTurn(signal);
  const response = await hostFetch(fetchImpl, {
    url: SEARCH_ENDPOINT,
    method: "POST",
    headers: cnkiHeaders(cookie, { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }),
    body: formEncode(buildSearchForm(value, pageNum, pageSize)),
  });
  const page = parseSearchPage(response.bodyText);
  if (!page.hasToolbar && !page.hasResultsTable) {
    throw classifyUnexpectedPage(response.bodyText);
  }
  return page;
}

/**
 * Collect up to `want` papers starting at `pageNum`. Always resolves with an
 * array; partial results win over a later page error.
 */
export async function searchPapers({ value, pageNum = 1, want = DEFAULT_PAGE_SIZE, cookie, fetchImpl, throttle, signal }) {
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
      result = await fetchSearchPage({ value: keyword, pageNum: page, pageSize: perPage, cookie, fetchImpl, throttle, signal });
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
