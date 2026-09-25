const manifest = require("./manifest.json");

let registered = false;
let registeredToolNames = [];
let activeSemanticElementId = null;
let tokenManager = null;
let implementations = null;
let toErrorResult = (error) => ({
  ok: false,
  error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) },
});

function getContribution(name) {
  const contribution = manifest.contributes?.agentTools?.find((tool) => tool.name === name);
  if (!contribution) throw new Error(`${name} contribution is missing`);
  return contribution;
}

async function loadImplementations() {
  if (!implementations) {
    const [toolExecutor, tokenManagerModule] = await Promise.all([
      import("./src/tool-executor.mjs"),
      import("./src/token-manager.mjs"),
    ]);
    implementations = { toolExecutor, tokenManagerModule };
  }
  return implementations;
}

function getTokenManager() {
  if (!tokenManager) {
    tokenManager = implementations.tokenManagerModule.createTokenManager({ pi });
  }
  return tokenManager;
}

async function onToolExecute(name, args, context) {
  const common = {
    args,
    signal: context?.signal,
    tokenManager: getTokenManager(),
    fetchImpl: (input) => pi.net.fetch(input),
  };
  if (name === "fusion_boolean_search") {
    return implementations.toolExecutor.executeFusionBooleanTool({
      ...common,
      ...(activeSemanticElementId ? { semanticElementId: activeSemanticElementId } : {}),
    });
  }
  if (name === "fusion_semantic_result_page") {
    return implementations.toolExecutor.executeFusionResultPageTool(common);
  }
  const result = await implementations.toolExecutor.executeFusionTool(common);
  if (result?.ok === true) {
    if (args?.action === "prepare" && result.element_id !== undefined) {
      activeSemanticElementId = String(result.element_id);
    } else if (args?.action === "update_terms" && args.element_id !== undefined) {
      activeSemanticElementId = String(args.element_id);
    }
  }
  return result;
}

async function onLoad() {
  implementations = await loadImplementations();
  ({ toErrorResult } = await import("./src/errors.mjs"));
  const names = (manifest.contributes?.agentTools ?? []).map((tool) => tool.name);
  const installed = [];
  try {
    for (const name of names) {
      const contribution = getContribution(name);
      await pi.agent.registerTool({
        ...contribution,
        execute: async (args, context) => {
          try {
            return await onToolExecute(name, args, context);
          } catch (error) {
            return toErrorResult(error);
          }
        },
      });
      installed.push(name);
    }
    registeredToolNames = installed;
    registered = true;
  } catch (error) {
    await Promise.allSettled(installed.map((name) => pi.agent.unregisterTool(name)));
    throw error;
  }
}

async function onUnload() {
  tokenManager?.dispose();
  try {
    if (registered) {
      await Promise.all(registeredToolNames.map((name) => pi.agent.unregisterTool(name)));
    }
  } finally {
    registered = false;
    registeredToolNames = [];
    tokenManager = null;
    activeSemanticElementId = null;
    implementations = null;
  }
}

module.exports = { onLoad, onUnload };
