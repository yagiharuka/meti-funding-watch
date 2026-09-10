import { readFile, writeFile } from "node:fs/promises";

function replaceRegexOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const path = "scripts/jogmec-reingest-stage1-20260826.mjs";
let source = await readFile(path, "utf8");
if (source.includes("parseJogmecPositionedPage")) throw new Error("JOGMEC stage3 positioned PDF support already applied");

const replacement = String.raw`
function headerPosition(items, pattern) {
  const matches = items.filter((item) => pattern.test(item.text) && item.y >= 0.55);
  if (!matches.length) return null;
  matches.sort((a, b) => b.y - a.y || a.x - b.x);
  const headerY = matches[0].y;
  const sameBand = matches.filter((item) => Math.abs(item.y - headerY) <= 0.035);
  return sameBand.reduce((sum, item) => sum + item.x + item.w / 2, 0) / sameBand.length;
}

function positionedSchema(candidate, items) {
  const positions = {
    program: headerPosition(items, PROGRAM_HEADER),
    organization: headerPosition(items, ORG_HEADER),
    corporateNumber: headerPosition(items, CORPORATE_HEADER),
    date: headerPosition(items, DATE_HEADER),
    amount: headerPosition(items, AMOUNT_HEADER),
  };
  const requiredOrganization = Number.isFinite(positions.organization);
  const requiredProgram = Number.isFinite(positions.program) || candidate.classification === "selection_result";
  if (!requiredOrganization || !requiredProgram) return null;
  const present = Object.entries(positions).filter(([, value]) => Number.isFinite(value)).sort((a, b) => a[1] - b[1]);
  if (present.length < 2 && candidate.classification !== "selection_result") return null;
  const boundaries = {};
  for (let index = 0; index < present.length; index += 1) {
    const [key, center] = present[index];
    boundaries[key] = [
      index === 0 ? 0 : (present[index - 1][1] + center) / 2,
      index === present.length - 1 ? 1 : (center + present[index + 1][1]) / 2,
    ];
  }
  const headerItems = items.filter((item) =>
    [PROGRAM_HEADER, ORG_HEADER, CORPORATE_HEADER, DATE_HEADER, AMOUNT_HEADER].some((pattern) => pattern.test(item.text))
    && item.y >= 0.55);
  const headerY = headerItems.length ? Math.min(...headerItems.map((item) => item.y)) : 0.72;
  return { positions, boundaries, headerY };
}

function columnText(items, range) {
  if (!range) return "";
  return clean(groupPdfLines(items.filter((item) => {
    const center = item.x + item.w / 2;
    return center >= range[0] && center < range[1];
  })).map((line) => line.text).join(" "));
}

function ordinalAnchors(items, schema) {
  const firstColumn = Math.min(...Object.values(schema.positions).filter(Number.isFinite));
  const candidates = items.filter((item) =>
    /^\d{1,3}$/u.test(item.text)
    && item.x < firstColumn - 0.015
    && item.y < schema.headerY - 0.004
    && item.y > 0.015)
    .map((item) => ({ item, y: item.y, label: item.text }))
    .sort((a, b) => b.y - a.y);
  const result = [];
  for (const candidate of candidates) {
    if (!result.some((anchor) => Math.abs(anchor.y - candidate.y) < 0.004)) result.push(candidate);
  }
  return result;
}

function dateAnchors(items, schema) {
  const range = schema.boundaries.date;
  if (!range) return [];
  const result = items.filter((item) => {
    const center = item.x + item.w / 2;
    return center >= range[0] && center < range[1]
      && item.y < schema.headerY - 0.004
      && /(?:19|20)\d{2}[./年-]\d{1,2}[./月-]\d{1,2}|(?:令和|平成)(?:元|\d+)年\d{1,2}月\d{1,2}日/u.test(item.text);
  }).map((item) => ({ item, y: item.y, label: item.text })).sort((a, b) => b.y - a.y);
  const deduped = [];
  for (const candidate of result) if (!deduped.some((anchor) => Math.abs(anchor.y - candidate.y) < 0.004)) deduped.push(candidate);
  return deduped;
}

function organizationAnchors(items, schema) {
  const range = schema.boundaries.organization;
  if (!range) return [];
  const result = items.filter((item) => {
    const center = item.x + item.w / 2;
    return center >= range[0] && center < range[1]
      && item.y < schema.headerY - 0.004
      && ORGANIZATION_MARKER.test(item.text);
  }).map((item) => ({ item, y: item.y, label: item.text })).sort((a, b) => b.y - a.y);
  const deduped = [];
  for (const candidate of result) if (!deduped.some((anchor) => Math.abs(anchor.y - candidate.y) < 0.012)) deduped.push(candidate);
  return deduped;
}

export function parseJogmecPositionedPage(candidate, page, sourceUrl = candidate.url) {
  const schema = positionedSchema(candidate, page.items ?? []);
  if (!schema) return { records: [], receipt: { pageNumber: page.pageNumber, status: "unsupported_positioned_header", includedRows: 0 }, skippedReasons: {} };
  let anchors = dateAnchors(page.items, schema);
  let anchorType = "date";
  if (!anchors.length) { anchors = ordinalAnchors(page.items, schema); anchorType = "ordinal"; }
  if (!anchors.length && candidate.classification === "selection_result") { anchors = organizationAnchors(page.items, schema); anchorType = "organization"; }
  if (!anchors.length) return { records: [], receipt: { pageNumber: page.pageNumber, status: "no_positioned_anchors", includedRows: 0 }, skippedReasons: {} };

  const records = [];
  const reasons = {};
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const upper = index === 0 ? (schema.headerY + anchor.y) / 2 : (anchors[index - 1].y + anchor.y) / 2;
    const lower = index + 1 < anchors.length ? (anchor.y + anchors[index + 1].y) / 2 : 0.012;
    const rowItems = page.items.filter((item) => item.y <= upper && item.y > lower);
    const cellObject = {
      organization: columnText(rowItems, schema.boundaries.organization),
      program: schema.boundaries.program ? columnText(rowItems, schema.boundaries.program) : (candidate.title || candidate.anchorText || ""),
      date: schema.boundaries.date ? columnText(rowItems, schema.boundaries.date) : "",
      amount: schema.boundaries.amount ? columnText(rowItems, schema.boundaries.amount) : "",
      corporateNumber: schema.boundaries.corporateNumber ? columnText(rowItems, schema.boundaries.corporateNumber) : "",
    };
    const cells = [];
    const mapping = {};
    for (const key of ["organization", "program", "date", "amount", "corporateNumber"]) {
      if (key === "program" || key === "organization" || schema.boundaries[key]) {
        mapping[key] = cells.length;
        cells.push(cellObject[key] ?? "");
      } else mapping[key] = -1;
    }
    const parsed = recordFromCells(candidate, cells, mapping, (page.pageNumber ?? 1) * 100_000 + index + 1, sourceUrl);
    if (parsed.record) {
      parsed.record.sourcePageNumber = page.pageNumber;
      parsed.record.parseMethod = \`pdf_positioned_\${anchorType}\`;
      records.push(parsed.record);
    } else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
  }
  return {
    records,
    receipt: { pageNumber: page.pageNumber, status: records.length ? "parsed_positioned" : "no_positioned_records", anchorType, anchorCount: anchors.length, includedRows: records.length },
    skippedReasons: reasons,
  };
}

async function parseJogmecPdf(candidate, buffer, sourceUrl) {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, useSystemFonts: false });
  const records = [];
  const receipts = [];
  const reasons = {};
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && clean(item.str))
        .map((item) => ({ text: clean(item.str), x: item.transform[4] / viewport.width, y: item.transform[5] / viewport.height, w: (item.width || 0) / viewport.width }));
      const lines = groupPdfLines(items);
      let best = null;
      for (let index = 0; index < Math.min(24, lines.length); index += 1) {
        const header = pdfHeader(lines[index]);
        if (!best || header.score > best.score) best = { ...header, index };
      }
      const minimumScore = candidate.classification === "selection_result" ? 3 : 5;
      let pageRecords = [];
      let lineReceipt = null;
      if (best && best.score >= minimumScore && Number.isFinite(best.positions.organization)) {
        let dataRows = 0;
        for (let lineIndex = best.index + 1; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          if (!line.text || line.text.length < 3) continue;
          const cellObject = cellsFromPdfLine(line, best.positions);
          const cells = [];
          const mapping = {};
          for (const key of ["organization", "program", "date", "amount", "corporateNumber"]) {
            if (key in best.positions) { mapping[key] = cells.length; cells.push(cellObject[key] ?? ""); }
            else if (key === "program" && candidate.classification === "selection_result") { mapping[key] = cells.length; cells.push(candidate.title || candidate.anchorText || ""); }
            else mapping[key] = -1;
          }
          if (!plausibleOrganization(cells[mapping.organization])) continue;
          dataRows += 1;
          const parsed = recordFromCells(candidate, cells, mapping, pageNumber * 10_000 + lineIndex + 1, sourceUrl);
          if (parsed.record) {
            parsed.record.sourcePageNumber = pageNumber;
            parsed.record.parseMethod = "pdf_single_line_table";
            pageRecords.push(parsed.record);
          } else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
        }
        lineReceipt = { pageNumber, status: pageRecords.length ? "parsed" : "no_records", dataRows, includedRows: pageRecords.length, headerScore: best.score };
      }
      if (!pageRecords.length) {
        const positioned = parseJogmecPositionedPage(candidate, { pageNumber, items }, sourceUrl);
        pageRecords = positioned.records;
        lineReceipt = positioned.receipt;
        for (const [reason, count] of Object.entries(positioned.skippedReasons)) reasons[reason] = (reasons[reason] ?? 0) + count;
      }
      records.push(...pageRecords);
      receipts.push(lineReceipt ?? { pageNumber, status: "unsupported_header", includedRows: 0, headerScore: best?.score ?? 0 });
      page.cleanup();
    }
  } finally {
    await task.destroy().catch(() => {});
  }
  const unique = new Map();
  for (const row of records) {
    const fingerprint = [row.date ?? "", row.amount ?? "null", comparable(row.organization), comparable(row.program)].join("\u0000");
    if (!unique.has(fingerprint)) unique.set(fingerprint, row);
  }
  return { records: [...unique.values()], receipts, skippedReasons: reasons };
}

async function fetchBuffer`;

source = replaceRegexOnce(
  source,
  /async function parseJogmecPdf\(candidate, buffer, sourceUrl\) \{[\s\S]*?\n\}\n\nasync function fetchBuffer/,
  replacement,
  "JOGMEC positioned PDF parser",
);
await writeFile(path, source);

const testPath = "tests/jogmec-reingest-stage1.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  "import { parseJogmecHtmlTables, parseJogmecSpreadsheetRows } from \"../scripts/jogmec-reingest-stage1-20260826.mjs\";",
  "import { parseJogmecHtmlTables, parseJogmecPositionedPage, parseJogmecSpreadsheetRows } from \"../scripts/jogmec-reingest-stage1-20260826.mjs\";",
  "stage3 test import",
);
tests += String.raw`

test("JOGMEC positioned PDF parser joins multi-line cells between ordinal anchors", () => {
  const item = (text, x, y, w = 0.05) => ({ text, x, y, w });
  const page = {
    pageNumber: 1,
    items: [
      item("番号", 0.02, 0.90),
      item("契約件名", 0.15, 0.90),
      item("契約の相手方", 0.48, 0.90),
      item("契約締結日", 0.70, 0.90),
      item("契約金額", 0.84, 0.90),
      item("1", 0.025, 0.73, 0.01),
      item("海底資源", 0.12, 0.75),
      item("調査業務", 0.12, 0.72),
      item("株式会社深海テスト", 0.45, 0.74, 0.12),
      item("2025年10月1日", 0.68, 0.73, 0.10),
      item("24,680,000円", 0.83, 0.73, 0.10),
      item("2", 0.025, 0.48, 0.01),
      item("地熱資源分析", 0.12, 0.49, 0.12),
      item("一般財団法人地熱テスト", 0.45, 0.49, 0.14),
      item("2025年11月2日", 0.68, 0.48, 0.10),
      item("非公表", 0.84, 0.48),
    ],
  };
  const parsed = parseJogmecPositionedPage(contractCandidate, page);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].program, "海底資源 調査業務");
  assert.equal(parsed.records[0].amount, 24_680_000);
  assert.equal(parsed.records[1].amount, null);
  assert.equal(parsed.records[1].amountStage, "契約金額の記載なし");
});
`;
await writeFile(testPath, tests);
console.log("Applied JOGMEC stage-three positioned PDF support.");
