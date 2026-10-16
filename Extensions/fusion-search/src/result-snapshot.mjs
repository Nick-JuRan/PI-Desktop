import { fail } from "./errors.mjs";
import { FUSION_RESULT_PAGE_SIZE, firstDetailText } from "./semantic-result-page.mjs";

/**
 * Frozen result sets, one per Boolean search session.
 *
 * The provider's result-page endpoint (`fusionResult/results`) serves the
 * semantically sorted list from a cache that is shared per account and holds
 * only the most recent semantic search. Two sessions open at once overwrite
 * each other: page requests for session A come back with rows whose `ssId` is
 * B. Sending `semanticParam` with the page request does not make the provider
 * recompute (verified live), so the only consistent moment is the `forOverview`
 * call made right after the search, which returns the session's own full set.
 * That response is validated row by row and frozen here; result pages are then
 * served locally, so any number of sessions can be read in parallel.
 *
 * The provider reports `semSortCounts` one below `hitCounts` when a row has no
 * semantic score. Such rows are kept at the tail with `null` scores rather
 * than dropped, so the reader still sees every candidate.
 */

/** Sessions kept before the least recently used one is evicted (~1 MB each). */
export const RESULT_SNAPSHOT_MAX_SESSIONS = 20;
/** How long a search waits for the in-process lock before SEARCH_BUSY. */
export const SEARCH_LOCK_WAIT_MS = 60_000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rankValue(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * Validate the overview rows of one session and project them into result-page
 * records: ranked rows in `semanticSort` order, unranked rows at the tail.
 * Throws RESULT_SESSION_MISMATCH when a row belongs to another session, and
 * REMOTE_RESPONSE_INVALID for rows without an identity.
 */
export function buildResultSnapshot({ sessionId, rows, endpoint }) {
  if (!Array.isArray(rows)) {
    fail("REMOTE_RESPONSE_INVALID", "The search overview did not contain a resultList array", { endpoint });
  }
  const ranked = [];
  const unranked = [];
  for (const row of rows) {
    if (!isObject(row)) {
      fail("REMOTE_RESPONSE_INVALID", "The search overview contains a non-object record", { endpoint });
    }
    const rowSessionId = String(row.ssId ?? "").trim();
    if (rowSessionId && rowSessionId !== sessionId) {
      fail("RESULT_SESSION_MISMATCH", "A search overview row belongs to a different session", { endpoint });
    }
    const pnId = String(row.pnId ?? "").trim();
    const title = String(row.ti ?? "").trim();
    if (!pnId || !title) {
      fail("REMOTE_RESPONSE_INVALID", "A search overview row is missing pnId or ti", { endpoint });
    }
    const record = {
      pnId,
      ti: title,
      simVal: finiteNumber(row.simVal),
      semanticSort: rankValue(row.semanticSort),
      abview: firstDetailText(row.abview),
      clms: firstDetailText(row.clms),
    };
    if (record.simVal !== null && record.semanticSort !== null) ranked.push(record);
    else unranked.push({ ...record, simVal: null, semanticSort: null });
  }
  ranked.sort((left, right) => left.semanticSort - right.semanticSort);
  return {
    sessionId,
    records: [...ranked, ...unranked],
    unrankedCount: unranked.length,
    frozenAt: Date.now(),
  };
}

/** One page of a frozen snapshot, shaped exactly like the live result page. */
export function pageResultSnapshot(snapshot, page, pageSize = FUSION_RESULT_PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return {
    ok: true,
    semantic_sorted: true,
    records: snapshot.records.slice(start, start + pageSize),
    totalPage: Math.ceil(snapshot.records.length / pageSize),
    page,
  };
}

/** Bounded, most-recently-used store of frozen snapshots keyed by session id. */
export function createResultSnapshotStore({ maxSessions = RESULT_SNAPSHOT_MAX_SESSIONS } = {}) {
  const snapshots = new Map();
  return {
    freeze(snapshot) {
      const id = String(snapshot?.sessionId ?? "").trim();
      if (!id) return;
      snapshots.delete(id);
      snapshots.set(id, snapshot);
      while (snapshots.size > maxSessions) {
        snapshots.delete(snapshots.keys().next().value);
      }
    },
    get(sessionId) {
      const id = String(sessionId ?? "").trim();
      const snapshot = snapshots.get(id);
      if (!snapshot) return null;
      // Re-insert so the sessions still being read stay ahead of stale ones.
      snapshots.delete(id);
      snapshots.set(id, snapshot);
      return snapshot;
    },
    has(sessionId) {
      return snapshots.has(String(sessionId ?? "").trim());
    },
    size() {
      return snapshots.size;
    },
    clear() {
      snapshots.clear();
    },
  };
}

/**
 * Serialize the "create session → read its overview" step across concurrent
 * tool calls. The overview response is the session's own set, so the lock is
 * insurance against the provider interleaving two semantic computations, not
 * the mechanism that keeps sessions apart. A caller that waits longer than
 * `waitMs` gets SEARCH_BUSY before anything was sent, so retrying is safe.
 */
export function createSearchLock({
  waitMs = SEARCH_LOCK_WAIT_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  let tail = Promise.resolve();
  let holders = 0;
  return {
    async acquire({ signal } = {}) {
      if (signal?.aborted) fail("CANCELLED", "The Fusion Search request was cancelled while waiting for the search lock");
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      const previous = tail;
      tail = previous.then(() => held);
      let timer;
      let onAbort;
      const timeout = new Promise((_, reject) => {
        timer = setTimeoutImpl(() => {
          reject(Object.assign(new Error("search lock wait exceeded"), { code: "SEARCH_BUSY" }));
        }, waitMs);
        if (signal) {
          onAbort = () => reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
      let acquired = false;
      try {
        await Promise.race([previous.then(() => { acquired = true; }), timeout]);
      } catch (error) {
        // Our slot is still queued; hand it on once the holder finishes so
        // later callers are not stuck behind an abandoned wait.
        previous.then(() => release());
        if (error?.code === "SEARCH_BUSY") {
          fail(
            "SEARCH_BUSY",
            "Another Boolean search is still being frozen for this account. Nothing was sent; retry this exact search shortly.",
          );
        }
        if (error?.code === "CANCELLED") {
          fail("CANCELLED", "The Fusion Search request was cancelled while waiting for the search lock");
        }
        throw error;
      } finally {
        clearTimeoutImpl(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      }
      if (!acquired) release();
      holders += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        release();
      };
    },
    busy() {
      return holders > 0;
    },
  };
}
