import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createSessionLaunchRuntime } = await import("../electron/main/runtime/session-launch.ts");

test("subagent catalog exposes arbitrary trusted-extension tools from the sidecar report", async () => {
  const calls = [];
  const extension = {
    id: "D:/plugins/arbitrary/src/index.mjs",
    pluginId: "local.arbitrary-plugin",
    pluginName: "Arbitrary plugin",
    entry: "src/index.mjs",
    root: "D:/plugins/arbitrary",
  };
  const runtime = createSessionLaunchRuntime({
    runtimeState: {
      host: {
        isAvailable: () => true,
        call: async (method) => {
          if (method === "skills.active") return { skills: [] };
          if (method === "mcp.active") return { servers: [] };
          throw new Error(`Unexpected host call ${method}`);
        },
      },
      sidecar: {
        call: async (method, params) => {
          calls.push({ method, params });
          return {
            reports: [
              {
                extensionId: extension.id,
                state: "loaded",
                toolNames: ["tool_registered_by_plugin_code"],
                commandNames: [],
                agentNames: [],
                eventNames: [],
              },
            ],
          };
        },
      },
    },
    logger: { app() {} },
    userMcp: {
      setRecords() {},
      listRecords: () => [],
      listStatuses: () => [],
    },
    plugins: {
      listLoaded: () => [],
      getSkills: () => [],
      getTools: () => [],
      getAgentExtensions: () => [extension],
    },
    agentExtensions: {
      hasReportForExtension: () => false,
      toolNamesForExtension: () => [],
    },
    sessionProjects: new Map(),
    dataDir: "D:/data",
    vendorOAuth: {},
    modelsDevCatalog: { ensureLoaded: async () => {}, findModel: () => undefined },
    getWorkspacePath: () => "D:/workspace",
    pluginActiveInProject: () => true,
    bindingForModel: () => undefined,
    modelsDevModelFor: () => undefined,
    effectiveSubagentModelConfig: () => ({ modelConfig: {}, capabilities: {} }),
    normalizeThinkingLevel: () => "off",
  });

  const catalog = await runtime.subagentToolCatalog("D:/workspace");
  assert.deepEqual(catalog.pluginTools, [
    {
      name: "tool_registered_by_plugin_code",
      label: "tool_registered_by_plugin_code",
      selector: "extension_tool_registered_by_plugin_code",
      pluginId: "local.arbitrary-plugin",
      pluginLabel: "Arbitrary plugin",
    },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "extensions.catalog");
  assert.deepEqual(calls[0].params.trustedExtensions, [
    {
      id: extension.id,
      entry: extension.entry,
      label: extension.pluginName,
      source: "plugin",
      root: extension.root,
    },
  ]);
});
