import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClassifierArgs,
  limits,
  normalizeQueryInput,
  parseClassifierOutput,
  summarizeResults,
} from "../src/query.mjs";
import {
  CLASSIFICATION_QUERY_SCHEMA,
  createClassificationQueryTool,
} from "../src/index.mjs";

test("plans all four query types in one deterministic request list", () => {
  const requests = normalizeQueryInput({
    ipc_codes: ["g06f 16/903", "G06F16/903"],
    cpc_codes: ["G06F16/903"],
    ipc_keywords: ["检索"],
    cpc_keywords: ["检索"],
  });

  assert.deepEqual(requests.map(({ system, kind, value }) => ({ system, kind, value })), [
    { system: "IPC", kind: "code", value: "G06F16/903" },
    { system: "CPC", kind: "code", value: "G06F16/903" },
    { system: "IPC", kind: "keyword", value: "检索" },
    { system: "CPC", kind: "keyword", value: "检索" },
  ]);
  assert.deepEqual(buildClassifierArgs(requests[0]), [
    "-X", "utf8", "ipc_api.py", "search", "--ipccpc", "IPC", "--ipcno", "G06F16/903",
  ]);
});

test("rejects phrases and empty calls before spawning the classifier", () => {
  assert.throws(() => normalizeQueryInput({ ipc_keywords: ["信息 检索"] }), /short keyword/);
  assert.throws(() => normalizeQueryInput({}), /at least one/);
  assert.throws(
    () => normalizeQueryInput({ ipc_keywords: Array.from({ length: limits.maxItemsPerBucket + 1 }, () => "检索") }),
    /at most/,
  );
});

test("preserves official JSON success and business-error payloads", () => {
  const success = parseClassifierOutput({ stdout: '{"ok":true,"data":[]}', stderr: "", code: 0 });
  const failure = parseClassifierOutput({ stdout: '{"ok":false,"error":{"type":"search_result_error"}}', stderr: "", code: 1 });

  assert.deepEqual(success, { ok: true, data: [] });
  assert.deepEqual(failure, { ok: false, error: { type: "search_result_error" } });
});

test("registers one pi-agent tool and executes every planned query", async () => {
  const calls = [];
  const tool = createClassificationQueryTool({
    classifierRoot: "CLASSIFIER_ROOT",
    pythonCommand: "python",
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: JSON.stringify({ ok: true, operation: "search", data: [] }),
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  });

  assert.equal(tool.name, "classification_query");
  assert.deepEqual(tool.parameters, CLASSIFICATION_QUERY_SCHEMA);
  const result = await tool.execute("tool-1", {
    ipc_codes: ["G06F16/903"],
    cpc_codes: ["G06F16/903"],
    ipc_keywords: ["检索"],
    cpc_keywords: ["检索"],
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.cwd, "CLASSIFIER_ROOT");
  assert.equal(calls[0].args.at(-2), "--ipcno");
  assert.equal(calls[2].args.at(-2), "--content");
  assert.equal(JSON.parse(result.content[0].text).summary.succeeded, 4);
  assert.equal(summarizeResults(result.details.results).failed, 0);
});
