import { createHash } from "node:crypto";

import ExcelJS from "exceljs";

const OKINAWA_GRANT_INDEX = "https://www.ogb.go.jp/keisan/3842/saitaku/f_03/014671";
const OKINAWA_CONTRACT_INDEX = "https://www.ogb.go.jp/soumu/soumu_tyouta.html";
const OKINAWA_GRANT_BASE = "https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/";

const TABLE_COLUMNS = Object.freeze([
  { key: "ordinal", leftRatio: 0.03, headerAliases: ["番号"] },
  { key: "program", leftRatio: 0.055, headerAliases: ["事業名"] },
  { key: "organization", leftRatio: 0.25, headerAliases: ["交付先"] },
  { key: "amount", leftRatio: 0.38, headerAliases: ["交付決定額"] },
  { key: "account", leftRatio: 0.448, headerAliases: ["支出元会計区分"] },
  { key: "budgetItem", leftRatio: 0.57, headerAliases: ["支出元（目）名称"] },
  { key: "date", leftRatio: 0.75, headerAliases: ["交付決定日"] },
  { key: "publicInterestClass", leftRatio: 0.84, headerAliases: ["公益法人の区分", "公益法人の区"] },
  { key: "jurisdictionClass", leftRatio: 0.89, headerAliases: ["国所管、都道府", "国所管、都道"] },
]);

const RECEIPTS = Object.freeze({
  "2020-first": { bytes: 108326, sha256: "c182f5cf85254d2424747f91cd69d7a3c88a893373fb49e0537b2dc5a654cd5d", pages: 2, rowsPerPage: [17, 11], items: 273 },
  "2020-second": { bytes: 53923, sha256: "dc24e2fff65eaded675c7aba2b7ffd578c44fc172f62003adadc66e633a5bb96", pages: 1, rowsPerPage: [5], items: 72 },
  "2021-first": { bytes: 110618, sha256: "74971b12885357a571388830d94db67468689ed1a17103d9d6ba28adaa9f4c4e", pages: 2, rowsPerPage: [17, 14], items: 299 },
  "2021-second": { bytes: 63004, sha256: "7f55f283f65afc032aefca9117df4909fff3d24d2d40e653e72f0a2f39ac4a26", pages: 1, rowsPerPage: [6], items: 81 },
  "2022-first": { bytes: 104738, sha256: "b79cd33aa2bf522a1e2f5ad37a8a357495568b6184d06d41760a9dc4bef97a4c", pages: 2, rowsPerPage: [17, 8], items: 250 },
  "2022-second": { bytes: 64538, sha256: "32e3590adc88633dd2e3552941741ab73b33e390018cc53de2fd189806f284df", pages: 1, rowsPerPage: [7], items: 91 },
  "2023-first": { bytes: 117264, sha256: "5e1ed7c256f4f57f9db8322e1c6a9992f9c1f55ded9b2f809172bba7eda57182", pages: 2, rowsPerPage: [18, 15], items: 339 },
  "2023-second": { bytes: 64242, sha256: "562de00f1a444a5c52ff29871d7e7f7d1f3ad00663e94dbd4ec47a43ceb9b596", pages: 1, rowsPerPage: [4], items: 69, blankRowsPerPage: [[5, 6, 7, 8, 9, 10]] },
  "2024-first": { bytes: 123539, sha256: "f3fe7a90bcaebede65918f5a4b78fe0cdd076e06459450f112b79c87217b1282", pages: 3, rowsPerPage: [17, 18, 15], items: 504 },
  "2024-second": { bytes: 64198, sha256: "9b398d26392853946c6ffe00ecc9e8754a3f9a6e1ec0b9769575a3c27ce2b815", pages: 1, rowsPerPage: [5], items: 69 },
});

function reiwaYear(fiscalYear) {
  return fiscalYear - 2018;
}

function grantUrl(fiscalYear, half) {
  const reiwa = reiwaYear(fiscalYear);
  const relative = fiscalYear === 2024 && half === "second"
    ? `250514_01/R${reiwa}FY_secondhojokin.pdf`
    : `hojyokin/R${reiwa}FY_${half}hojokin.pdf`;
  return new URL(relative, OKINAWA_GRANT_BASE).href;
}

function grantDocument(fiscalYear, half) {
  const receipt = RECEIPTS[`${fiscalYear}-${half}`];
  const first = half === "first";
  const recordCount = receipt.rowsPerPage.reduce((sum, count) => sum + count, 0);
  return Object.freeze({
    id: `okinawa-${fiscalYear}-grant-decisions-${first ? "h1" : "h2"}`,
    executorId: "okinawa",
    executorName: "沖縄総合事務局（経済産業部）",
    fiscalYear,
    category: "grant_decision",
    kind: `補助金等の交付決定（${first ? "4月～9月" : "10月～3月"}）`,
    amountStage: "交付決定額欄の掲載値",
    format: "pdf",
    discoveryStatus: "linked_from_official_economic_industry_index_and_byte_pinned",
    verifiedAt: "2026-08-12",
    sourcePageUrl: OKINAWA_GRANT_INDEX,
    url: grantUrl(fiscalYear, half),
    coverageClaim: `令和${reiwaYear(fiscalYear)}年度${first ? "上期" : "下期"}の文字PDF全${receipt.pages}ページに掲載された${recordCount}行（原資料に法人番号欄なし）`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      expectedBytes: receipt.bytes,
      expectedSha256: receipt.sha256,
      expectedPageCount: receipt.pages,
      expectedPageSize: { width: 841.68, height: 595.2, tolerance: 0.2 },
      expectedRowsPerPage: receipt.rowsPerPage,
      expectedRecordCount: recordCount,
      expectedRowNumbers: { start: 1, end: recordCount },
      ...(receipt.blankRowsPerPage ? { expectedBlankRowsPerPage: receipt.blankRowsPerPage } : {}),
      bodyMinimumYRatio: 0.04,
      cellAssignmentCoordinate: "left",
      requiredPageText: [`令和${reiwaYear(fiscalYear)}年度補助金等の情報`, "沖縄総合事務局経済産業部"],
      requiredFirstPageText: [],
      columns: TABLE_COLUMNS,
      recordMapping: {
        ordinalColumn: "ordinal",
        programColumn: "program",
        organizationColumn: "organization",
        amountColumn: "amount",
        dateColumn: "date",
        notesColumns: ["account", "budgetItem"],
      },
      crossColumnSplitRules: [
        { id: "date-public-interest", kind: "date_then_text", fromColumn: "date", toColumn: "publicInterestClass", expectedMatches: recordCount },
      ],
      corporateNumberOmitted: true,
      allowedDateFormats: ["reiwa_ymd_ja"],
      dateRange: first
        ? { start: `${fiscalYear}-04-01`, end: `${fiscalYear}-09-30` }
        : { start: `${fiscalYear}-10-01`, end: `${fiscalYear + 1}-03-31` },
      minimumPositionedTextItems: receipt.items,
      expectedPositionedTextItemCount: receipt.items + recordCount,
    }),
    evidenceReceipt: Object.freeze({
      expectedMagic: "%PDF-",
      expectedBytes: receipt.bytes,
      expectedSha256: receipt.sha256,
      expectedRecordCount: recordCount,
    }),
  });
}

export const OKINAWA_GRANT_DOCUMENTS = Object.freeze(
  [2020, 2021, 2022, 2023, 2024].flatMap((fiscalYear) => [
    grantDocument(fiscalYear, "first"),
    grantDocument(fiscalYear, "second"),
  ]),
);

// These are exact observations of the linked whole-bureau workbooks. They are
// audit evidence, not production sources: their row-level contracting officer
// field never identifies the Economic Industry Department, so title keywords
// or presumed beneficiaries are not accepted as a department classifier.
export const OKINAWA_CONTRACT_SOURCE_AUDIT = Object.freeze([
  {
    officialIndexLabel: "令和4年度",
    url: "https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan1/kouhyou0331.xlsx",
    expectedBytes: 59335,
    expectedSha256: "3086a74788802391c7af1eaf2da2b2a80b41f08ac7d6bd5576948075b4666703",
    expectedWorkbookRows: 235,
    observedFiscalYears: [2022],
    economicIndustryDepartmentOfficerRows: 0,
    status: "excluded_whole_bureau_unattributable",
  },
  {
    officialIndexLabel: "令和5年度",
    url: "https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan2/01kouhyou0415.xlsx",
    expectedBytes: 59788,
    expectedSha256: "9b5a93755059640f39dabf341f037636edd4ac73cc62762f03fee5b3e796f6f7",
    expectedWorkbookRows: 200,
    observedFiscalYears: [2023],
    economicIndustryDepartmentOfficerRows: 0,
    status: "excluded_whole_bureau_unattributable",
  },
  {
    officialIndexLabel: "令和6年度",
    url: "https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan1/kouhyou0331-e.xlsx",
    expectedBytes: 61744,
    expectedSha256: "cf88069d4ce507687b3a99372776bf7f4fe1e47c9dfaf573edfe8f619d716ef2",
    expectedWorkbookRows: 220,
    observedFiscalYears: [2024],
    economicIndustryDepartmentOfficerRows: 0,
    status: "excluded_whole_bureau_unattributable",
  },
  {
    officialIndexLabel: "令和7年度",
    url: "https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/shinsa/xlsxkouhyouR80607.xlsx",
    expectedBytes: 44883,
    expectedSha256: "98a0cc6359b0f8d8e2cd719bb3a0c07590c33c1745cdace02dc0fe40a91f949e",
    expectedWorkbookRows: 137,
    observedFiscalYears: [2026],
    economicIndustryDepartmentOfficerRows: 0,
    status: "excluded_index_label_content_year_mismatch_and_unattributable",
  },
].map((entry) => Object.freeze({ ...entry, sourcePageUrl: OKINAWA_CONTRACT_INDEX })));

export const OKINAWA_COVERAGE_GAPS = Object.freeze([
  Object.freeze({
    executorId: "okinawa",
    category: "grant_decision",
    status: "official_index_through_fy2024",
    included: "公式索引にリンクされたFY2020～FY2024の上期・下期PDF（計194掲載行）",
    missing: "FY2025以降の統合交付決定資料（2026-08-12時点で公式索引にリンクなし）",
  }),
  Object.freeze({
    executorId: "okinawa",
    category: "contract_result",
    status: "not_ingested_unattributable",
    included: "なし",
    missing: "総合事務局全体XLSXから経済産業部を識別する公式の行単位項目がなく、共通調達の配賦もないため未収録",
  }),
]);

const EXPECTED_CONTRACT_SHEETS = Object.freeze([
  "工事競争（様式2-１）",
  "工事随契（様式2-2）",
  "物品役務競争（様式2-3）",
  "物品役務随契（様式2-４）",
]);

/**
 * Verify the whole-bureau contract workbook and the absence of a row-level
 * Economic Industry Department classifier. This is an exclusion audit only;
 * it intentionally emits no searchable funding records.
 */
export async function auditOkinawaContractWorkbook(buffer, source) {
  if (!OKINAWA_CONTRACT_SOURCE_AUDIT.includes(source)) throw new Error("未登録または変更された沖縄契約監査資料です");
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`${source.officialIndexLabel}: XLSXのZIPシグネチャがありません`);
  }
  if (buffer.length !== source.expectedBytes) throw new Error(`${source.officialIndexLabel}: 契約XLSXのバイト数がreceiptと一致しません`);
  if (createHash("sha256").update(buffer).digest("hex") !== source.expectedSha256) {
    throw new Error(`${source.officialIndexLabel}: 契約XLSXのSHA-256がreceiptと一致しません`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (JSON.stringify(workbook.worksheets.map((worksheet) => worksheet.name)) !== JSON.stringify(EXPECTED_CONTRACT_SHEETS)) {
    throw new Error(`${source.officialIndexLabel}: 契約XLSXの4公表区分が検証済み構成と一致しません`);
  }
  let rows = 0;
  let economicIndustryDepartmentOfficerRows = 0;
  const observedFiscalYears = new Set();
  for (const worksheet of workbook.worksheets) {
    const header = findContractHeader(worksheet, source);
    for (let rowNumber = header + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const title = contractCellText(row.getCell(1).value);
      const officer = contractCellText(row.getCell(2).value);
      const date = excelContractDate(row.getCell(3).value);
      if (!date) continue;
      if (!title || !officer || !contractCellText(row.getCell(4).value)) {
        throw new Error(`${source.officialIndexLabel}/${worksheet.name}/${rowNumber}: 契約明細の必須値が空です`);
      }
      rows += 1;
      observedFiscalYears.add(date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1);
      if (/経済産業部/.test(officer)) economicIndustryDepartmentOfficerRows += 1;
    }
  }
  const years = [...observedFiscalYears].sort((a, b) => a - b);
  if (rows !== source.expectedWorkbookRows
    || JSON.stringify(years) !== JSON.stringify(source.observedFiscalYears)
    || economicIndustryDepartmentOfficerRows !== source.economicIndustryDepartmentOfficerRows) {
    throw new Error(`${source.officialIndexLabel}: 契約XLSXの明細数・年度・経済産業部識別結果がreceiptと一致しません`);
  }
  return Object.freeze({
    rows,
    observedFiscalYears: Object.freeze(years),
    economicIndustryDepartmentOfficerRows,
    attributableRows: 0,
    commonProcurementAllocationAvailable: false,
  });
}

function findContractHeader(worksheet, source) {
  for (const rowNumber of [3, 4]) {
    const row = worksheet.getRow(rowNumber);
    const values = [1, 2, 3, 4, 5, 6, 8].map((column) => normalizeContractHeader(row.getCell(column).value));
    if (/^(?:公共工事の名称場所期間及び種別|物品役務等の名称及び数量)$/.test(values[0])
      && values[1] === "契約担当官等の氏名並びにその所属する部局の名称及び所在地"
      && values[2] === "契約締結日"
      && /^契約相手方の商号又は名称及び住所$/.test(values[3])
      && values[4] === "法人番号"
      && /^(?:一般競争入札指名競争入札の別総合評価の実施|随意契約によることとした会計法令の根拠条文及び理由企画競争又は公募)$/.test(values[5])
      && values[6] === "契約金額") return rowNumber;
  }
  throw new Error(`${source.officialIndexLabel}/${worksheet.name}: 契約XLSXの必須見出しを検証できません`);
}

function contractCellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return String(value.text ?? value.result ?? "");
  return String(value).replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim();
}

function normalizeContractHeader(value) {
  return contractCellText(value).replace(/[\s　・、,，.。:：;；()（）/／・-]/g, "");
}

function excelContractDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 30_000 || value > 70_000) return null;
  const date = new Date(Math.round((value - 25_569) * 86_400_000));
  return Number.isNaN(date.getTime()) ? null : date;
}
