/**
 * Official METI headquarters and Agency for Natural Resources and Energy
 * workbooks that can be parsed independently from G Biz INFO.
 *
 * The production list is intentionally fail-closed.  Pattern-derived URLs can
 * remain in the candidate inventory, but only official XLSX bytes with a
 * pinned receipt and a successful strict parse enter the updater.  Neither
 * list claims payment, downstream-recipient, or all-year coverage.
 */

const VERIFIED_AT = "2026-08-12";

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
    expectedSheetCount: 12,
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
  return Object.freeze({
    ...ANRE_EXECUTOR,
    id: `anre-${fiscalYear}-${series.id}-${month}`,
    fiscalYear,
    category: "contract_result",
    kind: `${series.kind}（${Number(month)}月公表分）`,
    amountStage: "契約金額欄の掲載値",
    sourcePageUrl: `${base}/`,
    url: `${base}/${month}.xlsx`,
    format: "xlsx",
    discoveryStatus: "linked_from_live_year_page",
    coverageClaim: "資源エネルギー庁の公式月別XLSXに掲載された直接契約行",
    expectedSheetCount: 1,
    multiplePartyPolicy: "one_official_row",
    verifiedAt: VERIFIED_AT,
  });
}

function anreGrantDocument(fiscalYear, half) {
  const firstHalf = half === "h1";
  const base = `https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/${fiscalYear}`;
  // The FY2023 files use a hyphen between months; later files use an underscore.
  const halfSlug = fiscalYear === 2023
    ? (firstHalf ? "4-9" : "10-3")
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
]);

export const METI_ANRE_UNVERIFIED_CANDIDATES = Object.freeze(
  METI_ANRE_CANDIDATE_DOCUMENTS.filter((document) => !METI_ANRE_SCHEMA_RECEIPTS[document.id]),
);

export const METI_ANRE_REGISTRY_GAPS = Object.freeze([
  "候補URL94資料のうち、実バイトと厳密parse receiptが未検証の88資料",
  "経済産業省本省のFY2020契約結果",
  "経済産業省本省のFY2020・FY2021補助金等交付決定",
  "資源エネルギー庁のFY2020～FY2023月別契約結果",
  "資源エネルギー庁のFY2020～FY2022補助金等交付決定",
  "FY2026は年度途中で、本省・資源エネルギー庁の全公表系列を検証できていないため未登録",
]);
