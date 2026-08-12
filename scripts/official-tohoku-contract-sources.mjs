import receipt from "../evidence/tohoku-2025-contracts/receipt.json" with { type: "json" };

const SOURCE_PAGE_URL = "https://www.tohoku.meti.go.jp/kaikei/keiyaku/keiyaku.html";
const WARP_PREFIX = "https://warp.ndl.go.jp/20260613/20260601111544/";
const WARP_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";

const COMPETITIVE_COLUMNS = Object.freeze([
  ["program", "物品役務等の"],
  ["officer", "契約担当官等の"],
  ["date", "契約を締結"],
  ["organization", "商号又は名称"],
  ["corporateNumber", "法人番号"],
  ["address", "住所"],
  ["competitionMethod", "一般競争入札・"],
  ["plannedAmount", "予定価格"],
  ["amount", "契約金額"],
  ["bidRate", "落札率"],
  ["contractMethod", "契約方式"],
  ["notes", "備考"],
  ["publicInterestClass", null],
  ["jurisdictionClass", null],
  ["applicantCount", "応札・"],
]);

const DISCRETIONARY_COLUMNS = Object.freeze([
  ["program", "物品役務等の"],
  ["officer", "契約担当官等の"],
  ["date", "契約を締結"],
  ["organization", "商号又は名称"],
  ["corporateNumber", "法人番号"],
  ["address", "住所"],
  ["legalReason", "随意契約によることとした"],
  ["plannedAmount", "予定価格"],
  ["amount", "契約金額"],
  ["bidRate", "落札率"],
  ["retiredOfficerCount", "再就職の"],
  ["contractMethod", "契約方式"],
  ["notes", "備考"],
  ["publicInterestClass", null],
  ["jurisdictionClass", null],
  ["applicantCount", "応札・"],
]);

function makeColumns(item) {
  const definitions = item.method === "competitive" ? COMPETITIVE_COLUMNS : DISCRETIONARY_COLUMNS;
  if (item.headerAnchors.length !== definitions.length) {
    throw new Error(`${item.id}: 東北契約PDFの列アンカー数が不正です`);
  }
  return definitions.map(([key, defaultAlias], index) => ({
    key,
    headerAliases: [key === "publicInterestClass"
      ? item.publicInterestHeader
      : key === "jurisdictionClass" ? item.jurisdictionHeader : defaultAlias],
    leftRatio: key === "date"
      ? item.headerAnchors[index] - 0.015
      : key === "organization"
        ? item.headerAnchors[index - 1] + 0.015
        : key === "address"
          ? item.headerAnchors[index - 1] + 0.015
      : index === 0
        ? Math.max(0, item.headerAnchors[0] - (item.headerAnchors[1] - item.headerAnchors[0]) / 2)
        : (item.headerAnchors[index - 1] + item.headerAnchors[index]) / 2,
  }));
}

function makeDocument(item) {
  const originalUrl = `${SOURCE_PAGE_URL.replace("keiyaku.html", "pdf/2025/")}${item.file}`;
  const methodLabel = item.method === "competitive" ? "競争入札" : "随意契約";
  const kindLabel = item.kind === "goods" ? "物品役務等" : "委託費";
  const notesColumns = item.method === "competitive"
    ? ["competitionMethod", "contractMethod", "notes"]
    : ["legalReason", "contractMethod", "notes"];
  return Object.freeze({
    id: item.id,
    executorId: "tohoku",
    executorName: "東北経済産業局",
    fiscalYear: 2025,
    category: "contract_result",
    kind: `${methodLabel}（${kindLabel}）`,
    amountStage: "契約金額欄の掲載値",
    format: "pdf",
    discoveryStatus: "archived_official_file",
    verifiedAt: receipt.verifiedAt,
    sourcePageUrl: SOURCE_PAGE_URL,
    originalUrl,
    url: `${WARP_PREFIX}${originalUrl}`,
    archiveProvider: WARP_PROVIDER,
    archiveVerifiedAt: receipt.verifiedAt,
    archiveVerification: "WARP保存済み公式目次の実hrefから公式PDF原本をFull GETし、PDF magic・byte数・SHA-256・ページ数・契約日行を照合",
    archiveExpectedBytes: item.bytes,
    archiveExpectedSha256: item.sha256,
    archiveExpectedRecordCount: item.rows,
    coverageClaim: `令和7年度${methodLabel}（${kindLabel}）第${item.sequence}掲載PDF全${item.pages}ページの${item.rows}行`,
    pdfSchema: Object.freeze({
      schemaVersion: 1,
      extractionMode: "positioned_text_only",
      normalizeCompatibilityText: true,
      expectedBytes: item.bytes,
      expectedSha256: item.sha256,
      expectedPageCount: item.pages,
      expectedPageSize: Object.freeze(item.pageSize),
      expectedRowsPerPage: Object.freeze(item.rowsPerPage),
      expectedRecordCount: item.rows,
      expectedRowNumbers: Object.freeze({ start: 1, end: item.rows }),
      recordGranularity: "date_anchor_rows",
      joinDateAnchorFragments: item.id === "tohoku-2025-discretionary-commission-1",
      headersOnFirstPageOnly: item.pages > 1,
      requiredPageText: Object.freeze([]),
      requiredFirstPageText: Object.freeze([
        `${methodLabel}に係る情報の公表（${kindLabel === "物品役務等" ? "庁費" : "委託費"}の類）`,
        "東北経済産業局",
      ]),
      columns: Object.freeze(makeColumns(item).map(Object.freeze)),
      recordMapping: Object.freeze({
        programColumn: "program",
        organizationColumn: "organization",
        corporateNumberColumn: "corporateNumber",
        amountColumn: "amount",
        dateColumn: "date",
        notesColumns: Object.freeze(notesColumns),
      }),
      allowedDateFormats: Object.freeze(["western_ymd_ja"]),
      dateRange: Object.freeze({ start: "2025-04-01", end: "2026-03-31" }),
      corporateNumberMissingSentinels: Object.freeze(["法人番号なし", "-", "－"]),
      amountMissingSentinels: Object.freeze(["-", "－", "非公表"]),
      minimumPositionedTextItems: item.positionedTextItems,
      expectedPositionedTextItemCount: item.positionedTextItems,
    }),
  });
}

export const TOHOKU_2025_CONTRACT_INDEX_RECEIPT = Object.freeze(receipt.index);
export const TOHOKU_2025_CONTRACT_TOTALS = Object.freeze(receipt.totals);

// 第1競争委託PDFは既存公開定義を維持する。定義SHAを暗黙に変更せず、
// 追加17資料だけをこの固定receiptから生成する。
export const TOHOKU_2025_ADDITIONAL_CONTRACT_DOCUMENTS = Object.freeze(receipt.documents
  .filter((item) => item.id !== "tohoku-2025-competitive-commission-1")
  .map(makeDocument));
