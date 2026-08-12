const CHUBU_SOURCE_PAGE = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html";
const CHUBU_DATA_ROOT = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/";
const CHUBU_CONTRACT_ROOT = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/";

const GRANT_COLUMNS = Object.freeze([
  ["ordinal", ["番号"]],
  ["program", ["事業名"]],
  ["organization", ["交付先名"]],
  ["corporateNumber", ["法人番号"]],
  ["amount", ["交付決定額"]],
  ["account", ["支出元会計区分"]],
  ["budgetItem", ["支出元(目)名称"]],
  ["date", ["交付決定日"]],
  ["publicInterestClass", ["公益法人の区分"]],
  // The official PDFs wrap this header differently at A3 and A4 sizes.
  ["jurisdictionClass", ["国所管、都道府県所", "国所管、都道府県"]],
]);

function makeColumns(pageWidth, leftPoints) {
  if (leftPoints.length !== GRANT_COLUMNS.length) {
    throw new Error("中部局交付決定PDFの列境界数が不正です");
  }
  return GRANT_COLUMNS.map(([key, headerAliases], index) => ({
    key,
    headerAliases,
    leftRatio: leftPoints[index] / pageWidth,
  }));
}

function makeGrantDocument({
  id,
  filename,
  period,
  expectedBytes,
  expectedSha256,
  expectedPageCount,
  expectedRowsPerPage,
  expectedRecordCount,
  expectedPositionedTextItemCount,
  pageWidth,
  leftPoints,
}) {
  const isFirstHalf = period === "4月～9月";
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2024,
    category: "grant_decision",
    kind: `補助金等の交付決定（${period}）`,
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    discoveryStatus: "linked_from_official_index_and_byte_pinned",
    verifiedAt: "2026-08-12",
    sourcePageUrl: CHUBU_SOURCE_PAGE,
    url: `${CHUBU_DATA_ROOT}${filename}`,
    coverageClaim: `令和6年度${period}の公式文字PDF全${expectedPageCount}ページに掲載された${expectedRecordCount}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      expectedBytes,
      expectedSha256,
      expectedPageCount,
      expectedPageSize: { width: pageWidth, height: 841.68, tolerance: 0.2 },
      expectedRowsPerPage,
      expectedRecordCount,
      expectedRowNumbers: { start: 1, end: expectedRecordCount },
      headersOnFirstPageOnly: true,
      requiredPageText: [],
      requiredFirstPageText: ["令和6年度補助金等の情報", "中部経済産業局"],
      columns: makeColumns(pageWidth, leftPoints),
      recordMapping: {
        ordinalColumn: "ordinal",
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        notesColumns: ["account", "budgetItem"],
      },
      allowedDateFormats: ["reiwa_ymd_ja"],
      dateRange: isFirstHalf
        ? { start: "2024-04-01", end: "2024-09-30" }
        : { start: "2024-10-01", end: "2025-03-31" },
      // The official table leaves this cell empty for individuals and some
      // local governments.  Empty means unlisted; it is never inferred.
      corporateNumberMissingSentinels: [""],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: Object.freeze({
      expectedMagic: "%PDF-",
      expectedBytes,
      expectedSha256,
      expectedRecordCount,
    }),
  });
}

export const CHUBU_GRANT_DOCUMENTS = Object.freeze([
  makeGrantDocument({
    id: "chubu-2024-grant-decisions-h1",
    filename: "r6fy_4-9.pdf",
    period: "4月～9月",
    expectedBytes: 481_736,
    expectedSha256: "04108b6750d19744a5c2ca02b66cc3272e34afdc5648cb44fa98c7371914f95a",
    expectedPageCount: 18,
    expectedRowsPerPage: [...Array(17).fill(12), 3],
    expectedRecordCount: 207,
    expectedPositionedTextItemCount: 2_345,
    pageWidth: 1_190.4,
    leftPoints: [50, 75, 290, 470, 565, 650, 730, 920, 1_005, 1_065],
  }),
  makeGrantDocument({
    id: "chubu-2024-grant-decisions-h2",
    filename: "r6fy_10-3.pdf",
    period: "10月～3月",
    expectedBytes: 362_051,
    expectedSha256: "f564b8c20f1c619b80e439f055aa5b36f449dd97ec8640517eb0571f8d5b97f0",
    expectedPageCount: 5,
    expectedRowsPerPage: [42, 45, 45, 45, 41],
    expectedRecordCount: 218,
    expectedPositionedTextItemCount: 2_577,
    pageWidth: 595.2,
    leftPoints: [50, 62, 155, 207, 250, 287, 330, 420, 465, 500],
  }),
]);

const CONTRACT_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["商号又は名称"]],
  ["corporateNumber", ["法人番号"]],
  ["address", ["住所"]],
  ["method", ["一般競争入札・"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["contractType", ["契約方式"]],
  ["notes", ["備考"]],
  ["publicInterestClass", ["公益法人の区分"]],
  ["jurisdictionClass", ["国所管、"]],
  ["bidderCount", ["応札・"]],
]);

function makeContractColumns(pageWidth, leftPoints) {
  if (leftPoints.length !== CONTRACT_COLUMNS.length) {
    throw new Error("中部局契約PDFの列境界数が不正です");
  }
  return CONTRACT_COLUMNS.map(([key, headerAliases], index) => ({
    key,
    headerAliases,
    leftRatio: leftPoints[index] / pageWidth,
  }));
}

function makeCompetitiveContractDocument({
  id,
  filename,
  costClass,
  expectedBytes,
  expectedSha256,
  expectedRecordCount,
  expectedPositionedTextItemCount,
  leftPoints,
}) {
  const pageWidth = 595.2;
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2024,
    category: "contract_result",
    kind: `競争入札（${costClass}）`,
    amountStage: "契約金額欄の掲載値",
    format: "pdf",
    discoveryStatus: "linked_from_official_index_and_byte_pinned",
    verifiedAt: "2026-08-12",
    sourcePageUrl: CHUBU_SOURCE_PAGE,
    url: `${CHUBU_CONTRACT_ROOT}nyusatsu/${filename}`,
    coverageClaim: `令和6年度・競争入札（${costClass}）の公式文字PDF全1ページに掲載された${expectedRecordCount}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      rowAnchorMode: "date",
      expectedBytes,
      expectedSha256,
      expectedPageCount: 1,
      expectedPageSize: { width: pageWidth, height: 841.68, tolerance: 0.2 },
      expectedRowsPerPage: [expectedRecordCount],
      expectedRecordCount,
      expectedRowNumbers: { start: 1, end: expectedRecordCount },
      requiredPageText: [],
      requiredFirstPageText: ["公共調達の適正化について", "競争入札に係る情報の公表"],
      columns: makeContractColumns(pageWidth, leftPoints),
      recordMapping: {
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        methodColumn: "method",
        notesColumns: ["contractType", "notes"],
      },
      allowedDateFormats: ["western_ymd_ja"],
      dateRange: { start: "2024-04-01", end: "2025-03-31" },
      corporateNumberMissingSentinels: ["-", "－", "法人番号なし"],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: Object.freeze({
      expectedMagic: "%PDF-",
      expectedBytes,
      expectedSha256,
      expectedRecordCount,
    }),
  });
}

// These two individual receipts are production-ready. The two discretionary
// files remain outside this array until their original bytes can also be Full
// GET verified; search-engine text is never used as a substitute source.
export const CHUBU_CONTRACT_DOCUMENTS = Object.freeze([
  makeCompetitiveContractDocument({
    id: "chubu-2024-competitive-commission",
    filename: "24-nyusatsu-itaku.pdf",
    costClass: "委託費の類",
    expectedBytes: 138_690,
    expectedSha256: "84b5fbd43fb250312c53fbd78cbd65106f0e5afb7efe36006675dd0126004c9f",
    expectedRecordCount: 10,
    expectedPositionedTextItemCount: 199,
    leftPoints: [50, 87, 140, 160, 205, 245, 315, 350, 382, 405, 416, 430, 465, 500, 518],
  }),
  makeCompetitiveContractDocument({
    id: "chubu-2024-competitive-goods",
    filename: "24-nyusatsu-ukeoi.pdf",
    costClass: "庁費の類",
    expectedBytes: 178_678,
    expectedSha256: "ded50227407b588ddc419b3e0125ed75d8ae15e67cb395d9fdb8cd31509c2d3b",
    expectedRecordCount: 32,
    expectedPositionedTextItemCount: 564,
    leftPoints: [50, 90, 147, 170, 215, 240, 295, 340, 365, 390, 402, 425, 465, 495, 518],
  }),
]);

export const CHUBU_COVERAGE_GAPS = Object.freeze([
  {
    executorId: "chubu",
    fiscalYear: 2024,
    category: "grant_decision",
    status: "verified_official_period_pair",
    included: "個別にFull GET検証した4月～9月・10月～3月PDF（計425掲載行）",
    missing: "公式目次HTML自体のbyte/SHAは公開manifestの検証対象外のため、年度母集団の完全性は主張しない",
  },
  {
    executorId: "chubu",
    fiscalYear: 2024,
    category: "contract_result",
    status: "verified_official_files_partial_categories",
    included: "個別にFull GET検証した競争入札の委託費・庁費PDF（2資料・42掲載行）",
    missing: "随意契約の委託費・庁費PDF（2資料）",
  },
  {
    executorId: "chubu",
    fiscalYear: null,
    category: "all",
    status: "not_ingested",
    included: "令和6年度の交付決定2資料と競争入札2資料",
    missing: "令和6年度の随意契約2資料、令和2～5・7年度の交付決定、令和2～5・7年度の契約結果、年度途中の令和8年度",
  },
]);
