/**
 * Loads this extension in the real PI-Desktop plugin runtime: a forked plugin
 * host process, the real manifest validation and permission gateway, and the
 * real tool registration IPC. CNKI itself is faked at the network edge: the
 * forked host is started with `--require test/helpers/fake-cnki.cjs`, which
 * answers `https.request` from the fixtures and logs every request, so nothing
 * leaves the process. The session cookie comes from the private settings file,
 * so no login request is made.
 *
 * Needs the desktop workspace dependencies built (`pnpm --filter
 * @pi-desktop/desktop build:deps`); it skips itself otherwise.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..");
const repoRoot = join(here, "..", "..", "..");
const desktopRoot = join(repoRoot, "apps", "desktop");

const depsBuilt = existsSync(join(repoRoot, "packages", "shared", "dist", "index.js"));

// The runtime resolves the plugin data directory from this variable at call time.
const dataDir = mkdtempSync(join(tmpdir(), "pi-non-patent-search-"));
process.env.PI_DESKTOP_DATA_DIR = dataDir;
const settingsDir = join(dataDir, "plugins", "data", "local.non-patent-search");
mkdirSync(settingsDir, { recursive: true });
writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ cookie: "harness=cookie" }), "utf8");
const requestLog = join(dataDir, "cnki-requests.jsonl");

function forkPluginProcess({ entry }) {
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    execArgv: ["--require", join(here, "helpers", "fake-cnki.cjs")],
    env: { ...process.env, FAKE_CNKI_FIXTURES: join(here, "fixtures"), FAKE_CNKI_LOG: requestLog },
  });
  child.stderr.on("data", () => {});
  child.stdout.on("data", () => {});
  return {
    postMessage: (message) => {
      if (child.connected) child.send(message);
    },
    onMessage: (handler) => child.on("message", handler),
    onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
    kill: () => child.kill(),
  };
}

test("the extension loads in the real plugin runtime and both CNKI tools work through it", { skip: !depsBuilt && "desktop workspace deps are not built" }, async (t) => {
  register(pathToFileURL(join(desktopRoot, "test", "helpers", "ts-import-hooks.mjs")));
  const { PluginRuntime } = await import(pathToFileURL(join(desktopRoot, "electron", "main", "plugin-runtime.ts")).href);

  const audits = [];
  const hostFetches = [];
  const runtime = new PluginRuntime({
    hostEntry: join(desktopRoot, "electron", "main", "plugin-host-process.mjs"),
    spawnProcess: forkPluginProcess,
    audit: (entry) => audits.push(entry),
    fetch: async (input) => {
      hostFetches.push(input);
      return { status: 500, headers: {}, bodyText: "pi.net.fetch must not carry CNKI traffic" };
    },
  });
  t.after(async () => {
    for (const loaded of runtime.listLoaded()) await runtime.unload(loaded.manifest.id);
  });

  await runtime.loadFromPath(extensionDir);
  const loaded = runtime.listLoaded().find((entry) => entry.manifest.id === "local.non-patent-search");
  assert.ok(loaded, "manifest accepted and plugin loaded");
  assert.equal(loaded.manifest.name, "非专利检索");

  const tools = runtime.getTools().filter((tool) => tool.pluginId === "local.non-patent-search" || String(tool.name).includes("CNKI"));
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["CNKI_GetPaperMainBody", "CNKI_ScanPaper"]);

  const scan = tools.find((tool) => tool.name === "CNKI_ScanPaper");
  const result = await scan.execute({ value: "格罗皮乌斯" }, { sessionId: "harness", log: () => {} });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(Object.keys(result), ["ok", "pageNum", "totalPage", "totalHits", "papers"]);
  assert.equal(result.pageNum, 1);
  assert.equal(result.totalPage, 62);
  assert.equal(result.papers.length, 2);
  assert.deepEqual(Object.keys(result.papers[0]), ["Title", "Href", "Abstract", "HTML_READING_URL"]);
  assert.equal(result.papers[0].HTML_READING_URL, "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123&uniplatform=NZKPT");

  const body = tools.find((tool) => tool.name === "CNKI_GetPaperMainBody");
  const text = await body.execute(
    { href: "https://kns.cnki.net/nzkhtml/knsread/index?fileName=F&tableName=T&dbCode=D&invoice=I" },
    { sessionId: "harness", log: () => {} },
  );
  assert.equal(typeof text, "string");
  assert.match(text, /^基于格罗皮乌斯的现代建筑教育研究\n\n1 引言\n格罗皮乌斯/);

  const requests = readFileSync(requestLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(requests.length, 4, `search + 2 abstract pages + reader JSON (${requests.length})`);
  assert.equal(new URLSearchParams(requests[0].body).get("pageSize"), "20");
  assert.ok(requests.every((call) => new URL(call.url).hostname.endsWith(".cnki.net")), "only cnki.net hosts");
  assert.ok(requests.every((call) => call.headers.Cookie === "harness=cookie"), "the settings cookie is sent verbatim on every request, no login happened");
  assert.ok(requests.every((call) => call.headers.Referer === "https://kns.cnki.net/" && /Chrome\/114/.test(call.headers["User-Agent"])), "crawler headers on every request");
  assert.deepEqual(hostFetches, [], "no CNKI request went through pi.net.fetch");
  const denied = audits.filter((entry) => entry.ok === false);
  assert.deepEqual(denied, [], "no permission or egress denials");
});
