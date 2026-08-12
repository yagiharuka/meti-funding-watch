/**
 * Official METI headquarters and Agency for Natural Resources and Energy
 * workbooks that can be parsed independently from G Biz INFO.
 *
 * The production list is intentionally fail-closed.  Pattern-derived URLs can
 * remain in the candidate inventory, but only official XLSX bytes with a
 * pinned receipt and a successful strict parse enter the updater.  Neither
 * list claims payment, downstream-recipient, or all-year coverage.
 */

import { readFileSync } from "node:fs";

const VERIFIED_AT = "2026-08-12";
const ARCHIVE_CAPTURE = "20260602/20260601000000";
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const EVIDENCE_MAP_URL = new URL("../data/official-meti-anre-evidence-map.json", import.meta.url);

const METI_EXECUTOR = Object.freeze({
  executorId: "meti",
  executorName: "経済産業省（本省）",
});

const ANRE_EXECUTOR = Object.freeze({
  executorId: "anre",
  executorName: "資源エネルギー庁",
});

const METI_CONTRACT_SERIES = Object.freeze([
  Object.freeze({ slug: "buppin_bid", id: "competitive-goods", kind: "競争入札（物品・役務等）" }),
  Object.freeze({ slug: "itaku_bid", id: "competitive-commission", kind: "競争入札（委託契約）" }),
  Object.freeze({ slug: "kouji_bid", id: "competitive-public-works", kind: "競争入札（公共工事）", publicWorks: true }),
  Object.freeze({ slug: "buppin_zuikei", id: "discretionary-goods", kind: "随意契約（物品・役務等）" }),
  Object.freeze({ slug: "itaku_zuikei", id: "discretionary-commission", kind: "随意契約（委託契約）" }),
  Object.freeze({ slug: "kouji_zuikei", id: "discretionary-public-works", kind: "随意契約（公共工事）", publicWorks: true }),
]);

const PUBLIC_WORKS_HEADER_ALIASES = Object.freeze({
  "契約の相手方の商号又は名称": Object.freeze(["契約の相手方の商号または名称"]),
});

const METI_2025_GRANT_H1_NON_RECORD_ROWS = Object.freeze([
  Object.freeze({
    sheetName: "補助金等の情報",
    rowNumber: 158,
    cells: Object.freeze([
      Object.freeze({
        column: 2,
        value: "（注）交付先名の公表により、機密情報の漏洩につながる恐れがあるため、非公表としている。",
      }),
    ]),
  }),
]);

const ANRE_2024_DISCRETIONARY_GOODS_04_NON_RECORD_ROWS = Object.freeze([
  Object.freeze({
    sheetName: "04月随契（物品等）",
    rowNumber: 4,
    cells: Object.freeze([
      Object.freeze({ column: 14, value: "公益法人の区分" }),
      Object.freeze({ column: 15, value: "国所管、\n都道府県\n所管の区分" }),
      Object.freeze({ column: 16, value: "応札・\n応募者数" }),
    ]),
  }),
]);

const METI_CONTRACT_SHEET_COUNTS = Object.freeze({
  2021: Object.freeze({ "competitive-public-works": 4, "discretionary-public-works": 3 }),
  2022: Object.freeze({ "competitive-public-works": 1, "discretionary-commission": 11, "discretionary-public-works": 1 }),
  2023: Object.freeze({ "competitive-public-works": 4, "discretionary-commission": 11, "discretionary-public-works": 2 }),
  2024: Object.freeze({ "competitive-public-works": 4, "discretionary-goods": 11, "discretionary-public-works": 3 }),
  2025: Object.freeze({ "discretionary-commission": 10 }),
});

function metiContractPage(fiscalYear) {
  const eraYear = fiscalYear - 2018;
  const filename = eraYear <= 4 ? `R${eraYear}Contract.html` : `r${eraYear}contract.html`;
  return `https://www.meti.go.jp/information_2/data/${filename}`;
}

function metiContractDocument(fiscalYear, series) {
  const eraYear = fiscalYear - 2018;
  // METI's historical files use upper-case R through FY2023; the FY2024+
  // files use lower-case r.  The path is case-sensitive and part of source
  // identity, so do not normalize it.
  const eraSlug = eraYear <= 5 ? `R${eraYear}` : `r${eraYear}`;
  return Object.freeze({
    ...METI_EXECUTOR,
    id: `meti-${fiscalYear}-${series.id}`,
    fiscalYear,
    category: "contract_result",
    kind: series.kind,
    amountStage: "契約金額欄の掲載値",
    sourcePageUrl: metiContractPage(fiscalYear),
    url: `https://www.meti.go.jp/information_2/downloadfiles/${series.slug}_${eraSlug}.xlsx`,
    format: "xlsx",
    discoveryStatus: "linked_from_live_year_page",
    coverageClaim: "本省の公式年度XLSXに掲載された直接契約行",
    expectedSheetCount: METI_CONTRACT_SHEET_COUNTS[fiscalYear]?.[series.id] ?? 12,
    multiplePartyPolicy: "one_official_row",
    verifiedAt: VERIFIED_AT,
    ...(series.publicWorks ? { headerAliases: PUBLIC_WORKS_HEADER_ALIASES } : {}),
  });
}

function metiGrantDocument(fiscalYear, half) {
  const calendarYear = String(fiscalYear).slice(-2);
  const nextCalendarYear = String(fiscalYear + 1).slice(-2);
  const firstHalf = half === "h1";
  const suffix = firstHalf ? `${calendarYear}04_${calendarYear}09` : `${calendarYear}10_${nextCalendarYear}03`;
  return Object.freeze({
    ...METI_EXECUTOR,
    id: `meti-${fiscalYear}-grant-decisions-${half}`,
    fiscalYear,
    category: "grant_decision",
    kind: `補助金等の交付決定（${firstHalf ? "4月～9月" : "10月～3月"}）`,
    amountStage: "交付決定額欄の掲載値",
    sourcePageUrl: "https://www.meti.go.jp/information_2/publicoffer/index_result_info.html",
    url: `https://www.meti.go.jp/information_2/downloadfiles/subs${suffix}.xlsx`,
    format: "xlsx",
    discoveryStatus: "linked_from_official_index",
    coverageClaim: "本省の公式半期XLSXに掲載された交付決定行",
    expectedSheetCount: 1,
    multiplePartyPolicy: "one_official_row",
    verifiedAt: VERIFIED_AT,
    ...(fiscalYear === 2025 && half === "h1"
      ? { expectedNonRecordRows: METI_2025_GRANT_H1_NON_RECORD_ROWS }
      : {}),
  });
}

export const METI_CANDIDATE_DOCUMENTS = Object.freeze([
  // The live METI index currently links FY2021 through FY2025 contract pages.
  ...[2021, 2022, 2023, 2024, 2025].flatMap((fiscalYear) =>
    METI_CONTRACT_SERIES.map((series) => metiContractDocument(fiscalYear, series))),
  // The live budget-execution page currently links FY2022 through FY2025.
  ...[2022, 2023, 2024, 2025].flatMap((fiscalYear) => [
    metiGrantDocument(fiscalYear, "h1"),
    metiGrantDocument(fiscalYear, "h2"),
  ]),
]);

const ANRE_CONTRACT_SERIES = Object.freeze([
  Object.freeze({
    directory: "ippankyousou_chouhi",
    id: "competitive-goods",
    kind: "一般競争（庁費）",
    monthsByYear: Object.freeze({
      2024: Object.freeze(["04", "06", "09"]),
      2025: Object.freeze(["04", "06", "11"]),
    }),
  }),
  Object.freeze({
    directory: "ippankyousou_itaku",
    id: "competitive-commission",
    kind: "一般競争（委託費）",
    monthsByYear: Object.freeze({
      2024: Object.freeze(["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02", "03"]),
      2025: Object.freeze(["04", "05", "06", "07", "08", "09", "10", "11", "12", "01", "02"]),
    }),
  }),
  Object.freeze({
    directory: "zuiikeiyaku_chouhi",
    id: "discretionary-goods",
    kind: "随意契約（庁費）",
    monthsByYear: Object.freeze({
      2024: Object.freeze(["04", "10"]),
      2025: Object.freeze(["10", "01", "02", "03"]),
    }),
  }),
  Object.freeze({
    directory: "zuiikeiyaku_itaku",
    id: "discretionary-commission",
    kind: "随意契約（委託費）",
    monthsByYear: Object.freeze({
      2024: Object.freeze(["04", "05", "06", "07", "08", "09", "12", "03"]),
      2025: Object.freeze(["04", "05", "06", "07", "08", "10", "11"]),
    }),
  }),
]);

function anreContractDocument(fiscalYear, series, month) {
  const base = `https://www.enecho.meti.go.jp/appli/conclusion/${series.directory}/${fiscalYear}`;
  const filename = fiscalYear === 2024 && series.id === "competitive-goods" && month === "06"
    ? "ippankyousou_chouhi_202406.xlsx"
    : fiscalYear === 2024 && series.id === "competitive-goods" && month === "09"
      ? "09ippannkyousou_chouhi_202409.xlsx"
      : fiscalYear === 2024 && series.id === "discretionary-goods" && month === "10"
        ? "zuiikeiyaku_cyouhi_202410.xlsx"
        : `${month}.xlsx`;
  return Object.freeze({
    ...ANRE_EXECUTOR,
    id: `anre-${fiscalYear}-${series.id}-${month}`,
    fiscalYear,
    category: "contract_result",
    kind: `${series.kind}（${Number(month)}月公表分）`,
    amountStage: "契約金額欄の掲載値",
    sourcePageUrl: `${base}/`,
    url: `${base}/${filename}`,
    format: "xlsx",
    discoveryStatus: "linked_from_live_year_page",
    coverageClaim: "資源エネルギー庁の公式月別XLSXに掲載された直接契約行",
    expectedSheetCount: 1,
    multiplePartyPolicy: "one_official_row",
    verifiedAt: VERIFIED_AT,
    ...(fiscalYear === 2024 && series.id === "discretionary-goods" && month === "04"
      ? { expectedNonRecordRows: ANRE_2024_DISCRETIONARY_GOODS_04_NON_RECORD_ROWS }
      : {}),
  });
}

function anreGrantDocument(fiscalYear, half) {
  const firstHalf = half === "h1";
  const base = `https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/${fiscalYear}`;
  // The FY2023 files use a hyphen between months; later files use an underscore.
  const halfSlug = fiscalYear === 2023
    ? (firstHalf ? "4-9" : "10-3")
    : fiscalYear === 2024 && !firstHalf
      ? "10-3"
      : (firstHalf ? "4_9" : "10_3");
  return Object.freeze({
    ...ANRE_EXECUTOR,
    id: `anre-${fiscalYear}-grant-decisions-${half}`,
    fiscalYear,
    category: "grant_decision",
    kind: `補助金等の交付決定（${firstHalf ? "4月～9月" : "10月～3月"}）`,
    amountStage: "交付決定額欄の掲載値",
    sourcePageUrl: `${base}/`,
    url: `${base}/${fiscalYear}_${halfSlug}.xlsx`,
    format: "xlsx",
    discoveryStatus: "linked_from_live_year_page",
    coverageClaim: "資源エネルギー庁の公式半期XLSXに掲載された交付決定行",
    expectedSheetCount: 1,
    multiplePartyPolicy: "one_official_row",
    verifiedAt: VERIFIED_AT,
  });
}

export const ANRE_CANDIDATE_DOCUMENTS = Object.freeze([
  // FY2024 and FY2025 are fully enumerated from their live category pages.
  // Months whose official index says "該当なし" are intentionally absent.
  ...[2024, 2025].flatMap((fiscalYear) => ANRE_CONTRACT_SERIES.flatMap((series) =>
    series.monthsByYear[fiscalYear].map((month) => anreContractDocument(fiscalYear, series, month)))),
  // FY2023 contract pages have retired, but both official grant workbooks and
  // their official year page remain live and independently discoverable.
  ...[2023, 2024, 2025].flatMap((fiscalYear) => [
    anreGrantDocument(fiscalYear, "h1"),
    anreGrantDocument(fiscalYear, "h2"),
  ]),
]);

export const METI_ANRE_CANDIDATE_DOCUMENTS = Object.freeze([
  ...METI_CANDIDATE_DOCUMENTS,
  ...ANRE_CANDIDATE_DOCUMENTS,
]);

// Receipts were generated from the official response bytes available during
// schema verification.  They are evidence, not a promise that the live host
// will keep returning identical mutable files.
export const METI_ANRE_SCHEMA_RECEIPTS = Object.freeze({
  "meti-2025-competitive-goods": Object.freeze({
    magic: "504b0304",
    bytes: 83_765,
    sha256: "ae9ffe497bf22964ea09cc0594f26af5738e4e06c59a2fdfa03c38bed8d8d4b0",
    records: 130,
  }),
  "meti-2025-competitive-commission": Object.freeze({
    magic: "504b0304",
    bytes: 102_816,
    sha256: "02e0bd45a7493b95cc3cfde96d37b79fe5019859d4749baa429d7077a6f94c46",
    records: 310,
  }),
  "meti-2025-competitive-public-works": Object.freeze({
    magic: "504b0304",
    bytes: 56_675,
    sha256: "5c92f5a17f4e94ca938c42496024c40b3b37fe3348acea7a78df554dcd896a45",
    records: 4,
  }),
  "meti-2025-grant-decisions-h2": Object.freeze({
    magic: "504b0304",
    bytes: 28_915,
    sha256: "48c233adbc17beb3fde3b0c56ec5537d09d944ffb8a51bd7a3d0caf1ade0be76",
    records: 54,
  }),
  "anre-2025-competitive-commission-04": Object.freeze({
    magic: "504b0304",
    bytes: 29_315,
    sha256: "f7ee0e9fe191707400abfbbc56ec560d28edefa5305926b06db204e8945b1c9a",
    records: 56,
  }),
  "anre-2025-grant-decisions-h2": Object.freeze({
    magic: "504b0304",
    bytes: 174_750,
    sha256: "d368c4bfc416f8118feef89044726a7b55db305d3fb1ce158c5aea6194091111",
    records: 949,
  }),
});

const rawEvidenceMap = JSON.parse(readFileSync(EVIDENCE_MAP_URL, "utf8"));
validateEvidenceMap(rawEvidenceMap, METI_ANRE_CANDIDATE_DOCUMENTS);
export const METI_ANRE_EVIDENCE_METADATA = Object.freeze({
  schemaVersion: rawEvidenceMap.schemaVersion,
  verifiedAt: rawEvidenceMap.verifiedAt,
  verification: rawEvidenceMap.verification,
  capture: rawEvidenceMap.capture,
});
export const METI_ANRE_ARCHIVE_RECEIPTS = Object.freeze(rawEvidenceMap.records.map((record) => Object.freeze({ ...record })));

const candidateById = new Map(METI_ANRE_CANDIDATE_DOCUMENTS.map((document) => [document.id, document]));
const verifiedDocument = (id) => {
  const document = candidateById.get(id);
  if (!document) throw new Error(`${id}: 検証済み資料に対応する候補定義がありません`);
  const evidenceReceipt = METI_ANRE_SCHEMA_RECEIPTS[id];
  if (!evidenceReceipt) throw new Error(`${id}: 実バイトと厳密parseのreceiptがありません`);
  return Object.freeze({
    ...document,
    discoveryStatus: "full_get_and_strict_parse_verified",
    evidenceReceipt: Object.freeze({
      expectedMagic: evidenceReceipt.magic,
      expectedBytes: evidenceReceipt.bytes,
      expectedSha256: evidenceReceipt.sha256,
      expectedRecordCount: evidenceReceipt.records,
    }),
  });
};

// Production registers only workbooks whose exact response bytes and strict
// parser result were inspected.  Pattern-derived candidates stay outside the
// updater until they receive the same evidence.
export const METI_OFFICIAL_DOCUMENTS = Object.freeze([
  verifiedDocument("meti-2025-competitive-goods"),
  verifiedDocument("meti-2025-competitive-commission"),
  verifiedDocument("meti-2025-competitive-public-works"),
  verifiedDocument("meti-2025-grant-decisions-h2"),
]);

export const ANRE_OFFICIAL_DOCUMENTS = Object.freeze([
  verifiedDocument("anre-2025-competitive-commission-04"),
  verifiedDocument("anre-2025-grant-decisions-h2"),
]);

export const METI_ANRE_OFFICIAL_DOCUMENTS = Object.freeze([
  ...METI_OFFICIAL_DOCUMENTS,
  ...ANRE_OFFICIAL_DOCUMENTS,
  ...METI_ANRE_ARCHIVE_RECEIPTS.map((receipt) => {
    const document = candidateById.get(receipt.id);
    return Object.freeze({
      ...document,
      url: receipt.url,
      originalUrl: receipt.originalUrl,
      discoveryStatus: "archived_official_file",
      archiveProvider: ARCHIVE_PROVIDER,
      archiveVerifiedAt: METI_ANRE_EVIDENCE_METADATA.verifiedAt,
      archiveVerification: METI_ANRE_EVIDENCE_METADATA.verification,
      archiveExpectedBytes: receipt.expectedBytes,
      archiveExpectedSha256: receipt.expectedSha256,
      archiveExpectedRecordCount: receipt.expectedRecordCount,
      evidenceReceipt: Object.freeze({
        expectedMagic: "504b0304",
        expectedBytes: receipt.expectedBytes,
        expectedSha256: receipt.expectedSha256,
        expectedRecordCount: receipt.expectedRecordCount,
      }),
    });
  }),
]);

export const METI_ANRE_UNVERIFIED_CANDIDATES = Object.freeze(
  METI_ANRE_CANDIDATE_DOCUMENTS.filter((document) =>
    !METI_ANRE_SCHEMA_RECEIPTS[document.id]
    && !METI_ANRE_ARCHIVE_RECEIPTS.some((receipt) => receipt.id === document.id)),
);

export const METI_ANRE_REGISTRY_GAPS = Object.freeze([
  "経済産業省本省のFY2020契約結果",
  "経済産業省本省のFY2020・FY2021補助金等交付決定",
  "資源エネルギー庁のFY2020～FY2023月別契約結果",
  "資源エネルギー庁のFY2020～FY2022補助金等交付決定",
  "FY2026は年度途中で、本省・資源エネルギー庁の全公表系列を検証できていないため未登録",
]);

function validateEvidenceMap(value, documents) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本省・資源エネルギー庁evidence mapがオブジェクトではありません");
  const exactTopKeys = ["capture", "records", "schemaVersion", "verification", "verifiedAt"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactTopKeys)) throw new Error("本省・資源エネルギー庁evidence mapのキーが不正です");
  if (value.schemaVersion !== 1 || value.verifiedAt !== VERIFIED_AT || value.capture !== ARCHIVE_CAPTURE
    || typeof value.verification !== "string" || !value.verification.includes("Full GET") || !value.verification.includes("strict parser")) {
    throw new Error("本省・資源エネルギー庁evidence mapの検証メタデータが不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== 88) throw new Error("本省・資源エネルギー庁evidence receiptは88資料でなければなりません");
  const definitions = new Map(documents.map((document) => [document.id, document]));
  const ids = new Set();
  let recordCount = 0;
  for (const receipt of value.records) {
    const exactReceiptKeys = ["expectedBytes", "expectedRecordCount", "expectedSha256", "id", "originalUrl", "sourcePageUrl", "url"];
    if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exactReceiptKeys)) throw new Error(`${receipt?.id ?? "(なし)"}: evidence receiptのキーが不正です`);
    const document = definitions.get(receipt.id);
    if (!document || ids.has(receipt.id) || receipt.originalUrl !== document.url || receipt.sourcePageUrl !== document.sourcePageUrl
      || receipt.url !== `https://warp.ndl.go.jp/${ARCHIVE_CAPTURE}/${receipt.originalUrl}`) {
      throw new Error(`${receipt.id}: evidence receiptの資料定義または公式URLが不正です`);
    }
    ids.add(receipt.id);
    if (!Number.isSafeInteger(receipt.expectedBytes) || receipt.expectedBytes < 500 || receipt.expectedBytes > 10_000_000
      || typeof receipt.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.expectedSha256)
      || !Number.isSafeInteger(receipt.expectedRecordCount) || receipt.expectedRecordCount < 1) {
      throw new Error(`${receipt.id}: evidence receiptのbytes/SHA/recordCountが不正です`);
    }
    recordCount += receipt.expectedRecordCount;
  }
  if (recordCount !== 7_163) throw new Error(`本省・資源エネルギー庁evidence receiptの明細数が不正です: ${recordCount}`);
  for (const excludedId of [
    ...Object.keys(METI_ANRE_SCHEMA_RECEIPTS),
  ]) {
    if (ids.has(excludedId)) throw new Error(`${excludedId}: 新規archive receiptへ重複または未検証資料が混入しています`);
  }
}
