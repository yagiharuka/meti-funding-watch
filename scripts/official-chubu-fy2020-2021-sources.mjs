const SOURCE_PAGE = "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html";
const PAGE_WIDTH = 841.68;
const PAGE_HEIGHT = 595.2;
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const ARCHIVE_VERIFICATION = "公式目次の保存HTMLで実hrefを確認し、WARP TimeMap→閲覧HTML iframeの保存原本をFull GETしてbytes・SHA-256・magicを固定";

function columns(definitions, leftPoints) {
  if (definitions.length !== leftPoints.length) throw new Error("中部局FY2020-2021 PDFの列境界数が不正です");
  return definitions.map(([key, headerAliases], index) => ({ key, headerAliases, leftRatio: leftPoints[index] / PAGE_WIDTH }));
}

function archiveFields({ rawUrl, originalUrl, expectedBytes, expectedSha256, expectedRecordCount }) {
  return {
    discoveryStatus: "linked_from_official_index_archive_byte_pinned",
    verifiedAt: "2026-08-15",
    sourcePageUrl: SOURCE_PAGE,
    url: rawUrl,
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
  ["publicInterestClass", ["公益法人の区分", "公益法人の区"]],
  ["jurisdictionClass", ["国所管、都道府県", "国所管、"]],
]);

const COMPETITIVE_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["商号又は名称", "契約の相手方の商"]],
  ["corporateNumber", ["法人番号"]],
  ["address", ["住所"]],
  ["method", ["一般競争入札・", "指名競争入札の別"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["notes", ["備考"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、", "都道府県"]],
  ["bidderCount", ["応札・"]],
]);

const COMPETITIVE_GOODS_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["商号又は名称", "契約の相手方の商"]],
  ["address", ["住所"]],
  ["corporateNumber", ["法人番号"]],
  ["method", ["一般競争入札・", "指名競争入札の別"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、", "都道府県"]],
  ["bidderCount", ["応札・"]],
  ["notes", ["備考"]],
]);

const DISCRETIONARY_GOODS_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["方の商号", "契約の相手方の商号"]],
  ["address", ["の住所", "契約の相手方の住所"]],
  ["corporateNumber", ["法人番号"]],
  ["legalReason", ["随意契約によること", "とした会計法令の"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["reemployedOfficerCount", ["再就職", "再就職の役員"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、", "都道府県"]],
  ["bidderCount", ["応札・"]],
  ["notes", ["備考"]],
]);

const DISCRETIONARY_COLUMNS = Object.freeze([
  ["program", ["物品役務等の"]],
  ["officer", ["契約担当官等の"]],
  ["date", ["契約を締結"]],
  ["organization", ["方の商号", "契約の相手方の商号"]],
  ["corporateNumber", ["法人番号"]],
  ["address", ["の住所", "契約の相手方の住所"]],
  ["legalReason", ["随意契約によること", "とした会計法令の"]],
  ["plannedAmount", ["予定価格"]],
  ["amount", ["契約金額"]],
  ["awardRate", ["落札率"]],
  ["reemployedOfficerCount", ["再就職", "再就職の役員"]],
  ["notes", ["備考"]],
  ["publicInterestClass", ["公益法人"]],
  ["jurisdictionClass", ["国所管、", "都道府県"]],
  ["bidderCount", ["応札・"]],
]);

function grantDocument({ id, fiscalYear, period, rawUrl, originalUrl, expectedBytes, expectedSha256, expectedRowsPerPage, leftPoints }) {
  const expectedRecordCount = expectedRowsPerPage.reduce((a, b) => a + b, 0);
  const firstHalf = period === "4月～9月";
  const reiwa = fiscalYear - 2018;
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear,
    category: "grant_decision",
    kind: `補助金等の交付決定（${period}）`,
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    ...archiveFields({ rawUrl, originalUrl, expectedBytes, expectedSha256, expectedRecordCount }),
    coverageClaim: `WARP保存原本の令和${reiwa}年度${period}公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
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
      requiredFirstPageText: [`令和0${reiwa}年度補助金等の情報`, "中部経済産業局"],
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
        ? { start: `${fiscalYear}-04-01`, end: `${fiscalYear}-09-30` }
        : { start: `${fiscalYear}-10-01`, end: `${fiscalYear + 1}-03-31` },
      corporateNumberMissingSentinels: ["", "-", "－"],
      minimumPositionedTextItems: 1,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

function contractDocument({ id, fiscalYear, type, costClass, rawUrl, originalUrl, expectedBytes, expectedSha256, expectedRowsPerPage, leftPoints, cellAssignmentCoordinate, goodsLayout = false }) {
  const competitive = type === "competitive";
  const expectedRecordCount = expectedRowsPerPage.reduce((a, b) => a + b, 0);
  const definitions = goodsLayout
    ? (competitive ? COMPETITIVE_GOODS_COLUMNS : DISCRETIONARY_GOODS_COLUMNS)
    : (competitive ? COMPETITIVE_COLUMNS : DISCRETIONARY_COLUMNS);
  return Object.freeze({
    id,
    executorId: "chubu",
    executorName: "中部経済産業局",
    fiscalYear,
    category: "contract_result",
    kind: `${competitive ? "競争入札" : "随意契約"}（${costClass}）`,
    amountStage: "契約金額欄の掲載値",
    format: "pdf",
    ...archiveFields({ rawUrl, originalUrl, expectedBytes, expectedSha256, expectedRecordCount }),
    coverageClaim: `WARP保存原本の令和${fiscalYear - 2018}年度・${competitive ? "競争入札" : "随意契約"}（${costClass}）公式文字PDF全${expectedRowsPerPage.length}ページに掲載された${expectedRecordCount}行`,
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
      ...(cellAssignmentCoordinate ? { cellAssignmentCoordinate } : {}),
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
      dateRange: { start: `${fiscalYear}-04-01`, end: `${fiscalYear + 1}-03-31` },
      corporateNumberMissingSentinels: ["", "-", "－", "法人番号なし"],
      minimumPositionedTextItems: 1,
    }),
    evidenceReceipt: evidenceReceipt(expectedBytes, expectedSha256, expectedRecordCount),
  });
}

export const CHUBU_FY2021_GRANT_DOCUMENTS = Object.freeze([
  grantDocument({
    id: "chubu-2021-grant-decisions-h1", fiscalYear: 2021, period: "4月～9月",
    rawUrl: "https://warp.ndl.go.jp/20211212/20211201021011/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r3fy-4-9-hojyokin.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r3fy-4-9-hojyokin.pdf",
    expectedBytes: 314_303, expectedSha256: "8f74515a314f397c77242ea2501c618ea5a8de9c4fac7c69470d3c3c2ba382d2",
    expectedRowsPerPage: [26, 26, 27, 36, 26, 26, 26, 27],
    leftPoints: [70, 90, 250, 340, 405, 465, 535, 670, 725, 765],
  }),
  grantDocument({
    id: "chubu-2021-grant-decisions-h2", fiscalYear: 2021, period: "10月～3月",
    rawUrl: "https://warp.ndl.go.jp/20250606/20250601025638/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r3fy-10-3hojyokin.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r3fy-10-3hojyokin.pdf",
    expectedBytes: 127_520, expectedSha256: "976bc7d5858d0f22b745f082505ca3f9d2cc15d477d432aa0dc06bb3b53fe852",
    expectedRowsPerPage: [16],
    leftPoints: [70, 95, 250, 340, 405, 465, 535, 670, 725, 765],
  }),
]);

export const CHUBU_FY2020_GRANT_DOCUMENTS = Object.freeze([
  grantDocument({
    id: "chubu-2020-grant-decisions-h1", fiscalYear: 2020, period: "4月～9月",
    rawUrl: "https://warp.ndl.go.jp/20201212/20201201053139/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r2fy-4-9hojyokin.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r2fy-4-9hojyokin.pdf",
    expectedBytes: 325_292, expectedSha256: "6f4c4392da6313066d70bb0ed1b86eab483f8a052759ca40444aca48017cdefb",
    expectedRowsPerPage: [12, ...Array(15).fill(14), 4],
    leftPoints: [85, 105, 245, 375, 435, 480, 555, 665, 725, 765],
  }),
  grantDocument({
    id: "chubu-2020-grant-decisions-h2", fiscalYear: 2020, period: "10月～3月",
    rawUrl: "https://warp.ndl.go.jp/20210612/20210601041655/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r2fy-10-3-hojyokin.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r2fy-10-3-hojyokin.pdf",
    expectedBytes: 131_745, expectedSha256: "89cb6c80acd8ca42b8e3f596656187333acbffdfa193773c493404374eb3bdbf",
    expectedRowsPerPage: [14],
    leftPoints: [85, 110, 355, 445, 495, 545, 625, 705, 750, 780],
  }),
]);

export const CHUBU_FY2021_CONTRACT_DOCUMENTS = Object.freeze([
  contractDocument({ id: "chubu-2021-competitive-commission", fiscalYear: 2021, type: "competitive", costClass: "委託費の類",
    rawUrl: "https://warp.ndl.go.jp/20210912/20210901045012/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/21-nyusatsu-itaku.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/21-nyusatsu-itaku.pdf",
    expectedBytes: 85_399, expectedSha256: "8d5b6e0d9c76d693ef6cd271af281863310a342d5cafd3a814046742cbcb7fe9", expectedRowsPerPage: [5],
    leftPoints: [15, 85, 170, 225, 300, 365, 435, 515, 560, 605, 645, 670, 710, 755] }),
  contractDocument({ id: "chubu-2021-competitive-goods", fiscalYear: 2021, type: "competitive", costClass: "庁費の類",
    rawUrl: "https://warp.ndl.go.jp/20210712/20210701132403/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/21-ukeoi.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/21-ukeoi.pdf",
    expectedBytes: 158_781, expectedSha256: "511407e802d17c1c97a3f329a35044c32702cc431d4fa059ad1f9b7fbb90b676", expectedRowsPerPage: [7, 7, 3],
    leftPoints: [15, 85, 170, 230, 300, 355, 440, 495, 535, 580, 620, 650, 720, 775], goodsLayout: true }),
  contractDocument({ id: "chubu-2021-discretionary-commission", fiscalYear: 2021, type: "discretionary", costClass: "委託費の類",
    rawUrl: "https://warp.ndl.go.jp/20210814/20210803100756/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/21-zuikei-itaku.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/21-zuikei-itaku.pdf",
    expectedBytes: 99_943, expectedSha256: "dbbbe401b78759a909a210d8ec77a77cb958b70f60a3752615bfbd8d1d967a7b", expectedRowsPerPage: [9, 5, 2],
    leftPoints: [15, 75, 160, 220, 275, 325, 385, 500, 545, 595, 630, 665, 690, 725, 760] }),
  contractDocument({ id: "chubu-2021-discretionary-goods", fiscalYear: 2021, type: "discretionary", costClass: "庁費の類",
    rawUrl: "https://warp.ndl.go.jp/20210712/20210701132425/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/21-zuikei-ukeoi.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/21-zuikei-ukeoi.pdf",
    expectedBytes: 89_496, expectedSha256: "5d7ea669676854b03d64a7997165d6a09f733d7cb442ef7774310be5279a4320", expectedRowsPerPage: [6],
    leftPoints: [15, 65, 145, 195, 250, 305, 365, 510, 555, 600, 625, 660, 700, 740, 785], cellAssignmentCoordinate: "left", goodsLayout: true }),
]);

export const CHUBU_FY2020_CONTRACT_DOCUMENTS = Object.freeze([
  contractDocument({ id: "chubu-2020-competitive-commission", fiscalYear: 2020, type: "competitive", costClass: "委託費の類",
    rawUrl: "https://warp.ndl.go.jp/20201112/20201101052848/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/20-nyusatsu-itaku.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/20-nyusatsu-itaku.pdf",
    expectedBytes: 85_332, expectedSha256: "47ee4e14598237ad902e9543de8bc61f8c36a75ac0363bc53f56af0c26b75541", expectedRowsPerPage: [5],
    leftPoints: [20, 95, 185, 240, 315, 365, 435, 515, 560, 610, 650, 685, 730, 780] }),
  contractDocument({ id: "chubu-2020-competitive-goods", fiscalYear: 2020, type: "competitive", costClass: "庁費の類",
    rawUrl: "https://warp.ndl.go.jp/20200712/20200701044708/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/20-ukeoi.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/nyusatsu/20-ukeoi.pdf",
    expectedBytes: 109_410, expectedSha256: "4dd9ca42b2679a300a434652c47fe1dc32ca035ede88866da35f1fb7e9b0b7a8", expectedRowsPerPage: [7, 7, 2],
    leftPoints: [45, 105, 190, 245, 295, 360, 430, 485, 530, 575, 605, 645, 690, 745], cellAssignmentCoordinate: "left", goodsLayout: true }),
  contractDocument({ id: "chubu-2020-discretionary-commission", fiscalYear: 2020, type: "discretionary", costClass: "委託費の類",
    rawUrl: "https://warp.ndl.go.jp/20200712/20200701044749/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/20-zuikei-itaku.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/20-zuikei-itaku.pdf",
    expectedBytes: 123_824, expectedSha256: "0ec17811bf3db950f9d36ee8fc152f8114d48637cb62b13ef97808941e8c61c7", expectedRowsPerPage: [6, 6, 3],
    leftPoints: [15, 70, 140, 195, 245, 310, 375, 470, 525, 575, 615, 655, 685, 730, 780] }),
  contractDocument({ id: "chubu-2020-discretionary-goods", fiscalYear: 2020, type: "discretionary", costClass: "庁費の類",
    rawUrl: "https://warp.ndl.go.jp/20200712/20200701044753/https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/20-zuikei-ukeoi.pdf",
    originalUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/zuikei/20-zuikei-ukeoi.pdf",
    expectedBytes: 82_535, expectedSha256: "4f806028946552c3ff08a7ab0252f22fc6630f2cd481cacd000f86508361271b", expectedRowsPerPage: [5],
    leftPoints: [45, 95, 170, 215, 260, 310, 365, 500, 545, 580, 610, 640, 680, 715, 755], cellAssignmentCoordinate: "left", goodsLayout: true }),
]);
