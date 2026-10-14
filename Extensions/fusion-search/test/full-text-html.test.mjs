import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIMS_MISSING_NOTE,
  DESCRIPTION_MISSING_NOTE,
  cellText,
  isSectionHeading,
  parseFullTextHtml,
  renderFullText,
} from "../src/full-text-html.mjs";

// Shape taken from the original SDK's fixtures: namespaced wrappers inside
// the cells, heading rows as ordinary numbered description cells.
const PROVIDER_HTML = `
<result>
  <div class="fullText">
    <table>
      <tr><td id="claim_title" class="header">权利要求</td></tr>
      <tr><td id="claim_1" class="content"><business:ClaimText>1.一种花盆，其特征在于包括纸板层。</business:ClaimText></td></tr>
      <tr><td id="claim_2" class="content"><business:ClaimText>2.根据权利要求1所述的花盆，其特征在于包括发泡胶层。</business:ClaimText></td></tr>
      <tr><td id="description_title" class="header">说明书</td></tr>
      <tr><td id="description_1" class="content"><base:Paragraphs>技术领域</base:Paragraphs></td></tr>
      <tr><td id="description_2" class="content"><base:Paragraphs>本发明涉及花盆。</base:Paragraphs></td></tr>
      <tr><td id="description_3" class="content"><base:Paragraphs>背景技术</base:Paragraphs></td></tr>
      <tr><td id="description_4" class="content"><base:Paragraphs>现有花盆结构 &amp; 材料。</base:Paragraphs></td></tr>
      <tr><td id="description_5" class="content"><base:Paragraphs>附图说明</base:Paragraphs></td></tr>
      <tr><td id="description_6" class="content"><base:Paragraphs>图1为花盆的剖视图。</base:Paragraphs></td></tr>
      <tr><td id="description_7" class="content"><base:Paragraphs>具体实施方式</base:Paragraphs></td></tr>
      <tr><td id="description_8" class="content"><base:Paragraphs>如图1所示<img src="/img/1.png" alt="图1"/>，按步骤<br/>制作花盆。</base:Paragraphs></td></tr>
    </table>
  </div>
</result>
`;

test("claims and description paragraphs keep the provider numbers and document order", () => {
  const document = parseFullTextHtml(PROVIDER_HTML);
  assert.deepEqual(document.claims, [
    { n: 1, text: "1.一种花盆，其特征在于包括纸板层。" },
    { n: 2, text: "2.根据权利要求1所述的花盆，其特征在于包括发泡胶层。" },
  ]);
  assert.deepEqual(document.paragraphs.map((paragraph) => [paragraph.n, paragraph.heading]), [
    [1, true], [2, false], [3, true], [4, false], [5, true], [6, false], [7, true], [8, false],
  ]);
  assert.equal(document.paragraphs[3].text, "现有花盆结构 & 材料。");
  assert.equal(document.paragraphs[7].text, "如图1所示 〔图：图1〕 ，按步骤 制作花盆。");
});

test("the rendered text is the agent's reading view: header, claims, numbered description", () => {
  const document = parseFullTextHtml(PROVIDER_HTML);
  const text = renderFullText({ pnId: "CN1A", title: "花盆", ...document });
  assert.equal(text, [
    "CN1A  花盆",
    "",
    "权利要求",
    "1.一种花盆，其特征在于包括纸板层。",
    "2.根据权利要求1所述的花盆，其特征在于包括发泡胶层。",
    "",
    "说明书",
    "技术领域",
    "[0002] 本发明涉及花盆。",
    "背景技术",
    "[0004] 现有花盆结构 & 材料。",
    "附图说明",
    "[0006] 图1为花盆的剖视图。",
    "具体实施方式",
    "[0008] 如图1所示 〔图：图1〕 ，按步骤 制作花盆。",
  ].join("\n"));
  assert.ok(!text.includes("<"), "no markup reaches the model");
});

test("plain cells, unquoted ids and mixed-case ids are accepted", () => {
  const document = parseFullTextHtml(`
    <td id=Claim_1>1.一种装置。</td>
    <td id='CLAIM_2'>2.根据权利要求1所述的装置。</td>
    <td id="Description_1">本实用新型涉及装置。</td>
  `);
  assert.deepEqual(document.claims.map((claim) => claim.text), ["1.一种装置。", "2.根据权利要求1所述的装置。"]);
  assert.deepEqual(document.paragraphs, [{ n: 1, text: "本实用新型涉及装置。", heading: false }]);
});

test("a claim split across cells continues the previous claim; an unnumbered first claim is numbered", () => {
  const split = parseFullTextHtml(`
    <td id="claim_1">1.一种装置，包括</td>
    <td id="claim_2">壳体和盖板。</td>
    <td id="claim_3">2.根据权利要求1所述的装置。</td>
  `);
  assert.deepEqual(split.claims.map((claim) => claim.text), [
    "1.一种装置，包括 壳体和盖板。",
    "2.根据权利要求1所述的装置。",
  ]);
  const unnumbered = parseFullTextHtml(`<td id="claim_1">一种装置。</td>`);
  assert.deepEqual(unnumbered.claims, [{ n: 1, text: "1. 一种装置。" }]);
});

test("title cells, empty cells and unrelated cells are ignored", () => {
  const document = parseFullTextHtml(`
    <table>
      <tr><td id="claim_title">权利要求</td><td class="x">noise</td></tr>
      <tr><td id="claim_1">   </td></tr>
      <tr><td id="description_title">说明书</td></tr>
      <tr><td id="description_1">正文。</td></tr>
    </table>
  `);
  assert.deepEqual(document.claims, []);
  assert.deepEqual(document.paragraphs, [{ n: 1, text: "正文。", heading: false }]);
});

test("missing sections are named instead of silently dropped", () => {
  const onlyDescription = renderFullText({ pnId: "CN1A", ...parseFullTextHtml(`<td id="description_1">正文。</td>`) });
  assert.ok(onlyDescription.includes(`权利要求\n${CLAIMS_MISSING_NOTE}`));
  const onlyClaims = renderFullText({ pnId: "CN1A", ...parseFullTextHtml(`<td id="claim_1">1.一种装置。</td>`) });
  assert.ok(onlyClaims.includes(`说明书\n${DESCRIPTION_MISSING_NOTE}`));
  assert.ok(onlyClaims.startsWith("CN1A\n"), "a missing title leaves the pnId alone on the first line");
});

test("section headings are recognized in Chinese and English regardless of punctuation and case", () => {
  for (const heading of ["技术领域", "背景技术：", "发明内容", "实用新型内容", "附图说明", "具体实施方式", "Technical Field", "BRIEF DESCRIPTION OF THE DRAWINGS", "Detailed Description."]) {
    assert.equal(isSectionHeading(heading), true, heading);
  }
  for (const text of ["", "技术领域是减振装置。", "实施例1", "图1为剖视图。"]) {
    assert.equal(isSectionHeading(text), false, text);
  }
});

test("cell text keeps images as placeholders and joins forced line breaks", () => {
  assert.equal(cellText(`A<img src="x.png">B<br>C`), "A 〔图〕 B C");
  assert.equal(cellText(`<img src="f.png" title="公式(1)">`), "〔图：公式(1)〕");
  assert.equal(cellText(`  &nbsp; `), "");
});

test("the safety cap ends the text with a note naming the last paragraph kept", () => {
  const paragraphs = Array.from({ length: 50 }, (_, index) => ({ n: index + 1, text: "正文".repeat(20), heading: false }));
  const text = renderFullText({ pnId: "CN1A", claims: [{ n: 1, text: "1.一种装置。" }], paragraphs, maxChars: 600 });
  assert.ok(text.length <= 700);
  assert.match(text, /\[全文超长，已截断于第 \d+ 段\]$/u);
  const kept = Number(/第 (\d+) 段/u.exec(text)[1]);
  assert.ok(kept >= 1 && kept < 50);
  assert.ok(text.includes(`[${String(kept).padStart(4, "0")}]`));
  assert.ok(!text.includes(`[${String(kept + 1).padStart(4, "0")}]`));
});
