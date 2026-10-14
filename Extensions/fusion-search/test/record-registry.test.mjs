import assert from "node:assert/strict";
import test from "node:test";

import { createRecordRegistry, publicationMembers } from "../src/record-registry.mjs";

test("publication members split the provider value and normalize spelling", () => {
  assert.deepEqual(publicationMembers("CN115123456A;cn 115123456 B"), ["CN115123456A", "CN115123456B"]);
  assert.deepEqual(publicationMembers("  "), []);
  assert.deepEqual(publicationMembers(undefined), []);
});

test("a result-page row is resolvable by the whole pnId or by any member", () => {
  const registry = createRecordRegistry();
  registry.rememberSession("SESSION-1", "cntxt");
  registry.rememberRecords("SESSION-1", [
    { ssId: "SESSION-1", pnId: "CN1A;CN1B", anId: "CN2022001.1", dbName: "CNTXT", ti: "Title one" },
  ]);
  const expected = { pnId: "CN1A;CN1B", anId: "CN2022001.1", database: "CNTXT", sessionId: "SESSION-1", title: "Title one" };
  assert.deepEqual(registry.resolve("CN1A;CN1B"), expected);
  assert.deepEqual(registry.resolve("cn1b"), expected);
  assert.deepEqual(registry.resolve("CN1A"), expected);
  assert.equal(registry.resolve("CN9Z"), null);
});

test("a row without dbName falls back to the database its session was searched in", () => {
  const registry = createRecordRegistry();
  registry.rememberSession("SESSION-2", "ENTXT");
  registry.rememberRecords("SESSION-2", [{ pnId: "US1A", ti: "Title" }]);
  assert.deepEqual(registry.resolve("US1A"), {
    pnId: "US1A",
    anId: "",
    database: "ENTXT",
    sessionId: "SESSION-2",
    title: "Title",
  });
  assert.equal(registry.databaseForSession("SESSION-2"), "ENTXT");
  assert.equal(registry.databaseForSession("unknown"), "");
});

test("malformed rows and blank identifiers are ignored", () => {
  const registry = createRecordRegistry();
  registry.rememberSession("", "CNTXT");
  registry.rememberSession("SESSION-3", "");
  registry.rememberRecords("SESSION-3", [null, "row", { ti: "no pnId" }, { pnId: " ; " }]);
  registry.rememberRecords("SESSION-3", "not-an-array");
  assert.equal(registry.resolve("anything"), null);
  assert.equal(registry.databaseForSession("SESSION-3"), "");
});

test("the registry is bounded and evicts the oldest records first", () => {
  const registry = createRecordRegistry({ maxRecords: 2, maxSessions: 1 });
  registry.rememberSession("S1", "CNTXT");
  registry.rememberSession("S2", "ENTXT");
  assert.equal(registry.databaseForSession("S1"), "");
  assert.equal(registry.databaseForSession("S2"), "ENTXT");
  registry.rememberRecords("S2", [{ pnId: "A1" }, { pnId: "A2" }, { pnId: "A3" }]);
  assert.equal(registry.resolve("A1"), null);
  assert.ok(registry.resolve("A2"));
  assert.ok(registry.resolve("A3"));
});

test("re-listing a record refreshes it instead of duplicating it", () => {
  const registry = createRecordRegistry();
  registry.rememberRecords("S1", [{ pnId: "A1", ti: "old", anId: "" }]);
  registry.rememberRecords("S2", [{ pnId: "A1", ti: "new", anId: "AN1" }]);
  assert.deepEqual(registry.resolve("A1"), { pnId: "A1", anId: "AN1", database: "", sessionId: "S2", title: "new" });
  registry.clear();
  assert.equal(registry.resolve("A1"), null);
});
