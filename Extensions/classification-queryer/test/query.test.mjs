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

test("plans all four query types from one concise IPC/CPC request", () => {
  const requests = normalizeQueryInput({
    ipc: {
      codes: ["g06f 16/903", "G06F16/903"],
      keywords: ["检索"],
    },
    cpc: {
      codes: ["G06F16/903"],
      keywords: ["检索"],
    },
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
  assert.throws(
    () => normalizeQueryInput({ ipc: { keywords: ["信息 检索"] } }),
    /short keyword/,
  );
  assert.throws(() => normalizeQueryInput({}), /at least one/);
  assert.throws(
    () => normalizeQueryInput({ ipc: { keywords: Array.from({ length: limits.maxItemsPerBucket + 1 }, () => "检索") } }),
    /at most/,
  );
});

test("accepts the previous flat request shape for existing callers", () => {
  const requests = normalizeQueryInput({ ipc_keywords: ["检索"] });
  assert.deepEqual(requests.map(({ system, kind, value }) => ({ system, kind, value })), [
    { system: "IPC", kind: "keyword", value: "检索" },
  ]);
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
      const isCodeQuery = args.at(-2) === "--ipcno";
      return {
        stdout: JSON.stringify(isCodeQuery
          ? {
            ok: true,
            operation: "code",
            data: { tree: [{ code: "G06F16/903", content: "代码结果", children: [] }] },
          }
          : {
            ok: true,
            operation: "keyword",
            data: [{ code: "G06N3/02", content: "检索结果" }],
          }),
        stderr: "",
        code: 0,
        killed: false,
      };
    },
  });

  assert.equal(tool.name, "classification_query");
  assert.deepEqual(tool.parameters, CLASSIFICATION_QUERY_SCHEMA);
  assert.deepEqual(Object.keys(tool.parameters.properties), ["ipc", "cpc"]);
  assert.deepEqual(Object.keys(tool.parameters.properties.ipc.properties), ["codes", "keywords"]);
  const result = await tool.execute("tool-1", {
    ipc: {
      codes: ["G06F16/903"],
      keywords: ["检索"],
    },
    cpc: {
      codes: ["G06F16/903"],
      keywords: ["检索"],
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].options.cwd, "CLASSIFIER_ROOT");
  assert.equal(calls[0].args.at(-2), "--ipcno");
  assert.equal(calls[2].args.at(-2), "--content");
  assert.match(result.content[0].text, /^IPC\n/);
  assert.match(result.content[0].text, /G06F16\/903: /);
  assert.match(result.content[0].text, /检索/);
  assert.match(result.content[0].text, /CPC\n/);
  assert.doesNotMatch(result.content[0].text, /"system"|"kind"|"response"|"request"/);
  assert.equal(result.details, undefined);
  assert.equal(summarizeResults([{ response: { ok: true } }]).failed, 0);
});

test("returns concise query errors without exposing the classifier envelope", async () => {
  const tool = createClassificationQueryTool({
    exec: async () => ({
      stdout: JSON.stringify({
        ok: false,
        error: { type: "search_result_error", message: "该搜索没有结果" },
      }),
      stderr: "",
      code: 1,
      killed: false,
    }),
  });

  const result = await tool.execute("tool-error", { ipc: { keywords: ["神经网络"] } });
  assert.equal(result.content[0].text, "IPC 关键词“神经网络”：该搜索没有结果");
  assert.equal(result.details, undefined);
  assert.doesNotMatch(result.content[0].text, /request|year|language|operation|response/);
});
