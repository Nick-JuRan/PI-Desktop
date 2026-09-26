# 90-04. Classification query plugin

Fork feature. `Extensions/classification-queryer` is a fork-owned trusted
extension that registers the `classification_query` agent tool; it hooks no
upstream file. Its authoring documentation is
`Extensions/classification-queryer/README.md`.

## 1. Scope

- The tool answers IPC and CPC classification questions in one call. Its schema
  presents only `ipc.codes`, `ipc.keywords`, `cpc.codes`, and `cpc.keywords`.
- Results are plain text rooted at `IPC` and/or `CPC`: code queries retain the
  official ancestor/descendant tree, keyword hits are merged into a sparse
  hierarchy with leaf descriptions attached to codes, and failures are concise
  query lines. No request, year, language, endpoint, operation, or per-query
  response-envelope fields appear in the result.
- Because it is a trusted extension, its tool reaches subagents through the
  selection mechanism in `02-subagent-tool-selection.md`.

## 2. E2E scenarios

#### E2E-PLUGIN-classification-query-tree

- **Preconditions**: Agent mode; the local `classification-queryer` plugin is
  loaded with `agent.extension` granted; its official IPC/CPC classifier fixture
  is available; a user-owned subagent can be edited in Settings → Agent.
- **Steps**:
  1. Open Settings → Agent → Subagents, edit the user-owned subagent, expand
     **Advanced**, and confirm `classification_query` is discovered from the
     loaded extension catalog. Select it and save; reopen the editor to verify
     the selection persists.
  2. Start a new Agent turn and delegate to the edited subagent. Ask it to call
     `classification_query` once with nested `ipc` and `cpc` objects containing
     code and keyword arrays.
  3. Inspect the tool result for both classification systems and repeat with a
     code-only query and a keyword-only query.
- **Expected**: The tool selector is populated from the live extension tool
  catalog rather than a project-source hardcoded name list. The schema presents
  only concise `ipc.codes`, `ipc.keywords`, `cpc.codes`, and `cpc.keywords`
  inputs. One call executes all requested query types. The result is plain text
  rooted at `IPC` and/or `CPC`, with classification codes grouped as a readable
  tree and leaf descriptions attached to codes. It contains no `request`,
  `year`, `language`, endpoint, operation, or per-query response-envelope
  fields. Code queries retain the official ancestor/descendant tree; keyword
  hits are merged into a sparse hierarchy; failures are concise query lines.
- **Specs linked**: this page; `02-subagent-tool-selection.md`;
  `07-plugins/16-trusted-extensions.md` §7;
  `Extensions/classification-queryer/README.md`
- **Acceptance**: E (tools & permissions), G (plugin activation), Quality
- **Milestone**: M6+
- **Status**: Unit-covered by
  `Extensions/classification-queryer/test/query.test.mjs` and
  `Extensions/classification-queryer/test/presentation.test.mjs`; the loaded
  plugin Settings/sidecar journey remains to be run in a capable desktop
  environment.
