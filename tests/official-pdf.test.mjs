import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { parseOfficialPdf } from "../scripts/official-pdf.mjs";
import {
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

test("anchors unnumbered contract rows only to strict dates in the pinned date column", async () => {
  const buffer = await makeFixturePdf();
  const records = await parseOfficialPdf(buffer, fixtureDocument({
    category: "contract_result",
    kind: "競争入札（委託費）",
    amountStage: "契約金額欄の掲載値",
    pdfSchema: {
      recordGranularity: "date_anchor_rows",
      recordMapping: {
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        notesColumns: ["account", "budgetItem"],
      },
    },
  }));
  assert.deepEqual(records.map((record) => record.sourceRowNumber), [1, 2]);
  assert.deepEqual(records.map((record) => record.sourceKey), [
    "regional-pdf-fixture:no-1",
    "regional-pdf-fixture:no-2",
  ]);
  assert.deepEqual(records.map((record) => record.date), ["2025-10-03", "2026-01-20"]);
});

test("splits one printed ordinal into strictly aligned recipient amount records", async () => {
  const buffer = await makeFixturePdf({ alignedAmounts: true });
  const document = fixtureDocument({ pdfSchema: {
    expectedRowsPerPage: [3],
    expectedRecordCount: 3,
    recordGranularity: "aligned_amount_rows",
    expectedSplitOrdinalFragments: [],
    expectedPartyCountsByOrdinal: { 1: 2 },
    expectedMissingCorporateNumberCount: 1,
    rowBoundaryOverrides: [],
  } });
  const records = await parseOfficialPdf(buffer, document);
  assert.deepEqual(records.map((record) => record.sourceKey), [
    "regional-pdf-fixture:no-1:recipient-1",
    "regional-pdf-fixture:no-1:recipient-2",
    "regional-pdf-fixture:no-2:recipient-1",
  ]);
  assert.deepEqual(records.map((record) => record.organization), ["Org Alpha", "Org Beta", "Municipality"]);
  assert.deepEqual(records.map((record) => record.amount), [1_234_567, 2_345_678, 0]);
  assert.deepEqual(records.map((record) => record.date), ["2025-10-03", "2025-10-04", "2026-01-20"]);
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
      expectedRowsPerPage: [3],
      expectedRecordCount: 3,
      recordGranularity: "aligned_amount_rows",
      expectedSplitOrdinalFragments: [],
      expectedPartyCountsByOrdinal: { 1: 3 },
      expectedMissingCorporateNumberCount: 1,
      rowBoundaryOverrides: [],
    } })),
    /交付先別金額行数が検証済み値と一致しません/,
  );
});

test("can anchor unnumbered contract rows by exact positioned dates and preserve the published method", async () => {
  const buffer = await makeFixturePdf({ omitOrdinals: true });
  const records = await parseOfficialPdf(buffer, fixtureDocument({
    category: "contract_result",
    kind: "競争入札（委託費）",
    amountStage: "契約額欄の掲載値",
    pdfSchema: {
      rowAnchorMode: "date",
      recordMapping: {
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        methodColumn: "account",
        notesColumns: ["budgetItem"],
      },
    },
  }));
  assert.deepEqual(records.map((record) => record.sourceRowNumber), [1, 2]);
  assert.ok(records.every((record) => record.method === "General"));
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

test("rejects an incomplete three-column split rule", async () => {
  await assert.rejects(parseOfficialPdf(await makeFixturePdf(), fixtureDocument({ pdfSchema: {
    crossColumnSplitRules: [{
      id: "date-organization-corporate-number", kind: "date_then_text_and_corporate_number",
      fromColumn: "amount", toColumn: "account", expectedMatches: 1,
    }],
  } })), /PDF列跨ぎ分割規則が不正です/);
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

test("allows only an exact pinned out-of-period date exception", async () => {
  const buffer = await makeFixturePdf({ firstDate: "2025/9/30" });
  await assert.doesNotReject(parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
    dateRangeExceptions: [{ ordinal: 1, raw: "2025/9/30", parsed: "2025-09-30" }],
  } })));
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
      dateRangeExceptions: [{ ordinal: 1, raw: "2025/9/29", parsed: "2025-09-29" }],
    } })),
    /対象期間外|日付範囲例外が検証済み行と一致しません/,
  );
});

test("narrows header discovery to a pinned upper-page band", async () => {
  const buffer = await makeFixturePdf();
  await assert.doesNotReject(parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: {
    headerMinimumYRatio: 0.85,
  } })));
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: { headerMinimumYRatio: 0.95 } })),
    /見出しを一意に特定できません/,
  );
  await assert.rejects(
    parseOfficialPdf(buffer, fixtureDocument({ pdfSchema: { headerMinimumYRatio: 0.49 } })),
    /PDF表スキーマが不正です/,
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

test("registers Tohoku and verified archived Kanto PDFs without overstating snapshot coverage", () => {
  assert.equal(REGIONAL_PDF_DOCUMENTS.length, 77);
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
  const tohokuContracts = REGIONAL_PDF_DOCUMENTS.filter((source) => source.executorId === "tohoku" && source.category === "contract_result");
  assert.equal(tohokuContracts.length, 18);
  assert.equal(tohokuContracts.reduce((sum, source) => sum + source.pdfSchema.expectedRecordCount, 0), 59);
  assert.equal(tohokuContracts.reduce((sum, source) => sum + source.pdfSchema.expectedRowsPerPage.length, 0), 20);
  assert.ok(tohokuContracts.every((source) => source.url.startsWith("https://warp.ndl.go.jp/20260613/20260601111544/https://www.tohoku.meti.go.jp/")));
  assert.ok(tohokuContracts.every((source) => source.originalUrl.startsWith("https://www.tohoku.meti.go.jp/kaikei/keiyaku/pdf/2025/")));
  assert.ok(tohokuContracts.every((source) => source.sourcePageUrl === "https://www.tohoku.meti.go.jp/kaikei/keiyaku/keiyaku.html"));
  assert.ok(tohokuContracts.every((source) => source.amountStage === "契約金額欄の掲載値"));
  assert.ok(tohokuContracts.every((source) => source.pdfSchema.recordGranularity === "date_anchor_rows"));
  const kanto = REGIONAL_PDF_DOCUMENTS.filter((source) => source.executorId === "kanto");
  const kantoGrants = kanto.filter((source) => source.category === "grant_decision");
  const kantoContracts = kanto.filter((source) => source.category === "contract_result");
  assert.equal(kanto.length, 57);
  assert.equal(kantoGrants.length, 41);
  assert.equal(kantoGrants.reduce((sum, source) => sum + source.pdfSchema.expectedRecordCount, 0), 1_486);
  assert.equal(kantoGrants.reduce((sum, source) => sum + source.pdfSchema.expectedRowsPerPage.length, 0), 82);
  assert.equal(kantoContracts.length, 16);
  assert.equal(kantoContracts.reduce((sum, source) => sum + source.pdfSchema.expectedRecordCount, 0), 306);
  assert.equal(kantoContracts.reduce((sum, source) => sum + source.pdfSchema.expectedRowsPerPage.length, 0), 35);
  assert.ok(kanto.every((source) => source.url.startsWith("https://warp.ndl.go.jp/")));
  assert.ok(kantoGrants.every((source) => /^https:\/\/www\.kanto\.meti\.go\.jp\/johokokai\/data\/[34567]fy_/.test(source.originalUrl)));
  assert.ok(kantoGrants.every((source) => source.sourcePageUrl === "https://www.kanto.meti.go.jp/johokokai/kofu_kettei_jyokyo.html"));
  assert.ok(kantoGrants.every((source) => source.amountStage === "交付決定額欄の掲載値"));
  assert.ok(kantoContracts.every((source) => /^https:\/\/www\.kanto\.meti\.go\.jp\/chotatsu\/chotatsu\/data\/[4567]fy_/.test(source.originalUrl)));
  assert.ok(kantoContracts.every((source) => source.sourcePageUrl === "https://www.kanto.meti.go.jp/chotatsu/chotatsu/index_keiyaku.html"));
  assert.ok(kantoContracts.every((source) => source.amountStage === "契約金額欄の掲載値"));
  assert.ok(kantoContracts.every((source) => source.pdfSchema.recordGranularity === "date_anchor_rows"));
  assert.ok(kanto.every((source) => source.pdfSchema.normalizeCompatibilityText === true));
  assert.ok(kanto.every((source) => source.archiveExpectedBytes === source.pdfSchema.expectedBytes));
  assert.ok(kanto.every((source) => source.archiveExpectedSha256 === source.pdfSchema.expectedSha256));
  assert.ok(kanto.every((source) => source.archiveExpectedRecordCount === source.pdfSchema.expectedRecordCount));
  assert.ok(kanto.every((source) => source.discoveryStatus === "archived_official_file"));
  assert.ok(kanto.every((source) => source.discoveryReceipt === undefined));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "tohoku" && gap.missing.includes("2024年度以前")));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "tohoku" && gap.category === "contract_result" && gap.status === "pilot_fiscal_year_complete" && gap.included.includes("18 PDF（59掲載行）")));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "kanto" && gap.category === "grant_decision" && gap.missing.includes("完全収録とは扱わない")));
  assert.ok(REGIONAL_PDF_COVERAGE_GAPS.some((gap) => gap.executorId === "kanto" && gap.category === "contract_result" && gap.status === "verified_archived_official_snapshots" && gap.missing.includes("保存時点より後")));
});

test("replays all 18 exact FY2025 Tohoku contract PDFs through the production parser", async () => {
  const contracts = REGIONAL_PDF_DOCUMENTS.filter((source) => source.executorId === "tohoku" && source.category === "contract_result");
  const observed = [];
  const allRecords = [];
  for (const document of contracts) {
    const filename = new URL(document.originalUrl).pathname.split("/").at(-1);
    const buffer = await readFile(new URL(`../evidence/tohoku-2025-contracts/${filename}`, import.meta.url));
    const records = await parseOfficialPdf(buffer, document);
    allRecords.push(...records);
    observed.push({ id: document.id, pages: document.pdfSchema.expectedPageCount, rows: records.length });
  }
  assert.equal(observed.length, 18);
  assert.equal(observed.reduce((sum, item) => sum + item.pages, 0), 20);
  assert.equal(observed.reduce((sum, item) => sum + item.rows, 0), 59);
  const first = allRecords.find((record) => record.sourceKey === "tohoku-2025-competitive-commission-1:no-1");
  assert.ok(first);
  assert.equal(first.date, "2025-04-01");
  assert.equal(first.organization, "公益財団法人原子力安全研究協会");
  assert.equal(first.amount, 8_690_000);
  const nonNumericAmounts = allRecords.filter((record) => record.amount === null);
  assert.equal(nonNumericAmounts.length, 1);
  assert.equal(nonNumericAmounts[0].amountRaw, "-");
  assert.match(nonNumericAmounts[0].notes, /単価契約/);
  const fragmentedDates = observed.find((item) => item.id === "tohoku-2025-discretionary-commission-1");
  assert.deepEqual(fragmentedDates, { id: "tohoku-2025-discretionary-commission-1", pages: 3, rows: 22 });
});

test("binds the saved Tohoku FY2025 contract index and all 18 PDF bytes to one reproducible receipt", async () => {
  const evidenceRoot = new URL("../evidence/tohoku-2025-contracts/", import.meta.url);
  const receipt = JSON.parse(await readFile(new URL("receipt.json", evidenceRoot), "utf8"));
  const index = await readFile(new URL(receipt.index.file, evidenceRoot));
  assert.equal(index.length, receipt.index.bytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.index.sha256);
  assert.equal(receipt.index.fiscalYear2025Hrefs.length, 18);
  assert.equal(new Set(receipt.index.fiscalYear2025Hrefs).size, 18);
  assert.equal(receipt.documents.length, 18);
  for (const item of receipt.documents) {
    assert.ok(receipt.index.fiscalYear2025Hrefs.includes(`pdf/2025/${item.file}`), item.id);
    const bytes = await readFile(new URL(item.file, evidenceRoot));
    assert.equal(bytes.length, item.bytes, item.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.rowsPerPage.reduce((sum, count) => sum + count, 0), item.rows, item.id);
  }
  assert.deepEqual(receipt.totals, {
    documents: 18, bytes: 1_568_369, pages: 20, rows: 59, positionedTextItems: 1_866,
  });
});

test("replays the four exact FY2025 Kanto contract PDFs through the production parser", async () => {
  const contracts = REGIONAL_PDF_DOCUMENTS.filter((source) => source.id.startsWith("kanto-2025-contracts-"));
  const observed = [];
  for (const document of contracts) {
    const filename = new URL(document.originalUrl).pathname.split("/").at(-1);
    const buffer = await readFile(new URL(`../evidence/kanto-2025-contracts/${filename}`, import.meta.url));
    const records = await parseOfficialPdf(buffer, document);
    observed.push({
      id: document.id,
      pages: document.pdfSchema.expectedPageCount,
      items: document.pdfSchema.expectedPositionedTextItemCount,
      rows: records.length,
    });
  }
  assert.deepEqual(observed, [
    { id: "kanto-2025-contracts-competitive-goods-services", pages: 1, items: 291, rows: 17 },
    { id: "kanto-2025-contracts-competitive-commission", pages: 1, items: 221, rows: 11 },
    { id: "kanto-2025-contracts-discretionary-goods-services", pages: 1, items: 118, rows: 4 },
    { id: "kanto-2025-contracts-discretionary-commission", pages: 4, items: 1207, rows: 55 },
  ]);
});

test("binds the saved Kanto contract index inventory and PDF bytes to one reproducible receipt", async () => {
  const evidenceRoot = new URL("../evidence/kanto-2025-contracts/", import.meta.url);
  const receipt = JSON.parse(await readFile(new URL("receipt.json", evidenceRoot), "utf8"));
  const index = await readFile(new URL(receipt.index.file, evidenceRoot));
  assert.equal(index.length, receipt.index.bytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.index.sha256);
  assert.equal(receipt.index.fiscalYear2025Hrefs.length, 4);
  assert.equal(new Set(receipt.index.fiscalYear2025Hrefs).size, 4);
  for (const item of receipt.documents) {
    const bytes = await readFile(new URL(item.file, evidenceRoot));
    assert.equal(bytes.length, item.bytes, item.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.rowsPerPage.reduce((sum, count) => sum + count, 0), item.rows, item.id);
  }
  assert.deepEqual(receipt.totals, {
    documents: 4, bytes: 818327, pages: 7, rows: 87, positionedTextItems: 1837,
  });
});

test("replays all 33 exact FY2021-FY2024 Kanto grant PDFs through the production parser", async () => {
  const grants = REGIONAL_PDF_DOCUMENTS.filter((source) => /^kanto-202[1-4]-grant-decisions-/.test(source.id));
  const observed = [];
  const records = [];
  for (const document of grants) {
    const filename = new URL(document.originalUrl).pathname.split("/").at(-1);
    const buffer = await readFile(new URL(`../evidence/kanto-2021-2024-grants/${filename}`, import.meta.url));
    const parsed = await parseOfficialPdf(buffer, document);
    records.push(...parsed);
    observed.push({ fiscalYear: document.fiscalYear, pages: document.pdfSchema.expectedPageCount, rows: parsed.length });
  }
  assert.equal(observed.length, 33);
  assert.equal(observed.reduce((sum, item) => sum + item.pages, 0), 61);
  assert.equal(observed.reduce((sum, item) => sum + item.rows, 0), 1_202);
  assert.deepEqual(Object.fromEntries([2021, 2022, 2023, 2024].map((year) => [year,
    observed.filter((item) => item.fiscalYear === year).reduce((sum, item) => sum + item.rows, 0)])),
  { 2021: 334, 2022: 305, 2023: 271, 2024: 292 });
  const dateAnomaly = records.find((record) =>
    record.sourceKey === "kanto-2021-grant-decisions-h2-general-subsidy:no-34");
  assert.ok(dateAnomaly);
  assert.equal(dateAnomaly.dateRaw, "令和4年11月12日");
  assert.equal(dateAnomaly.date, "2022-11-12");
  const multiParty = records.find((record) =>
    record.sourceKey === "kanto-2024-grant-decisions-h1-general-subsidy:no-98");
  assert.deepEqual(multiParty.organizations, ["三勝株式会社", "関東注染工業協同組合"]);
  assert.deepEqual(multiParty.corporateNumbers, ["1010001044192", "2011805001584"]);
  assert.equal(multiParty.amount, 5_600_000);
  assert.equal(records.filter((record) => !record.corporateNumbers.length).length, 7);
});

test("binds the Kanto FY2021-FY2024 grant index, 33 PDF bytes, and parser receipts", async () => {
  const root = new URL("../evidence/kanto-2021-2024-grants/", import.meta.url);
  const receipt = JSON.parse(await readFile(new URL("receipt.json", root), "utf8"));
  const index = await readFile(new URL(receipt.index.file, root));
  assert.equal(index.length, receipt.index.bytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.index.sha256);
  assert.equal(receipt.index.fiscalYear2021To2024Hrefs.length, 33);
  assert.equal(new Set(receipt.index.fiscalYear2021To2024Hrefs).size, 33);
  assert.equal(receipt.documents.length, 33);
  for (const item of receipt.documents) {
    assert.ok(receipt.index.fiscalYear2021To2024Hrefs.includes(
      `/20260613/20260601093442/https://www.kanto.meti.go.jp/johokokai/data/${item.file}`), item.id);
    const bytes = await readFile(new URL(item.file, root));
    assert.equal(bytes.length, item.bytes, item.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.rowsPerPage.reduce((sum, count) => sum + count, 0), item.rows, item.id);
  }
  assert.deepEqual(receipt.totals, {
    documents: 33,
    bytes: 14_262_886,
    pages: 61,
    rows: 1_202,
    rawPositionedTextItems: 16_812,
    parsedPositionedTextItems: 16_828,
  });
  assert.match(receipt.dateAnomaly, /推測修正せず/);
  assert.match(receipt.coverageLimitation, /完全収録を意味しない/);
});

test("replays all 12 exact FY2022-FY2024 Kanto contract snapshots", async () => {
  const contracts = REGIONAL_PDF_DOCUMENTS.filter((source) => /^kanto-202[234]-contracts-/.test(source.id));
  const observed = [];
  for (const document of contracts) {
    const filename = new URL(document.originalUrl).pathname.split("/").at(-1);
    const buffer = await readFile(new URL(`../evidence/kanto-2022-2024-contracts/${filename}`, import.meta.url));
    const records = await parseOfficialPdf(buffer, document);
    observed.push({ fiscalYear: document.fiscalYear, pages: document.pdfSchema.expectedPageCount, rows: records.length });
  }
  assert.equal(observed.length, 12);
  assert.equal(observed.reduce((sum, item) => sum + item.pages, 0), 28);
  assert.equal(observed.reduce((sum, item) => sum + item.rows, 0), 219);
  assert.deepEqual(Object.fromEntries([2022, 2023, 2024].map((year) => [year,
    observed.filter((item) => item.fiscalYear === year).reduce((sum, item) => sum + item.rows, 0)])),
  { 2022: 75, 2023: 74, 2024: 70 });
  assert.ok(contracts.every((document) => document.coverageClaim.includes("保存時点以降の追加行は未収録")));
});

test("binds the Kanto FY2022-FY2024 hrefs and PDF bytes to one receipt", async () => {
  const root = new URL("../evidence/kanto-2022-2024-contracts/", import.meta.url);
  const receipt = JSON.parse(await readFile(new URL("receipt.json", root), "utf8"));
  const index = await readFile(new URL(receipt.index.file, root));
  assert.equal(index.length, receipt.index.bytes);
  assert.equal(createHash("sha256").update(index).digest("hex"), receipt.index.sha256);
  assert.equal(receipt.index.fiscalYear2022To2024Hrefs.length, 12);
  for (const item of receipt.documents) {
    const bytes = await readFile(new URL(item.file, root));
    assert.equal(bytes.length, item.bytes, item.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.rowsPerPage.reduce((sum, count) => sum + count, 0), item.rows, item.id);
  }
  assert.deepEqual(receipt.totals, {documents:12,bytes:1560962,pages:28,rows:219,positionedTextItems:5563});
  assert.match(receipt.coverageLimitation, /完全収録ではない/);
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
    if (!options.omitOrdinals) draw("1", 30, 535);
    draw("Long Program", 80, 552);
    draw("Name", 80, 532);
    draw("Org Alpha", 270, 552);
    if (!options.omitSecondOrganization) draw("Org Beta", 270, 517);
    const corporateNumbers = options.firstCorporateNumbers ?? ["1234567890123", "9876543210987"];
    if (options.sameLineCorporateNumbers) draw(corporateNumbers.join(" "), 425, 535, 7);
    else corporateNumbers.forEach((number, index) => draw(number, 425, 552 - index * 35, 7));
    if (options.alignedAmounts) {
      draw(options.firstAmount ?? "1,234,567", 555, 552, 8);
      draw("2,345,678", 555, 517, 8);
      draw("General", 670, 552, 8);
      draw("General", 670, 517, 8);
      draw("Grant item", 760, 552, 8);
      draw("Grant item", 760, 517, 8);
      draw(options.firstDate ?? "2025/10/3", 850, 552, 8);
      draw("2025/10/4", 850, 517, 8);
      draw("N/A", 920, 552, 7);
      draw("N/A", 920, 517, 7);
      draw("N/A", 965, 552, 7);
      draw("N/A", 965, 517, 7);
    } else if (options.combineAmountAccount) draw(`${options.firstAmount ?? "1,234,567"} General`, 625, 535, 8);
    else {
      draw(options.firstAmount ?? "1,234,567", 555, 535, 8);
      draw("General", 670, 535, 8);
    }
    if (!options.alignedAmounts) {
      draw("Grant item", 760, 535, 8);
      draw(options.firstDate ?? "2025/10/3", 850, 535, 8);
      draw("N/A", 920, 535, 7);
      draw("N/A", 965, 535, 7);
    }

    if (!options.omitSecondRow) {
      if (!options.omitOrdinals) draw("2", 30, 395);
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
