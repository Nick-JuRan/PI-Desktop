const manifest = require("./manifest.json");

let registered = false;
let tokenManager = null;
let implementations = null;
let toErrorResult = (error) => ({
  ok: false,
  error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) },
});

function getContribution() {
  const contribution = manifest.contributes?.agentTools?.find(
    (tool) => tool.name === "fusion_semantic_baseline",
  );
  if (!contribution) throw new Error("fusion_semantic_baseline contribution is missing");
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

async function onToolExecute(args, context) {
  return implementations.toolExecutor.executeFusionTool({
    args,
    signal: context?.signal,
    tokenManager: getTokenManager(),
    fetchImpl: (input) => pi.net.fetch(input),
  });
}

async function onLoad() {
  const contribution = getContribution();
  implementations = await loadImplementations();
  ({ toErrorResult } = await import("./src/errors.mjs"));

  await pi.agent.registerTool({
    ...contribution,
    execute: async (args, context) => {
      try {
        return await onToolExecute(args, context);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  });
  registered = true;
}

async function onUnload() {
  tokenManager?.dispose();
  try {
    if (registered) await pi.agent.unregisterTool("fusion_semantic_baseline");
  } finally {
    registered = false;
    tokenManager = null;
    implementations = null;
  }
}

module.exports = { onLoad, onUnload };
