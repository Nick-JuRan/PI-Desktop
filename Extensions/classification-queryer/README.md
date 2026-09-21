# 分类号查询器

`分类号查询器` is a local Pi Extension for the PI-Desktop Agent sidecar. It
registers one selectable tool, `classification_query`, and delegates every
request to the official local IPC/CPC client used by the second-stage patent
workflow.

## Capabilities

The tool exposes one concise nested request shape. Any combination of code and
keyword queries can be sent in one call:

```json
{
  "ipc": {
    "codes": ["G06N3/02"],
    "keywords": ["神经网络"]
  },
  "cpc": {
    "codes": [],
    "keywords": ["神经网络"]
  }
}
```

`codes` returns the complete official tree for each IPC/CPC code. `keywords`
searches classification numbers using one independent short keyword per item.
Phrases, claim text, whitespace, operators, and wildcards are rejected before a
process is started. Code items may contain formatting spaces; they are
normalized before the official client is called. The tool accepts at most 20
items per list and 40 items per call.

The result is plain text intended for an Agent, not an API envelope:

```text
IPC
└── G
    └── G06
        └── G06N
            └── G06N3/02: 神经网络[2006.01]

CPC
└── G
    └── G06
        └── G06N
            └── G06N3/02: 神经网络
```

Code queries preserve the official ancestor and descendant tree. Keyword
matches are projected into a sparse code hierarchy and repeated branches are
merged. The output omits `request`, `year`, `language`, endpoint metadata,
operation fields, and the per-query response envelope. Query failures are
reported as one concise system/query line.

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
