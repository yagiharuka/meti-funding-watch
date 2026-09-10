import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: no change produced`);
  await writeFile(path, after);
}

await update("scripts/jogmec-reingest-stage1-20260826.mjs", (input) => {
  let source = input;
  if (source.includes("jogmec-xlsx-reader-20260826")) throw new Error("JOGMEC stage2 XLSX support already applied");
  source = replaceOnce(
    source,
    'import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";',
    'import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";\nimport { xlsxRowsFromBuffer } from "./jogmec-xlsx-reader-20260826.mjs";',
    "stage2 XLSX import",
  );
  source = replaceOnce(
    source,
    `function parseJogmecCsv(candidate, text, sourceUrl) {
  const rows = String(text).replace(/^\\uFEFF/u, "").split(/\\r?\\n/u).filter((line) => line.trim()).map(parseCsvLine);`,
    `function decodeTabularText(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const replacementCount = (utf8.match(/�/gu) ?? []).length;
  if (replacementCount <= Math.max(2, utf8.length / 5000)) return utf8;
  try {
    return new TextDecoder("shift_jis", { fatal: false }).decode(buffer);
  } catch {
    return utf8;
  }
}

function parseStructuredRows(candidate, rows, sourceUrl, receiptExtra = {}) {
  if (!rows.length) return { records: [], receipts: [{ status: "empty", ...receiptExtra }], skippedReasons: {} };
  let best = null;
  for (let index = 0; index < Math.min(12, rows.length); index += 1) {
    const header = headerMapping(rows[index]);
    if (!best || header.score > best.score) best = { ...header, index };
  }
  const minimumScore = candidate.classification === "selection_result" ? 3 : 5;
  if (!best || best.score < minimumScore || best.mapping.organization < 0) {
    return { records: [], receipts: [{ status: "unsupported_header", headerScore: best?.score ?? 0, ...receiptExtra }], skippedReasons: {} };
  }
  const records = [];
  const reasons = {};
  for (let rowIndex = best.index + 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex].map((value) => clean(value));
    if (!cells.some(Boolean) || headerMapping(cells).score >= best.score) continue;
    const parsed = recordFromCells(candidate, cells, best.mapping, rowIndex + 1, sourceUrl);
    if (parsed.record) records.push(parsed.record);
    else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
  }
  return {
    records,
    receipts: [{ status: records.length ? "parsed" : "no_records", dataRows: rows.length - best.index - 1, includedRows: records.length, headers: best.labels, ...receiptExtra }],
    skippedReasons: reasons,
  };
}

function parseJogmecCsv(candidate, buffer, sourceUrl) {
  const text = decodeTabularText(buffer);
  const rows = String(text).replace(/^\\uFEFF/u, "").split(/\\r?\\n/u).filter((line) => line.trim()).map(parseCsvLine);`,
    "stage2 shared structured rows",
  );
  source = replaceOnce(
    source,
    `  if (!rows.length) return { records: [], receipts: [{ status: "empty" }], skippedReasons: {} };
  let best = null;
  for (let index = 0; index < Math.min(8, rows.length); index += 1) {
    const header = headerMapping(rows[index]);
    if (!best || header.score > best.score) best = { ...header, index };
  }
  if (!best || best.score < 5 || best.mapping.organization < 0) return { records: [], receipts: [{ status: "unsupported_header", headerScore: best?.score ?? 0 }], skippedReasons: {} };
  const records = [];
  const reasons = {};
  for (let rowIndex = best.index + 1; rowIndex < rows.length; rowIndex += 1) {
    const parsed = recordFromCells(candidate, rows[rowIndex], best.mapping, rowIndex + 1, sourceUrl);
    if (parsed.record) records.push(parsed.record);
    else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
  }
  return { records, receipts: [{ status: records.length ? "parsed" : "no_records", dataRows: rows.length - best.index - 1, includedRows: records.length, headers: best.labels }], skippedReasons: reasons };
}

function groupPdfLines`,
    `  return parseStructuredRows(candidate, rows, sourceUrl, { fileType: "csv" });
}

export function parseJogmecSpreadsheetRows(candidate, sheets, sourceUrl = candidate.url) {
  const records = [];
  const receipts = [];
  const skippedReasons = {};
  for (const sheet of sheets) {
    const parsed = parseStructuredRows(candidate, sheet.rows ?? [], sourceUrl, { fileType: "xlsx", sheet: sheet.name });
    records.push(...parsed.records);
    receipts.push(...parsed.receipts);
    for (const [reason, count] of Object.entries(parsed.skippedReasons)) skippedReasons[reason] = (skippedReasons[reason] ?? 0) + count;
  }
  return { records, receipts, skippedReasons };
}

function parseJogmecXlsx(candidate, buffer, sourceUrl) {
  return parseJogmecSpreadsheetRows(candidate, xlsxRowsFromBuffer(buffer), sourceUrl);
}

function groupPdfLines`,
    "stage2 XLSX parser",
  );
  source = source.replace(
    '&& ["html", "pdf", "csv"].includes(candidate.fileType));',
    '&& ["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));',
  );
  source = replaceOnce(
    source,
    `        if (candidate.fileType === "html") parsed = parseJogmecHtmlTables(candidate, fetched.buffer.toString("utf8"), fetched.finalUrl);
        else if (candidate.fileType === "csv") parsed = parseJogmecCsv(candidate, fetched.buffer.toString("utf8"), fetched.finalUrl);
        else parsed = await parseJogmecPdf(candidate, fetched.buffer, fetched.finalUrl);`,
    `        if (candidate.fileType === "html") parsed = parseJogmecHtmlTables(candidate, fetched.buffer.toString("utf8"), fetched.finalUrl);
        else if (candidate.fileType === "csv") parsed = parseJogmecCsv(candidate, fetched.buffer, fetched.finalUrl);
        else if (candidate.fileType === "xlsx") parsed = parseJogmecXlsx(candidate, fetched.buffer, fetched.finalUrl);
        else parsed = await parseJogmecPdf(candidate, fetched.buffer, fetched.finalUrl);`,
    "stage2 XLSX dispatch",
  );
  source = source.replace(
    '&& !["html", "pdf", "csv"].includes(candidate.fileType));',
    '&& !["html", "pdf", "csv", "xlsx"].includes(candidate.fileType));',
  );
  return source;
});

await update("tests/jogmec-reingest-stage1.test.mjs", (input) => {
  let source = input;
  source = replaceOnce(
    source,
    'import { parseJogmecHtmlTables } from "../scripts/jogmec-reingest-stage1-20260826.mjs";',
    'import { parseJogmecHtmlTables, parseJogmecSpreadsheetRows } from "../scripts/jogmec-reingest-stage1-20260826.mjs";',
    "stage2 test import",
  );
  source += `

test("JOGMEC spreadsheet parser handles title rows and preserves a missing individual selection amount", () => {
  const parsed = parseJogmecSpreadsheetRows(selectionCandidate, [{
    name: "xl/worksheets/sheet1.xml",
    rows: [
      ["令和7年度 公募採択結果"],
      ["事業名", "採択者", "採択日"],
      ["金属資源技術実証", "株式会社表計算テスト", "2025年9月1日"],
    ],
  }]);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].organization, "株式会社表計算テスト");
  assert.equal(parsed.records[0].amount, null);
  assert.equal(parsed.records[0].amountStage, "個社別金額の記載なし");
});
`;
  return source;
});

console.log("Applied JOGMEC stage-two XLSX and Shift_JIS support.");
