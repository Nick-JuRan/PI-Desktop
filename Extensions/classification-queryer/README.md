# 分类号查询器

`分类号查询器` is a local Pi Extension for the PI-Desktop Agent sidecar. It
registers one selectable tool, `classification_query`, and delegates every
request to the official local IPC/CPC client used by the second-stage patent
workflow.

## Capabilities

One tool call can contain any combination of these four request lists:

| Input field | Operation |
| --- | --- |
| `ipc_codes` | Return the complete official IPC tree for each code |
| `cpc_codes` | Return the complete official CPC tree for each code |
| `ipc_keywords` | Search IPC classification numbers by one short keyword per item |
| `cpc_keywords` | Search CPC classification numbers by one short keyword per item |

Keyword items must be independent short words. Phrases, claim text, whitespace,
operators, and wildcards are rejected before a process is started. Code items
may contain formatting spaces; they are normalized before the official client
is called. The tool accepts at most 20 items per list and 40 items per call.

The result keeps the official JSON payload for every request. Keyword queries
are returned as the official flat `data` list; code queries are returned as the
official recursive `data.tree`, including ancestor and descendant nodes.

## Runtime configuration

The extension invokes the existing launcher with `pi.exec`:

```text
python -X utf8 ipc_api.py search --ipccpc IPC|CPC --content WORD|--ipcno CODE
```

Defaults are suitable for the current Windows workstation:

```text
PATENT_IPCCPC_ROOT=D:\专利局\逆向目录\外网-IPC分类检索\官方IPCCPC
PATENT_PYTHON=python
```

Set `PATENT_IPCCPC_ROOT` when the official classifier is installed elsewhere.
The classifier itself fixes the query year to 2026 and the language to Chinese,
matching the second-stage workflow.

## PI-Desktop loading

The folder contains both the PI-Desktop manifest and the official Pi package
metadata:

1. For a development plugin, open **Plugins → Load development plugin** and
   select this folder. Review and grant `agent.extension`.
2. To use the official Pi package path, run `pi -e` with this folder or import
   `src/index.mjs` through **Plugins → Import pi extension**. PI-Desktop wraps
   the `pi.extensions` entry as a local plugin and still requires the explicit
   `agent.extension` grant.
3. In Agent mode, use ToolSearch if the non-core tool is deferred, then select
   `classification_query`.

No host-core RPC, renderer IPC, database schema, or project source dependency
is added. The plugin only relies on the local official classifier and the
standard Pi ExtensionAPI.

## Validation

From this directory:

```powershell
node --test test/*.test.mjs
```

From the PI-Desktop repository root:

```powershell
pnpm pi-plugin check .\Extensions\classification-queryer
pnpm pi-plugin pack .\Extensions\classification-queryer
```

The package is intentionally dependency-free so PI-Desktop's bundled
ExtensionAPI shim can load it without a plugin-local install step.
