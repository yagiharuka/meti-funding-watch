const SOURCE_PAGE = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html";
const ROOT = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/";
const WARP = "https://warp.ndl.go.jp/20260613/20260601101404/";
const PAGE_WIDTH = 841.68;
const PAGE_HEIGHT = 595.2;
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const ARCHIVE_VERIFICATION = "公式目次の保存HTMLにある実hrefをFull GETし、原本のbytes・SHA-256・magic・全行parseを固定";

function columns(definitions, leftPoints) {
  if (definitions.length !== leftPoints.length) throw new Error("中部局FY2022 PDFの列境界数が不正です");
  return definitions.map(([key, headerAliases], index) => ({ key, headerAliases, leftRatio: leftPoints[index] / PAGE_WIDTH }));
}

function archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount) {
  return {
    discoveryStatus: "linked_from_official_index_archive_byte_pinned",
    verifiedAt: "2026-08-15",
    sourcePageUrl: SOURCE_PAGE,
    url: `${WARP}${originalUrl}`,
    originalUrl,
    archiveProvider: ARCHIVE_PROVIDER,
    archiveVerifiedAt: "2026-08-15",
    archiveVerification: ARCHIVE_VERIFICATION,
    archiveExpectedBytes: expectedBytes,
    archiveExpectedSha256: expectedSha256,
    archiveExpectedRecordCount: expectedRecordCount,
  };
}

function evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount) {
  return Object.freeze({ expectedMagic: "%PDF-", expectedBytes, expectedSha256, expectedRecordCount });
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

// The FY2022 discretionary-goods PDF uses an older order with the address
// before the corporate number and the notes column at the far right.
const DISCRETIONARY_GOODS_COLUMNS = Object.freeze([
  ["program", ["物品役務等の名称"]],
  ["officer", ["契約担当官等の氏名"]],
  ["date", ["契約を締結した日"]],
  ["organization", ["契約の相手方の商号"]],
  ["address", ["契約の相手方の住所"]],
  ["corporateNumber", ["契約の相手方の法人番号"]],
  ["legalReason", ["随意契約によることとした"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["reemployedOfficerCount", ["再就職の役員"]],
  ["publicInterestClass", ["公益法人の区"]],
  ["jurisdictionClass", ["国所管、都道府"]],
  ["bidderCount", ["応札・応募者数"]],
  ["notes", ["備考"]],
]);

function grantDocument({ id, filename, period, expectedBytes, expectedSha256, expectedRowsPerPage, expectedPositionedTextItemCount }) {
  const expectedRecordCount = expectedRowsPerPage.reduce((sum, value) => sum + value, 0);
  const firstHalf = period === "4月～9月";
  const originalUrl = `${ROOT}hojyokin/${filename}`;
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2022,
    category: "grant_decision",
    kind: `補助金等の交付決定（${period}）`,
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    ...archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount),
    coverageClaim: `WARP保存時点の令和4年度${period}の公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
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
      expectedRowNumbers: { start: 1, end: expectedRecordCount },
      headersOnFirstPageOnly: true,
      requiredPageText: [],
      requiredFirstPageText: ["令和04年度補助金等の情報", "中部経済産業局"],
      columns: columns(GRANT_COLUMNS, [28, 50, 215, 340, 405, 460, 550, 665, 725, 760]),
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
        ? { start: "2022-04-01", end: "2022-09-30" }
        : { start: "2022-10-01", end: "2023-03-31" },
      corporateNumberMissingSentinels: ["", "-", "－"],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

function contractDocument({ id, filename, type, costClass, expectedBytes, expectedSha256, expectedRowsPerPage, expectedPositionedTextItemCount, pageHeight = PAGE_HEIGHT, oldGoodsLayout = false }) {
  const competitive = type === "competitive";
  const expectedRecordCount = expectedRowsPerPage.reduce((sum, value) => sum + value, 0);
  const subdir = competitive ? "nyusatsu" : "zuikei";
  const originalUrl = `${ROOT}${subdir}/${filename}`;
  const definitions = competitive ? COMPETITIVE_COLUMNS : oldGoodsLayout ? DISCRETIONARY_GOODS_COLUMNS : DISCRETIONARY_COLUMNS;
  const leftPoints = competitive
    ? [15, 75, 155, 215, 280, 345, 415, 495, 545, 595, 640, 675, 715, 765]
    : oldGoodsLayout
      ? [5, 53, 136, 182, 234, 287, 351, 497, 545, 583, 606, 642, 681, 720, 770]
      : [15, 70, 140, 195, 245, 305, 370, 465, 520, 570, 610, 645, 680, 725, 780];
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear: 2022,
    category: "contract_result",
    kind: `${competitive ? "競争入札" : "随意契約"}（${costClass}）`,
    amountStage: "契約金額欄の掲載値",
    format: "pdf",
    ...archiveFields(originalUrl, expectedBytes, expectedSha256, expectedRecordCount),
    coverageClaim: `WARP保存時点の令和4年度・${competitive ? "競争入札" : "随意契約"}（${costClass}）公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      rowAnchorMode: "date",
      expectedBytes,
      expectedSha256,
      expectedPageCount: expectedRowsPerPage.length,
      expectedPageSize: { width: PAGE_WIDTH, height: pageHeight, tolerance: 0.2 },
      expectedRowsPerPage,
      expectedRecordCount,
      expectedRowNumbers: { start: 1, end: expectedRecordCount },
      ...(expectedRowsPerPage.length > 1 ? { headersOnFirstPageOnly: true } : {}),
      requiredPageText: [],
      requiredFirstPageText: ["公共調達の適正化について", `${competitive ? "競争入札" : "随意契約"}に係る情報の公表`],
      columns: columns(definitions, leftPoints),
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
      dateRange: { start: "2022-04-01", end: "2023-03-31" },
      corporateNumberMissingSentinels: ["", "-", "－", "法人番号なし"],
      minimumPositionedTextItems: expectedPositionedTextItemCount,
      expectedPositionedTextItemCount,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

export const CHUBU_FY2022_GRANT_DOCUMENTS = Object.freeze([
  grantDocument({
    id: "chubu-2022-grant-decisions-h1",
    filename: "r4fy_4-9.pdf",
    period: "4月～9月",
    expectedBytes: 393_052,
    expectedSha256: "8eae0800f65273cc3543d61dcc5a45c677e490b6f0b394cc401ec7d642667670",
    expectedRowsPerPage: [21, 22, 25, 25, 25, 24, 23],
    expectedPositionedTextItemCount: 2_181,
  }),
  grantDocument({
    id: "chubu-2022-grant-decisions-h2",
    filename: "r4fy_10-3.pdf",
    period: "10月～3月",
    expectedBytes: 135_918,
    expectedSha256: "a2710a4ca4ab2307576721342aaacff6d611a95905a7061902c2caee6738fba2",
    expectedRowsPerPage: [16, 1],
    expectedPositionedTextItemCount: 264,
  }),
]);

export const CHUBU_FY2022_CONTRACT_DOCUMENTS = Object.freeze([
  contractDocument({
    id: "chubu-2022-competitive-commission",
    filename: "22-nyusatsu-itaku.pdf",
    type: "competitive",
    costClass: "委託費の類",
    expectedBytes: 135_508,
    expectedSha256: "84d958e5847a5e0864d6fcc6142745f7b2e444c3cacab72caf9853f0457816c1",
    expectedRowsPerPage: [10],
    expectedPositionedTextItemCount: 315,
    pageHeight: 1_190.4,
  }),
  contractDocument({
    id: "chubu-2022-competitive-goods",
    filename: "22-ukeoi.pdf",
    type: "competitive",
    costClass: "庁費の類",
    expectedBytes: 183_778,
    expectedSha256: "8fc64f358cfaa8509f927d5299cb6ae88944b4e7d9a0c19a1aa5265e30d7cd72",
    expectedRowsPerPage: [6, 7, 7, 5],
    expectedPositionedTextItemCount: 712,
  }),
  contractDocument({
    id: "chubu-2022-discretionary-commission",
    filename: "22-zuikei-itaku.pdf",
    type: "discretionary",
    costClass: "委託費の類",
    expectedBytes: 222_222,
    expectedSha256: "bc41295700790dd6b421ad08e77809dbd81a81f52d87b9c62f48cf3ba7ab2bdb",
    expectedRowsPerPage: [7, 6, 4, 3, 3, 3, 5, 6, 5],
    expectedPositionedTextItemCount: 1_710,
  }),
  contractDocument({
    id: "chubu-2022-discretionary-goods",
    filename: "22-zuikei-ukeoi.pdf",
    type: "discretionary",
    costClass: "庁費の類",
    expectedBytes: 90_326,
    expectedSha256: "c33b9b5da9987937aa7909ef313441baca4aa38fc10d5f200645fc4efb727c45",
    expectedRowsPerPage: [6],
    expectedPositionedTextItemCount: 206,
    oldGoodsLayout: true,
  }),
]);
