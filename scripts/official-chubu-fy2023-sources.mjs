const CHUBU_SOURCE_PAGE = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html";
const CHUBU_DATA_ROOT = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/";
const CHUBU_WARP_PREFIX = "https://warp.ndl.go.jp/20260613/20260601101404/";
const PAGE_WIDTH = 841.68;
const PAGE_HEIGHT = 595.2;

const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const ARCHIVE_VERIFICATION = "公式目次の保存HTMLにある実hrefをFull GETし、原本のbytes・SHA-256・magic・全行parseを固定";

function columns(definitions, leftPoints) {
  if (definitions.length !== leftPoints.length) throw new Error("中部局FY2023 PDFの列境界数が不正です");
  return definitions.map(([key, headerAliases], index) => ({ key, headerAliases, leftRatio: leftPoints[index] / PAGE_WIDTH }));
}

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
  ["jurisdictionClass", ["国所管、都道府"]],
]);

const COMPETITIVE_COLUMNS = Object.freeze([
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
  ["notes", ["備考"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、"]],
  ["bidderCount", ["応札・"]],
]);

const DISCRETIONARY_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["方の商号"]],
  ["corporateNumber", ["法人番号"]],
  ["address", ["の住所"]],
  ["legalReason", ["随意契約によること"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["reemployedOfficerCount", ["再就職"]],
  ["notes", ["備考"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、"]],
  ["bidderCount", ["応札・"]],
]);

function archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount) {
  return {
    discoveryStatus: "linked_from_official_index_archive_byte_pinned",
    verifiedAt: "2026-08-14",
    sourcePageUrl: CHUBU_SOURCE_PAGE,
    url: `${CHUBU_WARP_PREFIX}${originalUrl}`,
    originalUrl,
    archiveProvider: ARCHIVE_PROVIDER,
    archiveVerifiedAt: "2026-08-14",
    archiveVerification: ARCHIVE_VERIFICATION,
    archiveExpectedBytes: expectedBytes,
    archiveExpectedSha256: expectedSha256,
    archiveExpectedRecordCount: expectedRecordCount,
  };
}

function evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount) {
  return Object.freeze({ expectedMagic: "%PDF-", expectedBytes, expectedSha256, expectedRecordCount });
}

function grantDocument({ id, filename, period, expectedBytes, expectedSha256, expectedRowsPerPage, expectedRecordCount,
  expectedPositionedTextItemCount, leftPoints, expectedRowNumbers, expectedBlankOrganizationOrdinals = [] }) {
  const firstHalf = period === "4月～9月";
  const originalUrl = `${CHUBU_DATA_ROOT}hojyokin/${filename}`;
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2023,
    category: "grant_decision",
    kind: `補助金等の交付決定（${period}）`,
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    ...archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount),
    coverageClaim: `WARP保存時点の令和5年度${period}の公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      expectedBytes,
      expectedSha256,
      expectedPageCount: expectedRowsPerPage.length,
      expectedPageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT, tolerance: 0.2 },
      expectedRowsPerPage,
      expectedRecordCount,
      expectedRowNumbers,
      ...(expectedBlankOrganizationOrdinals.length ? { expectedBlankOrganizationOrdinals } : {}),
      headersOnFirstPageOnly: true,
      requiredPageText: [],
      requiredFirstPageText: ["令和05年度補助金等の情報", "中部経済産業局"],
      columns: columns(GRANT_COLUMNS, leftPoints),
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
      dateRange: firstHalf
        ? { start: "2023-04-01", end: "2023-09-30" }
        : { start: "2023-10-01", end: "2024-03-31" },
      corporateNumberMissingSentinels: ["", "-", "－"],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

function contractDocument({ id, filename, type, costClass, expectedBytes, expectedSha256, expectedRowsPerPage,
  expectedRecordCount, expectedPositionedTextItemCount, leftPoints }) {
  const competitive = type === "competitive";
  const subdir = competitive ? "nyusatsu" : "zuikei";
  const originalUrl = `${CHUBU_DATA_ROOT}${subdir}/${filename}`;
  const columnDefinitions = competitive ? COMPETITIVE_COLUMNS : DISCRETIONARY_COLUMNS;
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2023,
    category: "contract_result",
    kind: `${competitive ? "競争入札" : "随意契約"}（${costClass}）`,
    amountStage: "契約金額欄の掲載値",
    format: "pdf",
    ...archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount),
    coverageClaim: `WARP保存時点の令和5年度・${competitive ? "競争入札" : "随意契約"}（${costClass}）公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      rowAnchorMode: "date",
      expectedBytes,
      expectedSha256,
      expectedPageCount: expectedRowsPerPage.length,
      expectedPageSize: { width: PAGE_WIDTH, height: PAGE_HEIGHT, tolerance: 0.2 },
      expectedRowsPerPage,
      expectedRecordCount,
      expectedRowNumbers: { start: 1, end: expectedRecordCount },
      ...(expectedRowsPerPage.length > 1 ? { headersOnFirstPageOnly: true } : {}),
      requiredPageText: [],
      requiredFirstPageText: ["公共調達の適正化について", `${competitive ? "競争入札" : "随意契約"}に係る情報の公表`],
      columns: columns(columnDefinitions, leftPoints),
      recordMapping: {
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        methodColumn: competitive ? "method" : "legalReason",
        notesColumns: ["notes"],
      },
      allowedDateFormats: ["western_ymd_ja"],
      dateRange: { start: "2023-04-01", end: "2024-03-31" },
      corporateNumberMissingSentinels: ["-", "－", "法人番号なし"],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

export const CHUBU_FY2023_GRANT_DOCUMENTS = Object.freeze([
  grantDocument({
    id: "chubu-2023-grant-decisions-h1",
    filename: "r5fy_4-9.pdf",
    period: "4月～9月",
    expectedBytes: 418_926,
    expectedSha256: "9ff29945ebc29911b723f5ac557e67f94890b6d9282c6986fff3c891606cff74",
    expectedRowsPerPage: [10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 4],
    expectedRecordCount: 170,
    expectedPositionedTextItemCount: 2_280,
    leftPoints: [28, 50, 215, 340, 405, 460, 550, 665, 725, 760],
    expectedRowNumbers: { start: 1, end: 170 },
  }),
  grantDocument({
    id: "chubu-2023-grant-decisions-h2",
    filename: "r5fy_10-3.pdf",
    period: "10月～3月",
    expectedBytes: 201_458,
    expectedSha256: "d81b9409cf04fee5ce77245d179e66a34789df635e616575e6adff21580055a7",
    expectedRowsPerPage: [12, 14, 14, 14],
    expectedRecordCount: 54,
    expectedPositionedTextItemCount: 696,
    leftPoints: [28, 50, 200, 320, 385, 445, 545, 665, 725, 760],
    expectedRowNumbers: { start: 1, end: 58, omitted: [11, 12, 15, 17] },
    expectedBlankOrganizationOrdinals: [27, 28, 29],
  }),
]);

export const CHUBU_FY2023_CONTRACT_DOCUMENTS = Object.freeze([
  contractDocument({
    id: "chubu-2023-competitive-commission",
    filename: "23-nyusatsu-itaku.pdf",
    type: "competitive",
    costClass: "委託費の類",
    expectedBytes: 120_104,
    expectedSha256: "666ab5fba88ef2b043b939a64bf7cf6de0bef50e548531cafcfd0239004739d9",
    expectedRowsPerPage: [5, 2],
    expectedRecordCount: 7,
    expectedPositionedTextItemCount: 229,
    leftPoints: [15, 75, 155, 215, 280, 345, 415, 500, 550, 600, 645, 680, 725, 780],
  }),
  contractDocument({
    id: "chubu-2023-competitive-goods",
    filename: "23-ukeoi.pdf",
    type: "competitive",
    costClass: "庁費の類",
    expectedBytes: 171_505,
    expectedSha256: "226da7ccb6ba81e52c33fb5c2ca52e2056466142730db5624452dd7157756987",
    expectedRowsPerPage: [6, 7, 6, 8, 2],
    expectedRecordCount: 29,
    expectedPositionedTextItemCount: 756,
    leftPoints: [15, 75, 155, 215, 280, 345, 415, 495, 545, 595, 640, 675, 715, 765],
  }),
  contractDocument({
    id: "chubu-2023-discretionary-commission",
    filename: "23-zuikei-itaku.pdf",
    type: "discretionary",
    costClass: "委託費の類",
    expectedBytes: 223_892,
    expectedSha256: "68d9e5c9c2e60d3882bc9f362cffb387513348824c664ff1eb9fcb68305be6da",
    expectedRowsPerPage: [5, 5, 5, 5, 3, 3, 3, 4, 4, 4],
    expectedRecordCount: 41,
    expectedPositionedTextItemCount: 1_565,
    leftPoints: [15, 70, 140, 195, 245, 305, 370, 465, 520, 570, 610, 645, 680, 725, 780],
  }),
  contractDocument({
    id: "chubu-2023-discretionary-goods",
    filename: "23-zuikei-ukeoi.pdf",
    type: "discretionary",
    costClass: "庁費の類",
    expectedBytes: 115_261,
    expectedSha256: "5471dad9fd1006fc0d252f85e64e56e98af32760f4b1fe84862c592c42f9ea6e",
    expectedRowsPerPage: [5],
    expectedRecordCount: 5,
    expectedPositionedTextItemCount: 222,
    leftPoints: [15, 70, 140, 195, 245, 305, 375, 465, 520, 570, 610, 645, 680, 725, 780],
  }),
]);
