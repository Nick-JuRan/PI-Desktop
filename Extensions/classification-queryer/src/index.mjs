import {
  buildClassifierArgs,
  normalizeQueryInput,
  parseClassifierOutput,
  summarizeResults,
} from "./query.mjs";

export const DEFAULT_CLASSIFIER_ROOT = "D:\\专利局\\逆向目录\\外网-IPC分类检索\\官方IPCCPC";
export const DEFAULT_PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";
export const CLASSIFIER_TIMEOUT_MS = 45_000;
export const CLASSIFIER_MAX_BUFFER = 16 * 1024 * 1024;

export const CLASSIFICATION_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ipc_codes: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "IPC classification codes whose complete official tree should be returned.",
    },
    cpc_codes: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "CPC classification codes whose complete official tree should be returned.",
    },
    ipc_keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "Single short keywords to search for IPC classification numbers.",
    },
    cpc_keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
      description: "Single short keywords to search for CPC classification numbers.",
    },
  },
};

function environmentValue(name, fallback) {
  const value = typeof process?.env?.[name] === "string" ? process.env[name].trim() : "";
  return value || fallback;
}

function progressText(request, index, total) {
  return `Querying ${request.system} ${request.kind} ${JSON.stringify(request.value)} (${index}/${total})`;
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
      "One call can contain IPC codes, CPC codes, IPC keywords, and CPC keywords.",
    promptSnippet: "Query IPC/CPC codes or discover codes from single short keywords",
    promptGuidelines: [
      "Use classification_query for official IPC/CPC code-tree verification and keyword discovery.",
      "Put every independent short keyword in its own array item; do not send phrases or claims as keywords.",
      "Use one call with ipc_codes, cpc_codes, ipc_keywords, and cpc_keywords when all four query types are needed.",
    ],
    parameters: CLASSIFICATION_QUERY_SCHEMA,
    async execute(_toolCallId, params, signal, onUpdate) {
      const requests = normalizeQueryInput(params);
      const results = [];

      for (const [index, request] of requests.entries()) {
        if (signal?.aborted) throw new Error("classification query cancelled");
        onUpdate?.({
          content: [{ type: "text", text: progressText(request, index + 1, requests.length) }],
        });

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

        results.push({
          system: request.system,
          kind: request.kind,
          query: request.value,
          response,
        });
      }

      const output = {
        ok: results.every((result) => result.response?.ok === true),
        summary: summarizeResults(results),
        results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        details: output,
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
