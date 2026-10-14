import { cleanMarkup } from "./semantic-result-page.mjs";

/**
 * Turn the quick-view `fullTextHtml` document into reading text.
 *
 * The provider renders one table: `<td id="claim_title">`, one `<td id="claim_N">`
 * per claim, `<td id="description_title">` and one `<td id="description_N">` per
 * description paragraph. Section headings ("技术领域", "背景技术", …) are
 * ordinary description cells, so they are recognized by their text and printed
 * without a number. Paragraph numbers are the provider's `N`, which is what a
 * second call for the same pnId returns again — the agent cites them as `[0012]`.
 */

export const CLAIMS_HEADING = "权利要求";
export const DESCRIPTION_HEADING = "说明书";
export const CLAIMS_MISSING_NOTE = "（全文未包含权利要求）";
export const DESCRIPTION_MISSING_NOTE = "（全文未包含说明书）";

const SECTION_HEADINGS = new Set([
  "技术领域",
  "背景技术",
  "发明内容",
  "实用新型内容",
  "附图说明",
  "具体实施方式",
  "具体实施方案",
  "实施方式",
  "TECHNICALFIELD",
  "FIELDOFTHEINVENTION",
  "BACKGROUND",
  "BACKGROUNDART",
  "BACKGROUNDOFTHEINVENTION",
  "SUMMARY",
  "SUMMARYOFTHEINVENTION",
  "DISCLOSUREOFTHEINVENTION",
  "BRIEFDESCRIPTIONOFTHEDRAWINGS",
  "BRIEFDESCRIPTIONOFDRAWINGS",
  "DESCRIPTIONOFTHEDRAWINGS",
  "DETAILEDDESCRIPTION",
  "DETAILEDDESCRIPTIONOFTHEINVENTION",
  "DESCRIPTIONOFEMBODIMENTS",
  "DESCRIPTIONOFTHEEMBODIMENTS",
  "DESCRIPTIONOFTHEPREFERREDEMBODIMENTS",
  "MODESFORCARRYINGOUTTHEINVENTION",
  "BESTMODEFORCARRYINGOUTTHEINVENTION",
]);

const CLAIM_START = /^\s*\d+\s*[.．、:：)]/u;
const TD_OPEN = /<td\b[^>]*>/giu;
const TD_TOKEN = /<\/?td\b[^>]*>/giu;
const ID_ATTRIBUTE = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/iu;
const IMAGE = /<img\b[^>]*>/giu;
const IMAGE_LABEL = /\b(?:alt|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/iu;

function cellId(openTag) {
  const match = ID_ATTRIBUTE.exec(openTag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim().toLowerCase();
}

/** Inner HTML of the cell whose opening tag starts at `openIndex`. */
function cellInner(html, openIndex, openLength) {
  TD_TOKEN.lastIndex = openIndex + openLength;
  let depth = 1;
  let token;
  while ((token = TD_TOKEN.exec(html)) !== null) {
    if (token[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(openIndex + openLength, token.index);
    } else {
      depth += 1;
    }
  }
  return html.slice(openIndex + openLength);
}

function imagePlaceholder(tag) {
  const label = IMAGE_LABEL.exec(tag);
  const text = cleanMarkup(label?.[1] ?? label?.[2] ?? "");
  return text ? `〔图：${text}〕` : "〔图〕";
}

/** One cell as a single line of reading text. */
export function cellText(inner) {
  const withImages = String(inner ?? "").replace(IMAGE, (tag) => ` ${imagePlaceholder(tag)} `);
  return cleanMarkup(withImages).replace(/\s*\n\s*/gu, " ").replace(/ {2,}/gu, " ").trim();
}

function headingKey(text) {
  return text.replace(/[\s:：.。、,，·]+/gu, "").toUpperCase();
}

export function isSectionHeading(text) {
  const key = headingKey(text);
  return key.length > 0 && SECTION_HEADINGS.has(key);
}

/**
 * Parse the quick-view HTML into numbered claims and description paragraphs.
 * Cells are kept in document order; their provider numbers are preserved.
 */
export function parseFullTextHtml(html) {
  const source = String(html ?? "");
  const claims = [];
  const paragraphs = [];
  TD_OPEN.lastIndex = 0;
  let open;
  while ((open = TD_OPEN.exec(source)) !== null) {
    const id = cellId(open[0]);
    const claim = /^claim_(\d+)$/u.exec(id);
    const paragraph = /^description_(\d+)$/u.exec(id);
    if (!claim && !paragraph) continue;
    const inner = cellInner(source, open.index, open[0].length);
    TD_OPEN.lastIndex = open.index + open[0].length + inner.length;
    const text = cellText(inner);
    if (!text) continue;
    if (claim) {
      const n = Number(claim[1]);
      if (CLAIM_START.test(text) || claims.length === 0) {
        claims.push({ n, text: CLAIM_START.test(text) ? text : `${n}. ${text}` });
      } else {
        // A claim split across cells continues the previous one, as the
        // original SDK did; a numbered cell always starts a new claim.
        const previous = claims[claims.length - 1];
        previous.text = `${previous.text} ${text}`;
      }
    } else {
      paragraphs.push({ n: Number(paragraph[1]), text, heading: isSectionHeading(text) });
    }
  }
  return { claims, paragraphs };
}

function paragraphLabel(n) {
  return `[${String(n).padStart(4, "0")}]`;
}

/**
 * Render the parsed document as the plain text the agent reads. `maxChars` is
 * a safety valve for pathological responses, not a reading window: when it is
 * hit the text ends with a note naming the last paragraph kept.
 */
export function renderFullText({ pnId, title = "", claims, paragraphs, maxChars = Infinity }) {
  const lines = [];
  lines.push(title ? `${pnId}  ${title}` : String(pnId));
  lines.push("");
  lines.push(CLAIMS_HEADING);
  if (claims.length === 0) lines.push(CLAIMS_MISSING_NOTE);
  for (const claim of claims) lines.push(claim.text);
  lines.push("");
  lines.push(DESCRIPTION_HEADING);
  if (paragraphs.length === 0) lines.push(DESCRIPTION_MISSING_NOTE);

  let used = lines.reduce((total, line) => total + line.length + 1, 0);
  let lastParagraph = null;
  for (const paragraph of paragraphs) {
    const line = paragraph.heading ? paragraph.text : `${paragraphLabel(paragraph.n)} ${paragraph.text}`;
    if (used + line.length + 1 > maxChars && lastParagraph !== null) {
      lines.push(`[全文超长，已截断于第 ${lastParagraph} 段]`);
      return lines.join("\n");
    }
    lines.push(line);
    used += line.length + 1;
    if (!paragraph.heading) lastParagraph = paragraph.n;
  }
  return lines.join("\n");
}
