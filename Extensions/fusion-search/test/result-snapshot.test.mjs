import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResultSnapshot,
  createResultSnapshotStore,
  createSearchLock,
  pageResultSnapshot,
} from "../src/result-snapshot.mjs";

function row({ pnId, ti = `Title ${pnId}`, simVal, semanticSort, ssId = "SESSION-1", abview = "Abstract", clms = "Claim" } = {}) {
  return {
    ssId,
    pnId,
    ti,
    ...(simVal !== undefined ? { simVal } : {}),
    ...(semanticSort !== undefined ? { semanticSort } : {}),
    abview: [{ indexCnName: "摘要", value: `<p>${abview}</p>` }],
    clms: [{ indexCnName: "主权利要求说明", value: clms }],
  };
}

test("a snapshot orders ranked rows by semanticSort and keeps unranked rows at the tail with null scores", () => {
  const snapshot = buildResultSnapshot({
    sessionId: "SESSION-1",
    endpoint: "/overview",
    rows: [
      row({ pnId: "CN3", simVal: 70, semanticSort: 3 }),
      row({ pnId: "CN9" }),
      row({ pnId: "CN1", simVal: "91.5", semanticSort: "1" }),
      row({ pnId: "CN2", simVal: 80, semanticSort: 2 }),
    ],
  });
  assert.deepEqual(snapshot.records.map((record) => record.pnId), ["CN1", "CN2", "CN3", "CN9"]);
  assert.deepEqual(snapshot.records[0], {
    pnId: "CN1",
    ti: "Title CN1",
    simVal: 91.5,
    semanticSort: 1,
    abview: "Abstract",
    clms: "Claim",
  });
  assert.deepEqual(snapshot.records[3], {
    pnId: "CN9",
    ti: "Title CN9",
    simVal: null,
    semanticSort: null,
    abview: "Abstract",
    clms: "Claim",
  });
  assert.equal(snapshot.unrankedCount, 1);
  assert.equal(snapshot.sessionId, "SESSION-1");
});

test("a row from another session fails the snapshot instead of being frozen", () => {
  assert.throws(
    () => buildResultSnapshot({
      sessionId: "SESSION-1",
      endpoint: "/overview",
      rows: [row({ pnId: "CN1", simVal: 1, semanticSort: 1 }), row({ pnId: "CN2", simVal: 1, semanticSort: 2, ssId: "SESSION-2" })],
    }),
    (error) => error.code === "RESULT_SESSION_MISMATCH",
  );
  assert.throws(
    () => buildResultSnapshot({ sessionId: "SESSION-1", endpoint: "/overview", rows: [{ ssId: "SESSION-1", ti: "no pnId" }] }),
    (error) => error.code === "REMOTE_RESPONSE_INVALID",
  );
  assert.throws(
    () => buildResultSnapshot({ sessionId: "SESSION-1", endpoint: "/overview", rows: "nope" }),
    (error) => error.code === "REMOTE_RESPONSE_INVALID",
  );
});

test("rows without an ssId are accepted as the session's own", () => {
  const snapshot = buildResultSnapshot({
    sessionId: "SESSION-1",
    endpoint: "/overview",
    rows: [{ pnId: "CN1", ti: "T", simVal: 5, semanticSort: 1 }],
  });
  assert.equal(snapshot.records.length, 1);
});

test("snapshot pages have the live result-page shape and run out cleanly", () => {
  const rows = Array.from({ length: 45 }, (_, index) => row({ pnId: `CN${index + 1}`, simVal: 100 - index, semanticSort: index + 1 }));
  const snapshot = buildResultSnapshot({ sessionId: "SESSION-1", endpoint: "/overview", rows });
  const first = pageResultSnapshot(snapshot, 1);
  assert.equal(first.ok, true);
  assert.equal(first.semantic_sorted, true);
  assert.equal(first.page, 1);
  assert.equal(first.totalPage, 3);
  assert.equal(first.records.length, 20);
  assert.equal(first.records[0].pnId, "CN1");
  const last = pageResultSnapshot(snapshot, 3);
  assert.equal(last.records.length, 5);
  assert.equal(last.records[4].pnId, "CN45");
  const beyond = pageResultSnapshot(snapshot, 4);
  assert.deepEqual(beyond.records, []);
  assert.equal(beyond.totalPage, 3);
  assert.deepEqual(Object.keys(first).sort(), ["ok", "page", "records", "semantic_sorted", "totalPage"]);
});

test("the store keeps the most recently used sessions and forgets the oldest", () => {
  const store = createResultSnapshotStore({ maxSessions: 2 });
  const snapshotFor = (id) => buildResultSnapshot({ sessionId: id, endpoint: "/overview", rows: [row({ pnId: "CN1", simVal: 1, semanticSort: 1, ssId: id })] });
  store.freeze(snapshotFor("S1"));
  store.freeze(snapshotFor("S2"));
  assert.ok(store.get("S1"), "reading S1 makes it recently used");
  store.freeze(snapshotFor("S3"));
  assert.equal(store.has("S2"), false, "S2 was the least recently used");
  assert.equal(store.has("S1"), true);
  assert.equal(store.has("S3"), true);
  assert.equal(store.get("unknown"), null);
  assert.equal(store.size(), 2);
  store.freeze({ sessionId: "" });
  assert.equal(store.size(), 2);
  store.clear();
  assert.equal(store.size(), 0);
});

test("the search lock runs holders one at a time in arrival order", async () => {
  const lock = createSearchLock({ waitMs: 1000 });
  const order = [];
  const releaseFirst = await lock.acquire();
  assert.equal(lock.busy(), true);
  const second = lock.acquire().then((release) => { order.push("second"); return release; });
  const third = lock.acquire().then((release) => { order.push("third"); return release; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(order, [], "nobody enters while the first holder runs");
  releaseFirst();
  releaseFirst();
  const releaseSecond = await second;
  assert.deepEqual(order, ["second"]);
  releaseSecond();
  const releaseThird = await third;
  assert.deepEqual(order, ["second", "third"]);
  releaseThird();
  assert.equal(lock.busy(), false);
});

test("waiting longer than the budget fails with SEARCH_BUSY and does not block later callers", async () => {
  const lock = createSearchLock({ waitMs: 10 });
  const release = await lock.acquire();
  await assert.rejects(lock.acquire(), (error) => error.code === "SEARCH_BUSY" && /retry this exact search/u.test(error.message));
  release();
  const next = await lock.acquire();
  assert.equal(typeof next, "function");
  next();
});

test("a cancelled wait fails with CANCELLED and gives its slot back", async () => {
  const lock = createSearchLock({ waitMs: 1000 });
  const release = await lock.acquire();
  const controller = new AbortController();
  const waiting = lock.acquire({ signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (error) => error.code === "CANCELLED");
  release();
  const next = await lock.acquire();
  next();
  await assert.rejects(lock.acquire({ signal: AbortSignal.abort() }), (error) => error.code === "CANCELLED");
});
