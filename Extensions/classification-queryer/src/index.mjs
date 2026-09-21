import {
  buildClassifierArgs,
  normalizeQueryInput,
  parseClassifierOutput,
} from "./query.mjs";
import {
  addKeywordRows,
  addOfficialTree,
  classificationErrorLabel,
  createClassificationTree,
  renderClassificationTrees,
} from "./presentation.mjs";

export const DEFAULT_CLASSIFIER_ROOT = "D:\\专利局\\逆向目录\\外网-IPC分类检索\\官方IPCCPC";
export const DEFAULT_PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
export const CLASSIFIER_TIMEOUT_MS = 45_000;
export const CLASSIFIER_MAX_BUFFER = 16 * 1024 * 1024;

const QUERY_SCOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    codes: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "IPC/CPC codes whose complete official tree should be returned.",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "Single short keywords used to discover IPC/CPC classification numbers.",
    },
  },
  minProperties: 1,
};

export const CLASSIFICATION_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ipc: {
      ...QUERY_SCOPE_SCHEMA,
      description: "IPC queries. Include codes, keywords, or both.",
    },
    cpc: {
      ...QUERY_SCOPE_SCHEMA,
      description: "CPC queries. Include codes, keywords, or both.",
    },
  },
  minProperties: 1,
};

function environmentValue(name, fallback) {
  const value = typeof process?.env?.[name] === "string" ? process.env[name].trim() : "";
  return value || fallback;
}

export function createClassificationQueryTool({
  exec,
  classifierRoot = environmentValue("PATENT_IPCCPC_ROOT", DEFAULT_CLASSIFIER_ROOT),
  pythonCommand = environmentValue("PATENT_PYTHON", DEFAULT_PYTHON_COMMAND),
  timeoutMs = CLASSIFIER_TIMEOUT_MS,
  maxBuffer = CLASSIFIER_MAX_BUFFER,
} = {}) {
  if (typeof exec !== "function") throw new TypeError("exec is required");

  return {
    name: "classification_query",
    label: "分类号查询器",
    description:
      "Query official IPC/CPC classification trees and search classification numbers by keyword. " +
      "Use one concise nested request; the result is a readable IPC/CPC tree without API metadata.",
    promptSnippet: "Query IPC/CPC codes or discover codes from short keywords and get a tree",
    promptGuidelines: [
      "Use classification_query for official IPC/CPC code-tree verification and keyword discovery.",
      "Put every independent short keyword in its own array item; do not send phrases or claims as keywords.",
      "Use one nested call with ipc.codes, ipc.keywords, cpc.codes, and cpc.keywords when all four query types are needed.",
      "Read the returned IPC/CPC tree directly; it intentionally omits request, year, language, endpoint, and response-envelope metadata.",
    ],
    parameters: CLASSIFICATION_QUERY_SCHEMA,
    async execute(_toolCallId, params, signal) {
      const requests = normalizeQueryInput(params);
      const trees = new Map();

      for (const request of requests) {
        if (signal?.aborted) throw new Error("classification query cancelled");

        let response;
        try {
          const processResult = await exec(
            pythonCommand,
            buildClassifierArgs(request),
            {
              cwd: classifierRoot,
              signal,
              timeout: timeoutMs,
              maxBuffer,
            },
          );
          response = parseClassifierOutput(processResult);
        } catch (error) {
          response = {
            ok: false,
            error: {
              type: "process_error",
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }

        const tree = trees.get(request.system) ?? createClassificationTree(request.system);
        trees.set(request.system, tree);
        if (response.ok === true) {
          if (request.kind === "keyword") {
            addKeywordRows(tree, response.data);
          } else {
            addOfficialTree(tree, response.data?.tree);
          }
        } else {
          tree.errors.push(classificationErrorLabel(request, response));
        }
      }

      return {
        content: [{ type: "text", text: renderClassificationTrees([...trees.values()]) }],
      };
    },
  };
}

export default function classificationQueryerExtension(pi) {
  pi.registerTool(
    createClassificationQueryTool({
      exec: (command, args, options) => pi.exec(command, args, options),
    }),
  );
}
