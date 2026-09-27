const manifest = require("./manifest.json");

/**
 * Plugin entry. Registers the CNKI agent tools declared in manifest.json and
 * wires the shared services: one throttle for every CNKI request, a cookie
 * manager that logs in by IP (or uses the private `cookie` setting) before the
 * first tool call, and the host fetch for audited page requests.
 */
let registered = false;
let registeredToolNames = [];
let services = null;
let modules = null;
let toErrorResult = (error) => ({
  ok: false,
  error: { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) },
});

function getContribution(name) {
  const contribution = manifest.contributes?.agentTools?.find((tool) => tool.name === name);
  if (!contribution) throw new Error(`${name} contribution is missing`);
  return contribution;
}

async function loadModules() {
  if (!modules) {
    const [tools, cookieManager, throttle, errors] = await Promise.all([
      import("./src/tools.mjs"),
      import("./src/cookie-manager.mjs"),
      import("./src/throttle.mjs"),
      import("./src/errors.mjs"),
    ]);
    modules = { tools, cookieManager, throttle, errors };
  }
  return modules;
}

function log(message) {
  // The plugin host forwards the process's stderr to the desktop plugin log.
  console.error(`[non-patent-search] ${message}`);
}

function createServices() {
  const throttle = modules.throttle.createThrottle();
  const cookies = modules.cookieManager.createCookieManager({
    readSettings: () => pi.plugin.getSettings(),
    throttle,
    log,
  });
  return {
    throttle,
    cookies,
    fetchImpl: (input) => pi.net.fetch(input),
  };
}

async function onToolExecute(name, args, context) {
  const common = {
    args,
    cookies: services.cookies,
    fetchImpl: services.fetchImpl,
    throttle: services.throttle,
    signal: context?.signal,
    log: (message) => context?.log?.(message) ?? log(message),
  };
  if (name === "CNKI_ScanPaper") return modules.tools.executeScanPaper(common);
  if (name === "CNKI_GetPaperMainBody") return modules.tools.executeGetPaperMainBody(common);
  throw new Error(`unknown tool ${name}`);
}

async function onLoad() {
  modules = await loadModules();
  ({ toErrorResult } = modules.errors);
  services = createServices();
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
  // Have the CNKI session ready before the first tool call; failures only log.
  services.cookies.warmUp();
}

async function onUnload() {
  try {
    if (registered) {
      await Promise.all(registeredToolNames.map((name) => pi.agent.unregisterTool(name)));
    }
  } finally {
    services?.cookies?.dispose();
    registered = false;
    registeredToolNames = [];
    services = null;
    modules = null;
  }
}

module.exports = { onLoad, onUnload };
