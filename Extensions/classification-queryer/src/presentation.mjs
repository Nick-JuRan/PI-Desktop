const CODE_PREFIX_LENGTHS = [1, 3, 4];

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function cleanCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function findChild(children, code) {
  return children.find((child) => child.code === code);
}

function mergeNode(children, incoming) {
  const code = cleanCode(incoming?.code);
  if (!code) return null;
  let target = findChild(children, code);
  if (!target) {
    target = { code, content: "", children: [] };
    children.push(target);
  }

  const content = cleanText(incoming?.content);
  if (content && (!target.content || content.length > target.content.length)) {
    target.content = content;
  }
  for (const child of Array.isArray(incoming?.children) ? incoming.children : []) {
    mergeNode(target.children, child);
  }
  return target;
}

export function createClassificationTree(system) {
  return { system, roots: [], errors: [] };
}

export function addOfficialTree(tree, nodes) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    mergeNode(tree.roots, node);
  }
  return tree;
}

function deepGroupPrefix(code) {
  const slashIndex = code.indexOf("/");
  if (slashIndex <= 4) return "";
  const extension = code.slice(4, slashIndex);
  return extension.length >= 4 ? code.slice(0, slashIndex + 1) : "";
}

function codePath(code, groupedPrefixes) {
  const normalized = cleanCode(code);
  if (!normalized) return [];
  const prefixes = CODE_PREFIX_LENGTHS
    .map((length) => normalized.slice(0, length))
    .filter((prefix) => prefix.length < normalized.length);
  const deepPrefix = deepGroupPrefix(normalized);
  const group = groupedPrefixes.has(deepPrefix)
    ? deepPrefix
    : "";
  return [...new Set(group ? [...prefixes, group, normalized] : [...prefixes, normalized])];
}

export function addKeywordRows(tree, rows) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      code: cleanCode(row?.code),
      content: cleanText(row?.content),
    }))
    .filter((row) => row.code);
  const groupCounts = new Map();
  for (const row of normalizedRows) {
    const group = deepGroupPrefix(row.code);
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  const groupedPrefixes = new Set(
    [...groupCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([group]) => group),
  );

  for (const row of normalizedRows) {
    const path = codePath(row.code, groupedPrefixes);
    if (path.length === 0) continue;
    let children = tree.roots;
    for (const [index, pathCode] of path.entries()) {
      const target = findChild(children, pathCode) ?? (() => {
        const created = { code: pathCode, content: "", children: [] };
        children.push(created);
        return created;
      })();
      if (index === path.length - 1) {
        const content = row.content;
        if (content && (!target.content || content.length > target.content.length)) {
          target.content = content;
        }
      }
      children = target.children;
    }
  }
  return tree;
}

function renderNode(node, prefix, isLast) {
  const connector = isLast ? "└── " : "├── ";
  const label = node.content ? `${node.code}: ${node.content}` : node.code;
  const lines = [`${prefix}${connector}${label}`];
  const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
  node.children.forEach((child, index) => {
    lines.push(...renderNode(child, childPrefix, index === node.children.length - 1));
  });
  return lines;
}

export function renderClassificationTree(tree) {
  if (tree.errors.length > 0 && tree.roots.length === 0) {
    return tree.errors.join("\n");
  }
  if (tree.roots.length === 0) {
    return `${tree.system}：未找到匹配分类号`;
  }
  const lines = [tree.system];
  tree.roots.forEach((root, index) => {
    lines.push(...renderNode(root, "", index === tree.roots.length - 1));
  });
  if (tree.errors.length > 0) lines.push(...tree.errors);
  return lines.join("\n");
}

export function renderClassificationTrees(trees) {
  return trees.map(renderClassificationTree).filter(Boolean).join("\n\n");
}

export function classificationErrorLabel({ system, kind, value }, response) {
  const message = cleanText(response?.error?.message) || "查询失败";
  const label = kind === "keyword" ? `关键词“${value}”` : `分类号“${value}”`;
  return `${system} ${label}：${message}`;
}
