import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jwtExpiry } from "../src/auth/crypto.mjs";

const require = createRequire(import.meta.url);
const username = process.env.FUSION_TEST_USERNAME;
const password = process.env.FUSION_TEST_PASSWORD;
const elementId = process.env.FUSION_TEST_ELEMENT_ID || "1";

async function readSettings(settingsPath) {
  try {
    return JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

test("plugin entry obtains a live token and returns a successful live get_terms result", {
  skip: !(username && password),
}, async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "fusion-live-plugin-"));
  const settingsPath = join(dataPath, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ username, password }), "utf8");

  let registeredTool;
  const requests = [];
  const pi = {
    plugin: {
      getSettings: () => readSettings(settingsPath),
      setSettings: async (partial) => {
        const current = await readSettings(settingsPath);
        await writeFile(settingsPath, JSON.stringify({ ...current, ...partial }), "utf8");
      },
      getDataPath: async () => dataPath,
    },
    net: {
      fetch: async (input) => {
        const response = await fetch(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined,
        });
        const bodyText = await response.text();
        requests.push({
          origin: new URL(input.url).origin,
          status: response.status,
          hasBearer: /^Bearer\s+\S+/i.test(String(input.headers?.Authorization ?? "")),
        });
        return { status: response.status, bodyText };
      },
    },
    agent: {
      registerTool: async (tool) => { registeredTool = tool; },
      unregisterTool: async () => { registeredTool = undefined; },
    },
  };

  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    assert.equal(typeof registeredTool?.execute, "function", "the actual plugin entry registered its tool");
    const result = await registeredTool.execute({ action: "get_terms", element_id: elementId }, {});

    assert.equal(
      result?.ok,
      true,
      `live tool invocation failed: code=${String(result?.error?.code ?? "unknown")}; semantic_requests=${requests.length}; details withheld`,
    );
    assert.equal(result.action, "get_terms");
    assert.ok(Array.isArray(result.terms?.chinese));
    assert.ok(Array.isArray(result.terms?.english));
    assert.equal(requests.length, 1, "the read tool sent one live semantic request");
    assert.equal(requests[0].origin, "http://10.160.28.16");
    assert.equal(requests[0].status, 200);
    assert.equal(requests[0].hasBearer, true);

    const persisted = await readSettings(settingsPath);
    assert.equal(typeof persisted.token, "string");
    assert.ok((jwtExpiry(persisted.token) ?? 0) > Date.now() / 1000, "the plugin persisted a non-expired token");
    assert.equal(persisted.username === username, true, "username persisted in the isolated settings file");
    assert.equal(persisted.password === password, true, "password remained in the isolated settings file");
  } finally {
    try { await plugin.onUnload(); } finally {
      delete globalThis.pi;
      await rm(dataPath, { recursive: true, force: true });
    }
  }
});
