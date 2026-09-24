import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

function makeFakeJwt(expSecondsFromNow) {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
}

function setupPi({ token, credentials = { username: "user1", password: "pw1" } } = {}) {
  let registeredTool;
  let settingsReads = 0;
  const settings = { ...credentials, ...(token ? { token } : {}) };
  const netCalls = [];
  const pi = {
    plugin: {
      getSettings: async () => {
        settingsReads += 1;
        return { ...settings };
      },
      setSettings: async (partial) => Object.assign(settings, partial),
      getDataPath: async () => "unused",
    },
    net: {
      fetch: async (input) => {
        netCalls.push(input);
        const isCreate = input.url.endsWith("/neusipo-app-search/element/addElement");
        const response = isCreate
          ? { status: 200, t: "ELEMENT-1", message: "SUCCESS" }
          : {
            status: 200,
            t: {
              code: "200",
              data: {
                records: [{ srcEle: [{ sec: "cn", eles: [{ wd: "claim term", wt: 4 }] }] }],
              },
            },
          };
        return { status: 200, bodyText: JSON.stringify(response) };
      },
    },
    agent: {
      registerTool: async (tool) => { registeredTool = tool; },
      unregisterTool: async () => {},
    },
  };
  return { pi, getRegisteredTool: () => registeredTool, netCalls, settings, settingsReads: () => settingsReads };
}

test("the tool validates the action before touching credentials", async () => {
  const { pi, getRegisteredTool, settingsReads } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({ action: "bogus" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_INPUT");
    assert.equal(settingsReads(), 0, "an invalid action must not read settings");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("the registered schema exposes two claim-scoped actions and supported case-number kinds", async () => {
  const { pi, getRegisteredTool } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    assert.deepEqual(tool.schema.properties.action.enum, ["prepare", "update_terms"]);
    assert.deepEqual(tool.schema.properties.reference_kind.enum, [
      "application_number",
      "publication_number",
      "text",
    ]);
    assert.equal(tool.planSafeActions, undefined);
    assert.match(tool.description, /one explicitly specified patent claim/i);
    assert.match(tool.description, /not the application as a whole/i);
    assert.match(tool.schema.properties.reference_kind.description, /your own paraphrase/i);
    assert.match(tool.schema.properties.reference_kind.description, /Do not copy the claim verbatim/i);
    assert.match(tool.schema.properties.reference_kind.description, /No other case-number type is accepted/);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("a tool call uses the stored token and sends it as the Authorization header", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({
      action: "prepare",
      reference_kind: "application_number",
      reference: "202010123456.7",
    }, {});
    assert.equal(result.ok, true);
    assert.equal(result.action, "prepare");
    assert.deepEqual(result.terms, { chinese: [{ term: "claim term", weight: 4 }], english: [] });
    assert.equal(netCalls.length, 2);
    assert.ok(netCalls.every((input) => input.headers.Authorization === `Bearer ${token}`));
    assert.equal(netCalls[0].url, "http://10.160.28.16/api/neusipo-app-search/element/addElement");
    assert.equal(netCalls[1].url, "http://10.160.28.16/api/neusipo-app-search/fusionSearch/element/retrieval");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("an expiring token with no credentials reports AUTH_CONFIG_MISSING, not a silent replay", async () => {
  const expiring = makeFakeJwt(60);
  const { pi, getRegisteredTool, netCalls } = setupPi({
    token: expiring,
    credentials: {},
  });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({
      action: "prepare",
      reference_kind: "publication_number",
      reference: "CN123456A",
    }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTH_CONFIG_MISSING");
    assert.equal(netCalls.length, 0, "no search request was sent with the expiring token");
    assert.match(result.error.message, /settings\.json/);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});
