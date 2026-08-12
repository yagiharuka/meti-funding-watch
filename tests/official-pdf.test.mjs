import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { parseOfficialPdf } from "../scripts/official-pdf.mjs";
import {
  KANTO_GRANT_INDEX_RECEIPT,
  REGIONAL_PDF_COVERAGE_GAPS,
  REGIONAL_PDF_DOCUMENTS,
} from "../scripts/official-regional-pdf-sources.mjs";

const COLUMN_DEFINITIONS = [
  { key: "ordinal", leftRatio: 0.02, headerAliases: ["No"] },
  { key: "program", leftRatio: 0.065, headerAliases: ["Program"] },
  { key: "organization", leftRatio: 0.25, headerAliases: ["Recipient"] },
  { key: "corporateNumber", leftRatio: 0.405, headerAliases: ["Corporate ID"] },
  { key: "amount", leftRatio: 0.54, headerAliases: ["Decision Amount"] },
  { key: "account", leftRatio: 0.655, headerAliases: ["Account"] },
  { key: "budgetItem", leftRatio: 0.75, headerAliases: ["Budget Item"] },
  { key: "date", leftRatio: 0.84, headerAliases: ["Decision Date"] },
  { key: "publicInterestClass", leftRatio: 0.91, headerAliases: ["Public Class"] },
  { key: "jurisdictionClass", leftRatio: 0.955, headerAliases: ["Jurisdiction"] },
];

function fixtureDocument(overrides = {}) {
  const schemaOverrides = overrides.pdfSchema ?? {};
  return {
    id: "regional-pdf-fixture",
    executorId: "tohoku",
    executorName: "東北経済産業局",
    fiscalYear: 2025,
    category: "grant_decision",
    kind: "補助金等の交付決定",
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    sourcePageUrl: "https://example.test/index.html",
    url: "https://example.test/source.pdf",
    ...overrides,
    pdfSchema: {
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      expectedPageCount: 1,
      expectedPageSize: { width: 1_000, height: 700, tolerance: 0.01 },
      expectedRowsPerPage: [2],
      expectedRecordCount: 2,
      expectedRowNumbers: { start: 1, end: 2 },
      requiredPageText: ["Verified Table"],
      columns: COLUMN_DEFINITIONS,
      recordMapping: {
        ordinalColumn: "ordinal",
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        notesColumns: ["account", "budgetItem"],
      },
      allowedDateFormats: ["western_ymd_slash"],
      dateRange: { start: "2025-10-01", end: "2026-03-31" },
      corporateNumberMissingSentinels: ["NO ID"],
      minimumPositionedTextItems: 30,
      ...schemaOverrides,
    },
  };
}

test("parses a positioned-text grant PDF and preserves raw amount, provenance, and multiple parties", async () => {
  const buffer = await makeFixturePdf();
  const records = await parseOfficialPdf(buffer, fixtureDocument());
  assert.equal(records.length, 2);
  assert.equal(records.emptySentinelFound, false);
  assert.deepEqual(records[0].organizations, ["Org Alpha", "Org Beta"]);
  assert.deepEqual(records[0].corporateNumbers, ["1234567890123", "9876543210987"]);
  assert.equal(records[0].corporateNumber, null);
  assert.equal(records[0].multiplePartyListing, true);
  assert.equal(records[0].program, "Long Program Name");
  assert.equal(records[0].amountRaw, "1,234,567");
  assert.equal(records[0].amount, 1_234_567);
  assert.equal(records[0].date, "2025-10-03");
  assert.equal(records[0].sourceKey, "regional-pdf-fixture:no-1");
  assert.equal(records[0].sourceSheet, "PDF 1/1");
  assert.equal(records[0].sourceRowNumber, 1);
  assert.equal(records[0].notes, "General／Grant item");
  assert.equal(records[1].corporateNumber, null);
  assert.deepEqual(records[1].corporateNumbers, []);
  assert.equal(records[1].corporateNumberRaw, "NO ID");
  assert.equal(records[1].amount, 0);
});

test("supports the same coordinate table for contracts without mixing amount stages", async () => {
  const buffer = await makeFixturePdf();
  const records = await parseOfficialPdf(buffer, fixtureDocument({
    category: "contract_result",
    kind: "競争入札（委託費）",
    amountStage: "契約額欄の掲載値",
  }));
  assert.ok(records.every((record) => record.category === "contract_result"));
  assert.ok(records.every((record) => record.amountStage.includes("契約")));
  assert.ok(records.every((record) => !("gbiz" in record)));
  assert.ok(records.every((record) => record.method === "競争入札（委託費）"));
});

test("splits a pinned amount/account text item only across the declared coordinate boundary", async () => {
  const buffer = await makeFixturePdf({ combineAmountAccount: true });
  const records = await parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
    crossColumnSplitRules: [
      { id: "amount-account", kind: "amount_then_text", fromColumn: "amount", toColumn: "account", expectedMatches: 2 },
    ],
  } }));
  assert.deepEqual(records.map((record) => record.amountRaw), ["1,234,567", "0"]);
  assert.ok(records.every((record) => record.notes.startsWith("General／")));
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
      crossColumnSplitRules: [
        { id: "amount-account", kind: "amount_then_text", fromColumn: "amount", toColumn: "account", expectedMatches: 1 },
      ],
    } })),
    /PDF列跨ぎ分割数が検証済み値と一致しません/,
  );
});

test("fails closed for a missing header, page-count drift, and row-count drift", async () => {
  const missingHeader = await makeFixturePdf({ headerText: { amount: "Unexpected" } });
  await assert.rejects(parseOfficialPdf(missingHeader, fixtureDocument()), /見出しを一意に特定できません \(amount:0\)/);

  const twoPages = await makeFixturePdf({ extraBlankPage: true });
  await assert.rejects(parseOfficialPdf(twoPages, fixtureDocument()), /PDFページ数が検証済み値と一致しません/);

  const oneRow = await makeFixturePdf({ omitSecondRow: true });
  await assert.rejects(
    parseOfficialPdf(oneRow, fixtureDocument({ pdfSchema: { minimumPositionedTextItems: 20 } })),
    /PDF掲載行数が検証済み値と一致しません|ページ内掲載行数|掲載番号/,
  );
});

test("rejects invalid dates, out-of-period dates, and malformed amount text", async () => {
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ firstDate: "2025-02-30" }), fixtureDocument()),
    /日付形式が不正です/,
  );
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ firstDate: "2025/9/30" }), fixtureDocument()),
    /対象期間外/,
  );
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ firstAmount: "about 1,000" }), fixtureDocument()),
    /金額欄の掲載値が不正です/,
  );
});

test("rejects malformed corporate numbers and ambiguous multi-party coordinates", async () => {
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ firstCorporateNumbers: ["12345"] }), fixtureDocument()),
    /法人番号欄が不正です/,
  );
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ sameLineCorporateNumbers: true }), fixtureDocument()),
    /複数法人番号の行対応を座標から判定できません/,
  );
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ omitSecondOrganization: true }), fixtureDocument()),
    /複数当事者の名称と法人番号を対応付けられません/,
  );
});

test("accepts zero rows only with an exact sentinel and rejects textless/OCR-like pages", async () => {
  const zeroDocument = fixtureDocument({ pdfSchema: {
    expectedRecordCount: 0,
    expectedRowsPerPage: [0],
    expectedRowNumbers: { start: 1, end: 0 },
    emptySentinels: ["NO RECORDS"],
    minimumPositionedTextItems: 12,
  } });
  const zero = await parseOfficialPdf(await makeFixturePdf({ zeroSentinel: "NO RECORDS" }), zeroDocument);
  assert.equal(zero.length, 0);
  assert.equal(zero.emptySentinelFound, true);

  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ zeroSentinel: "NONE" }), zeroDocument),
    /掲載番号行がありません/,
  );
  await assert.rejects(
    parseOfficialPdf(await makeFixturePdf({ blankPage: true }), fixtureDocument({ pdfSchema: { minimumPositionedTextItems: 1 } })),
    /文字要素がありません（OCRは実行しません）/,
  );
});

test("can pin an immutable PDF byte-for-byte with SHA-256", async () => {
  const buffer = await makeFixturePdf();
  const expectedSha256 = createHash("sha256").update(buffer).digest("hex");
  await assert.doesNotReject(parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: { expectedBytes: buffer.length, expectedSha256 } })));
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: { expectedBytes: buffer.length + 1 } })),
    /PDFバイト数が検証済み値と一致しません/,
  );
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: { expectedSha256: "0".repeat(64) } })),
    /SHA-256が検証済み値と一致しません/,
  );
});

test("reuses only first-page headers when a pinned multipage schema explicitly requires it", async () => {
  const buffer = await makeFixturePdf({ continuationPage: true });
  const document = fixtureDocument({ pdfSchema: {
    expectedPageCount: 2,
    expectedRowsPerPage: [2, 1],
    expectedRecordCount: 3,
    expectedRowNumbers: { start: 1, end: 3 },
    headersOnFirstPageOnly: true,
    requiredPageText: [],
    requiredFirstPageText: ["Verified Table"],
  } });
  const records = await parseOfficialPdf(buffer, document);
  assert.deepEqual(records.map((record) => record.sourceRowNumber), [1, 2, 3]);
  assert.equal(records[2].sourceSheet, "PDF 2/2");
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
      expectedPageCount: 2,
      expectedRowsPerPage: [2, 1],
      expectedRecordCount: 3,
      expectedRowNumbers: { start: 1, end: 3 },
      requiredPageText: [],
      requiredFirstPageText: ["Verified Table"],
    } })),
    /見出しを一意に特定できません/,
  );
});

test("registers Tohoku and the eight official-index Kanto FY2025 grant PDFs without overstating coverage", () => {
  assert.equal(REGIONAL_PDF_DOCUMENTS.length, 10);
  const h1 = REGIONAL_PDF_DOCUMENTS.find((source) => source.id === "tohoku-2025-grant-decisions-h1");
  const h2 = REGIONAL_PDF_DOCUMENTS.find((source) => source.id === "tohoku-2025-grant-decisions-h2");
  assert.ok(h1);
  assert.ok(h2);
  assert.equal(h1.format, "pdf");
  assert.equal(h1.pdfSchema.extractionMode, "positioned_text_only");
  assert.equal(h1.pdfSchema.expectedPageCount, 8);
  assert.deepEqual(h1.pdfSchema.expectedRowsPerPage, [33, 36, 36, 36, 37, 37, 37, 8]);
  assert.equal(h1.pdfSchema.expectedRecordCount, 260);
  assert.equal(h1.pdfSchema.normalizeCompatibilityText, undefined);
  assert.equal(h1.pdfSchema.expectedBytes, 157_695);
  assert.match(h1.pdfSchema.expectedSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(h1.pdfSchema.expectedRowNumbers, { start: 1, end: 260 });
  assert.match(h1.coverageClaim, /260行/);
  assert.equal(h2.pdfSchema.expectedPageCount, 1);
  assert.deepEqual(h2.pdfSchema.expectedRowsPerPage, [26]);
  assert.equal(h2.pdfSchema.expectedRecordCount, 26);
  assert.equal(h2.pdfSchema.expectedBytes, 82_911);
  assert.match(h2.pdfSchema.expectedSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(h2.pdfSchema.expectedRowNumbers, { start: 1, end: 26 });
  assert.match(h2.coverageClaim, /26行/);
  const kanto = REGIONAL_PDF_DOCUMENTS.filter((source) => source.executorId === "kanto");
  assert.equal(kanto.length, 8);
  assert.equal(kanto.reduce((sum, source) => sum + source.pdfSchema.expectedRecordCount, 0), 284);
  assert.equal(kanto.reduce((sum, source) => sum + source.pdfSchema.expectedRowsPerPage.length, 0), 21);
  assert.ok(kanto.every((source) => source.url.startsWith("https://warp.ndl.go.jp/20260613/20260601093442/https://www.kanto.meti.go.jp/")));
  assert.ok(kanto.every((source) => source.originalUrl.startsWith("https://www.kanto.meti.go.jp/johokokai/data/7fy_")));
  assert.ok(kanto.every((source) => source.sourcePageUrl === "https://www.kanto.meti.go.jp/johokokai/kofu_kettei_jyokyo.html"));
  assert.ok(kanto.every((source) => source.amountStage === "交付決定額欄の掲載値"));
  assert.ok(kanto.every((source) => source.pdfSchema.normalizeCompatibilityText === true));
  assert.ok(kanto.every((source) => source.archiveExpectedBytes === source.pdfSchema.expectedBytes));
  assert.ok(kanto.every((source) => source.archiveExpectedSha256 === source.pdfSchema.expectedSha256));
  assert.ok(kanto.every((source) => source.archiveExpectedRecordCount === source.pdfSchema.expectedRecordCount));
  assert.deepEqual(KANTO_GRANT_INDEX_RECEIPT, {
    originalUrl: "https://www.kanto.meti.go.jp/johokokai/kofu_kettei_jyokyo.html",
    archiveUrl: "https://warp.ndl.go.jp/20260613/20260601093442/https://www.kanto.meti.go.jp/johokokai/kofu_kettei_jyokyo.html",
    expectedBytes: 23_677,
    expectedSha256: "09ea02e5a55136947de3552b193d7465e6e04e6ad1be2e8421288e2a06ce88bb",
    verifiedAt: "2026-08-12",
  });
  assert.ok(kanto.every((source) => source.discoveryReceipt === KANTO_GRANT_INDEX_RECEIPT));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "tohoku" && gap.missing.includes("2024年度以前")));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "tohoku" && gap.category === "contract_result" && gap.status === "not_ingested"));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "kanto" && gap.category === "grant_decision" && gap.missing.includes("令和3～6年度")));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "kanto" && gap.category === "contract_result" && gap.status === "not_ingested"));
});

async function makeFixturePdf(options = {}) {
  const pdf = await PDFDocument.create();
  if (options.blankPage) {
    pdf.addPage([1_000, 700]);
    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  }
  const page = pdf.addPage([1_000, 700]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (text, x, y, size = 10) => page.drawText(String(text), { x, y, size, font });
  draw("Verified Table", 30, 672, 14);
  const headerX = {
    ordinal: 30, program: 80, organization: 270, corporateNumber: 425, amount: 555,
    account: 670, budgetItem: 760, date: 850, publicInterestClass: 920, jurisdictionClass: 965,
  };
  const headerText = {
    ordinal: "No", program: "Program", organization: "Recipient", corporateNumber: "Corporate ID",
    amount: "Decision Amount", account: "Account", budgetItem: "Budget Item", date: "Decision Date",
    publicInterestClass: "Public Class", jurisdictionClass: "Jurisdiction", ...options.headerText,
  };
  for (const column of COLUMN_DEFINITIONS) draw(headerText[column.key], headerX[column.key], 620, 7);

  if (options.zeroSentinel) {
    draw(options.zeroSentinel, 80, 530, 10);
  } else {
    draw("1", 30, 535);
    draw("Long Program", 80, 552);
    draw("Name", 80, 532);
    draw("Org Alpha", 270, 552);
    if (!options.omitSecondOrganization) draw("Org Beta", 270, 517);
    const corporateNumbers = options.firstCorporateNumbers ?? ["1234567890123", "9876543210987"];
    if (options.sameLineCorporateNumbers) draw(corporateNumbers.join(" "), 425, 535, 7);
    else corporateNumbers.forEach((number, index) => draw(number, 425, 552 - index * 35, 7));
    if (options.combineAmountAccount) draw(`${options.firstAmount ?? "1,234,567"} General`, 625, 535, 8);
    else {
      draw(options.firstAmount ?? "1,234,567", 555, 535, 8);
      draw("General", 670, 535, 8);
    }
    draw("Grant item", 760, 535, 8);
    draw(options.firstDate ?? "2025/10/3", 850, 535, 8);
    draw("N/A", 920, 535, 7);
    draw("N/A", 965, 535, 7);

    if (!options.omitSecondRow) {
      draw("2", 30, 395);
      draw("Second Program", 80, 395, 9);
      draw("Municipality", 270, 395, 9);
      draw("NO ID", 425, 395, 9);
      if (options.combineAmountAccount) draw("0 General", 625, 395, 8);
      else {
        draw("0", 555, 395, 9);
        draw("General", 670, 395, 8);
      }
      draw("Other item", 760, 395, 8);
      draw("2026/1/20", 850, 395, 8);
      draw("N/A", 920, 395, 7);
      draw("N/A", 965, 395, 7);
    }
  }
  if (options.extraBlankPage) pdf.addPage([1_000, 700]);
  if (options.continuationPage) {
    const continuation = pdf.addPage([1_000, 700]);
    const drawContinuation = (text, x, y, size = 10) => continuation.drawText(String(text), { x, y, size, font });
    drawContinuation("3", 30, 535);
    drawContinuation("Continuation Program", 80, 535, 9);
    drawContinuation("Continuation Org", 270, 535, 9);
    drawContinuation("1234567890123", 425, 535, 7);
    drawContinuation("99,000", 555, 535, 8);
    drawContinuation("General", 670, 535, 8);
    drawContinuation("Other item", 760, 535, 8);
    drawContinuation("2026/2/20", 850, 535, 8);
    drawContinuation("N/A", 920, 535, 7);
    drawContinuation("N/A", 965, 535, 7);
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
