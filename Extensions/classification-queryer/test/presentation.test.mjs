import assert from "node:assert/strict";
import test from "node:test";

import {
  createClassificationTree,
  addKeywordRows,
  addOfficialTree,
  renderClassificationTrees,
} from "../src/presentation.mjs";

test("renders keyword matches as a readable classification tree", () => {
  const tree = createClassificationTree("IPC");
  addKeywordRows(tree, [
    { code: "G06N3/02", content: "神经网络[2006.01]" },
    { code: "G06N3/042", content: "基于知识的神经网络[2023.01]" },
    { code: "H01M8/04992", content: "神经网络或人工智能[2016.01]" },
  ]);

  assert.equal(
    renderClassificationTrees([tree]),
    [
      "IPC",
      "├── G",
      "│   └── G06",
      "│       └── G06N",
      "│           ├── G06N3/02: 神经网络[2006.01]",
      "│           └── G06N3/042: 基于知识的神经网络[2023.01]",
      "└── H",
      "    └── H01",
      "        └── H01M",
      "            └── H01M8/04992: 神经网络或人工智能[2016.01]",
    ].join("\n"),
  );
});

test("keeps the official code-query tree and merges repeated branches", () => {
  const tree = createClassificationTree("IPC");
  addOfficialTree(tree, [
    {
      code: "G",
      content: "物理",
      children: [
        {
          code: "G06",
          content: "计算或推算",
          children: [
            { code: "G06N3/02", content: "神经网络", children: [] },
          ],
        },
      ],
    },
  ]);
  addKeywordRows(tree, [{ code: "G06F30/27", content: "使用机器学习" }]);

  assert.equal(
    renderClassificationTrees([tree]),
    [
      "IPC",
      "└── G: 物理",
      "    └── G06: 计算或推算",
      "        ├── G06N3/02: 神经网络",
      "        └── G06F",
      "            └── G06F30/27: 使用机器学习",
    ].join("\n"),
  );
});

test("groups repeated deep CPC prefixes without flattening their leaves", () => {
  const tree = createClassificationTree("CPC");
  addKeywordRows(tree, [
    { code: "G05B2219/25255", content: "神经网络" },
    { code: "G05B2219/31354", content: "人工神经网络" },
  ]);

  assert.equal(
    renderClassificationTrees([tree]),
    [
      "CPC",
      "└── G",
      "    └── G05",
      "        └── G05B",
      "            └── G05B2219/",
      "                ├── G05B2219/25255: 神经网络",
      "                └── G05B2219/31354: 人工神经网络",
    ].join("\n"),
  );
});

test("renders a concise error without leaking the official request envelope", () => {
  const output = renderClassificationTrees([
    {
      system: "IPC",
      roots: [],
      errors: ["IPC 关键词“神经网络”：该搜索没有结果"],
    },
  ]);
  assert.equal(output, "IPC 关键词“神经网络”：该搜索没有结果");
  assert.doesNotMatch(output, /operation|request|language|year|meta/);
});
