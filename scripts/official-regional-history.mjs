import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EVIDENCE_MAP_URL = new URL("../data/official-regional-evidence-map.json", import.meta.url);
const ARCHIVE_EVIDENCE_MAP_URL = new URL("../data/official-regional-archive-evidence-map.json", import.meta.url);
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const ARCHIVE_CAPTURE = "20260602/20260601000000";

const CHUGOKU_CONTRACTS_INDEX = "https://www.chugoku.meti.go.jp/nyusatu/koukyouchoutatu-tekisei.html";
const CHUGOKU_GRANTS_INDEX = "https://www.chugoku.meti.go.jp/nyusatu/hojyokinkofu.html";
const HOKKAIDO_CONTRACTS_INDEX = "https://www.hkd.meti.go.jp/information/koubo/chotatsu/teiketsu.htm";
const HOKKAIDO_GRANTS_INDEX = "https://www.hkd.meti.go.jp/information/koubo/hojokin/koufuichiran.htm";
const SHIKOKU_CONTRACTS_INDEX = "https://www.shikoku.meti.go.jp/02_soshikiinfos/keiyaku_index.html";
const SHIKOKU_GRANTS_INDEX = "https://www.shikoku.meti.go.jp/02_soshikiinfos/hojokin_index.html";

const contract = (executor, fiscalYear, series, path, options = {}) => Object.freeze({
  id: `${executor.id}-${fiscalYear}-${series.id}${options.suffix ? `-${options.suffix}` : ""}`,
  executorId: executor.id,
  executorName: executor.name,
  fiscalYear,
  category: "contract_result",
  kind: series.kind,
  amountStage: "契約金額欄の掲載値",
  sourcePageUrl: executor.contractsIndex,
  url: new URL(path, executor.baseUrl).href,
  coverageClaim: options.coverageClaim ?? (fiscalYear === 2026
    ? "年度途中の公式資料に掲載された契約結果行（FY2026は未完了）"
    : "公式資料に掲載された契約結果行"),
  ...options.document,
});

const grant = (executor, fiscalYear, path, options = {}) => Object.freeze({
  id: `${executor.id}-${fiscalYear}-grant-decisions${options.suffix ? `-${options.suffix}` : ""}`,
  executorId: executor.id,
  executorName: executor.name,
  fiscalYear,
  category: "grant_decision",
  kind: options.kind ?? "補助金等の交付決定",
  amountStage: "交付決定額欄の掲載値",
  sourcePageUrl: executor.grantsIndex,
  url: new URL(path, executor.baseUrl).href,
  coverageClaim: options.coverageClaim ?? "公式資料に掲載された補助金等の交付決定行",
  ...options.document,
});

const CHUGOKU = Object.freeze({
  id: "chugoku",
  name: "中国経済産業局",
  baseUrl: "https://www.chugoku.meti.go.jp/",
  contractsIndex: CHUGOKU_CONTRACTS_INDEX,
  grantsIndex: CHUGOKU_GRANTS_INDEX,
});
const HOKKAIDO = Object.freeze({
  id: "hokkaido",
  name: "北海道経済産業局",
  baseUrl: "https://www.hkd.meti.go.jp/",
  contractsIndex: HOKKAIDO_CONTRACTS_INDEX,
  grantsIndex: HOKKAIDO_GRANTS_INDEX,
});
const SHIKOKU = Object.freeze({
  id: "shikoku",
  name: "四国経済産業局",
  baseUrl: "https://www.shikoku.meti.go.jp/",
  contractsIndex: SHIKOKU_CONTRACTS_INDEX,
  grantsIndex: SHIKOKU_GRANTS_INDEX,
});

const CONTRACT_SERIES = Object.freeze({
  competitiveGoods: Object.freeze({ id: "competitive-goods", kind: "競争入札（物品・役務等）" }),
  competitiveCommission: Object.freeze({ id: "competitive-commission", kind: "競争入札（委託契約）" }),
  competitiveWorks: Object.freeze({ id: "competitive-public-works", kind: "競争入札（公共工事）" }),
  discretionaryGoods: Object.freeze({ id: "discretionary-goods", kind: "随意契約（物品・役務等）" }),
  discretionaryCommission: Object.freeze({ id: "discretionary-commission", kind: "随意契約（委託契約）" }),
  discretionaryWorks: Object.freeze({ id: "discretionary-public-works", kind: "随意契約（公共工事）" }),
});

const CHUGOKU_CONTRACT_PATHS = Object.freeze({
  2026: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0804_r0806buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0804_r0806itaku.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0804_r0806buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0804_r0806itaku.xlsx",
  },
  2025: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0704_r0802buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0704_r0802itaku.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0704_r0712buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0704_r0802itaku.xlsx",
  },
  2024: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0604_r703buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0604_10itaku.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0604_07buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0604_10itaku.xlsx",
  },
  2023: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0504_r0603buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0504_09itaku.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0504_06buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0504_12itaku.xlsx",
    discretionaryWorks: "nyusatu/file/zuii/r0504_r0602koukyoukouji.xlsx",
  },
  2022: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0404_r0503buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0404_r0503itaku.xlsx",
    competitiveWorks: "nyusatu/file/ippan_kyoso/r0404_r0503koukyou.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0404_06buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0404_r0503itaku.xlsx",
  },
  2021: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0304_r0403buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0304_r0403itaku.xlsx",
    competitiveWorks: "nyusatu/file/ippan_kyoso/r0304_10kouji.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0304_10buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0304_10itaku.xlsx",
  },
  2020: {
    competitiveGoods: "nyusatu/file/ippan_kyoso/r0204_r0303buppin.xlsx",
    competitiveCommission: "nyusatu/file/ippan_kyoso/r0204_r0303itaku.xlsx",
    discretionaryGoods: "nyusatu/file/zuii/r0204_r0303buppin.xlsx",
    discretionaryCommission: "nyusatu/file/zuii/r0204_r0303itaku.xlsx",
  },
});

const CHUGOKU_GRANT_PATHS = Object.freeze({
  2025: ["r0704_r0709kofukettei.xlsx", "r0710_r0803kofukettei.xlsx"],
  2024: ["r0604_r0609kofukettei.xlsx", "r0610_r0703kofukettei.xlsx"],
  2023: ["r0504_r0603kofukettei.xlsx"],
  2022: ["r4_04-12_kofukettei.xlsx"],
  2021: ["r3_04-12_kofukettei.xlsx"],
  2020: ["r2_04-06_kofukettei.xlsx", "r2_07-09_kofukettei.xlsx", "r2_10-12_kofukettei.xlsx"],
});

export const CHUGOKU_DOCUMENTS = Object.freeze([
  ...Object.entries(CHUGOKU_CONTRACT_PATHS).flatMap(([year, paths]) => Object.entries(paths).map(([series, path]) =>
    contract(CHUGOKU, Number(year), CONTRACT_SERIES[series], path),
  )),
  ...Object.entries(CHUGOKU_GRANT_PATHS).flatMap(([year, paths]) => paths.map((path, index) =>
    grant(CHUGOKU, Number(year), `nyusatu/file/hojyokinkofu/${path}`, {
      suffix: paths.length > 1 ? `part-${index + 1}` : "",
      coverageClaim: Number(year) <= 2022
        ? "公式目次に残る期間の補助金等交付決定行（FY2020は4月～12月、FY2021・FY2022は4月～12月）"
        : "公式資料に掲載された補助金等の交付決定行",
    }),
  )),
]);

const REGIONAL_HTML_BASE = Object.freeze({
  format: "html",
  parser: "regional_html",
  discoveryStatus: "linked_from_official_index",
});
const HTML_CONTRACT_COLUMNS_14 = Object.freeze({
  program: 0, date: 2, organization: 3, corporateNumber: 4, method: 6, amount: 8, notes: 10,
});
const HTML_CONTRACT_COLUMNS_15 = Object.freeze({
  program: 0, date: 2, organization: 3, corporateNumber: 4, method: 6, amount: 8, notes: 11,
});
const HTML_GRANT_COLUMNS_10 = Object.freeze({
  program: 1, organization: 2, corporateNumber: 3, amount: 4, date: 7, notes: [5, 6],
});

function regionalHtmlDocument({ expectedColumnCount, columns, headingTokens, period = null }) {
  return {
    ...REGIONAL_HTML_BASE,
    expectedColumnCount,
    columns,
    headingTokens,
    ...(period ? { period } : {}),
  };
}

const HOKKAIDO_CONTRACT_PATHS = Object.freeze({
  2026: ["kyoso/buppin", "kyoso/itaku", "zuii/buppin", "zuii/itaku"],
  2025: ["kyoso/buppin", "kyoso/itaku", "zuii/buppin", "zuii/itaku"],
  2024: ["kyoso/buppin", "kyoso/itaku", "kyoso/koji", "zuii/buppin", "zuii/itaku"],
  2023: ["kyoso/buppin", "kyoso/itaku", "zuii/buppin", "zuii/itaku"],
});
const HOKKAIDO_SERIES = Object.freeze({
  "kyoso/buppin": CONTRACT_SERIES.competitiveGoods,
  "kyoso/itaku": CONTRACT_SERIES.competitiveCommission,
  "kyoso/koji": CONTRACT_SERIES.competitiveWorks,
  "zuii/buppin": CONTRACT_SERIES.discretionaryGoods,
  "zuii/itaku": CONTRACT_SERIES.discretionaryCommission,
});

export const HOKKAIDO_DOCUMENTS = Object.freeze([
  ...Object.entries(HOKKAIDO_CONTRACT_PATHS).flatMap(([year, seriesPaths]) => seriesPaths.map((seriesPath) => {
    const [method, type] = seriesPath.split("/");
    const legacyCompetitive = Number(year) === 2023 && method === "kyoso";
    return contract(HOKKAIDO, Number(year), HOKKAIDO_SERIES[seriesPath], `hoksa/keiyaku_ichiran/${year}fy_${method}/${type}.htm`, {
      document: regionalHtmlDocument({
        expectedColumnCount: legacyCompetitive ? 14 : 15,
        columns: legacyCompetitive ? HTML_CONTRACT_COLUMNS_14 : HTML_CONTRACT_COLUMNS_15,
        headingTokens: [year, method === "kyoso" ? "競争" : "随意", type === "itaku" ? "委託" : type === "koji" ? "公共工事" : "物品"],
      }),
    });
  })),
  ...[2022, 2023, 2024, 2025].map((year) => grant(HOKKAIDO, year, `hoksa/koufu_ichiran/fy${year}.htm`, {
    document: regionalHtmlDocument({
      expectedColumnCount: 10,
      columns: HTML_GRANT_COLUMNS_10,
      headingTokens: [year, "補助金等", "情報開示"],
    }),
  })),
]);

const SHIKOKU_CONTRACT_PATHS = Object.freeze({
  competitiveGoods: [202604, 202606, 202504, 202507, 202510, 202512, 202404, 202406, 202407, 202409, 202501, 202502, 202304, 202307, 202308, 202310, 202312, 202204, 202207, 202209, 202301, 202302, 202104, 202107, 202108, 202109, 202103],
  competitiveCommission: [202507, 202408, 202410, 202307, 202308, 202309, 202208, 202209, 202211, 202108, 202109, 202110, 202112],
  discretionaryGoods: [202404, 202304, 202204, 202104, 202004],
  discretionaryCommission: [202604, 202605, 202504, 202505, 202506, 202507, 202404, 202405, 202407, 202408, 202304, 202305, 202306, 202204, 202205, 202206, 202208, 202104, 202105, 202106, 202107, 202109, 202110, 202004, 202005, 202006, 202008],
});
const SHIKOKU_PATH_PREFIX = Object.freeze({
  competitiveGoods: "n_u",
  competitiveCommission: "n_i",
  discretionaryGoods: "z_u",
  discretionaryCommission: "z_i",
});

function fiscalYearFromYearMonth(yearMonth) {
  const year = Math.floor(yearMonth / 100);
  const month = yearMonth % 100;
  if (!Number.isInteger(year) || month < 1 || month > 12) throw new Error(`invalid year-month: ${yearMonth}`);
  return month >= 4 ? year : year - 1;
}

export const SHIKOKU_DOCUMENTS = Object.freeze([
  ...Object.entries(SHIKOKU_CONTRACT_PATHS).flatMap(([series, yearMonths]) => yearMonths.map((yearMonth) => {
    const fiscalYear = fiscalYearFromYearMonth(yearMonth);
    const prefix = SHIKOKU_PATH_PREFIX[series];
    const month = String(yearMonth).slice(4);
    const isDiscretionary = series.startsWith("discretionary");
    const hasContractMethodColumn = series === "competitiveGoods" && yearMonth === 202510;
    return contract(SHIKOKU, fiscalYear, CONTRACT_SERIES[series], `02_soshikiinfos/04_kaikei/01_keiyaku_${prefix}_${yearMonth}/${prefix}_${yearMonth}.html`, {
      suffix: String(yearMonth),
      coverageClaim: fiscalYear === 2026
        ? "年度途中の公式目次にリンクされた月の契約結果行（FY2026は未完了、リンクのない月を0件とはみなしません）"
        : "公式目次にリンクされた月の契約結果行（リンクのない月を0件とはみなしません）",
      document: regionalHtmlDocument({
        expectedColumnCount: isDiscretionary || hasContractMethodColumn ? 15 : 14,
        columns: isDiscretionary || hasContractMethodColumn ? HTML_CONTRACT_COLUMNS_15 : HTML_CONTRACT_COLUMNS_14,
        headingTokens: ["契約締結状況", isDiscretionary ? "随意契約" : "競争入札", series.endsWith("Commission") ? "委託契約" : "請負契約", `${fiscalYear - 2018}年度${Number(month)}月`],
        period: `${String(yearMonth).slice(0, 4)}-${month}`,
      }),
    });
  })),
  ...[
    [2025, "202504_202509", "h1"], [2025, "202510_202603", "h2"],
    [2024, "202404_202409", "h1"], [2024, "202410_202503", "h2"],
    [2023, "202304_202309", "h1"], [2023, "202310_202403", "h2"],
    [2022, "202204-202209", "h1"], [2022, "202210_202303", "h2"],
    [2021, "202104-202109", "h1"], [2021, "202110-202203", "h2"],
    [2020, "202004-202009", "h1"], [2020, "202010-202103", "h2"],
  ].map(([fiscalYear, slug, half]) => grant(SHIKOKU, fiscalYear, `02_soshikiinfos/04_kaikei/02_hojokin_${slug}/${slug}.html`, {
    suffix: half,
    kind: `補助金等の交付決定（${half === "h1" ? "4月～9月" : "10月～3月"}）`,
    document: regionalHtmlDocument({
      expectedColumnCount: 10,
      columns: HTML_GRANT_COLUMNS_10,
      headingTokens: ["補助金", "情報開示", `令和${fiscalYear - 2018}年`],
    }),
  })),
]);

const ALL_REGIONAL_DOCUMENTS = Object.freeze([
  ...CHUGOKU_DOCUMENTS,
  ...HOKKAIDO_DOCUMENTS,
  ...SHIKOKU_DOCUMENTS,
]);

const rawEvidenceMap = JSON.parse(readFileSync(EVIDENCE_MAP_URL, "utf8"));
validateEvidenceMap(rawEvidenceMap, ALL_REGIONAL_DOCUMENTS);
const rawArchiveEvidenceMap = JSON.parse(readFileSync(ARCHIVE_EVIDENCE_MAP_URL, "utf8"));
validateArchiveEvidenceMap(rawArchiveEvidenceMap, ALL_REGIONAL_DOCUMENTS, rawEvidenceMap.records);
export const REGIONAL_EVIDENCE_METADATA = Object.freeze({
  schemaVersion: rawEvidenceMap.schemaVersion,
  verifiedAt: rawEvidenceMap.verifiedAt,
  verification: rawEvidenceMap.verification,
});
export const REGIONAL_EVIDENCE_RECEIPTS = Object.freeze(rawEvidenceMap.records.map((record) => Object.freeze({ ...record })));
export const REGIONAL_ARCHIVE_EVIDENCE_METADATA = Object.freeze({
  schemaVersion: rawArchiveEvidenceMap.schemaVersion,
  verifiedAt: rawArchiveEvidenceMap.verifiedAt,
  capture: rawArchiveEvidenceMap.capture,
  verification: rawArchiveEvidenceMap.verification,
});
export const REGIONAL_ARCHIVE_EVIDENCE_RECEIPTS = Object.freeze(rawArchiveEvidenceMap.records.map((record) => Object.freeze({ ...record })));
const VERIFIED_REGIONAL_IDS = new Set([
  ...REGIONAL_EVIDENCE_RECEIPTS.map((record) => record.id),
  ...REGIONAL_ARCHIVE_EVIDENCE_RECEIPTS.map((record) => record.id),
]);

// Only the documents whose exact response and strict-parser result have a
// committed evidence receipt are eligible for production ingestion. The rest
// remain explicit audit candidates, never silently counted as attempted or
// searchable in the public manifest.
const evidenceReceiptById = new Map(REGIONAL_EVIDENCE_RECEIPTS.map((receipt) => [receipt.id, receipt]));
export const REGIONAL_OFFICIAL_DOCUMENTS = Object.freeze(
  [
    ...ALL_REGIONAL_DOCUMENTS
      .filter((document) => evidenceReceiptById.has(document.id))
    .map((document) => Object.freeze({
      ...document,
      evidenceReceipt: Object.freeze({
        expectedMagic: document.format === "html" ? "html" : "504b0304",
        expectedBytes: evidenceReceiptById.get(document.id).expectedBytes,
        expectedSha256: evidenceReceiptById.get(document.id).expectedSha256,
        expectedRecordCount: evidenceReceiptById.get(document.id).expectedRecordCount,
      }),
    })),
    ...REGIONAL_ARCHIVE_EVIDENCE_RECEIPTS.map((receipt) => {
      const document = ALL_REGIONAL_DOCUMENTS.find((candidate) => candidate.id === receipt.id);
      return Object.freeze({
        ...document,
        url: receipt.url,
        originalUrl: receipt.originalUrl,
        discoveryStatus: "archived_official_file",
        archiveProvider: ARCHIVE_PROVIDER,
        archiveVerifiedAt: REGIONAL_ARCHIVE_EVIDENCE_METADATA.verifiedAt,
        archiveVerification: REGIONAL_ARCHIVE_EVIDENCE_METADATA.verification,
        archiveExpectedBytes: receipt.expectedBytes,
        archiveExpectedSha256: receipt.expectedSha256,
        archiveExpectedRecordCount: receipt.expectedRecordCount,
        evidenceReceipt: Object.freeze({
          expectedMagic: document.format === "html" ? "html" : "504b0304",
          expectedBytes: receipt.expectedBytes,
          expectedSha256: receipt.expectedSha256,
          expectedRecordCount: receipt.expectedRecordCount,
        }),
      });
    }),
  ],
);
export const REGIONAL_CANDIDATE_DOCUMENTS = Object.freeze(
  ALL_REGIONAL_DOCUMENTS.filter((document) => !VERIFIED_REGIONAL_IDS.has(document.id)),
);
export const REGIONAL_DOCUMENTS = Object.freeze([
  ...REGIONAL_OFFICIAL_DOCUMENTS,
  ...REGIONAL_CANDIDATE_DOCUMENTS,
]);

function validateEvidenceMap(value, documents) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("地域局evidence mapがオブジェクトではありません");
  if (value.schemaVersion !== 1 || typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)) {
    throw new Error("地域局evidence mapのschemaまたは検証日が不正です");
  }
  if (typeof value.verification !== "string" || !value.verification.includes("Full GET") || !value.verification.includes("strict parser")) {
    throw new Error("地域局evidence mapの検証方法が不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== 20) throw new Error("地域局evidence receiptは20資料でなければなりません");
  const definitions = new Map(documents.map((document) => [document.id, document]));
  const ids = new Set();
  for (const receipt of value.records) {
    const keys = Object.keys(receipt).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["expectedBytes", "expectedRecordCount", "expectedSha256", "id", "url"])) {
      throw new Error(`地域局evidence receiptのキーが不正です: ${receipt?.id ?? "(なし)"}`);
    }
    const document = definitions.get(receipt.id);
    if (!document || ids.has(receipt.id) || receipt.url !== document.url) {
      throw new Error(`地域局evidence receiptの資料IDまたはURLが不正です: ${receipt.id}`);
    }
    ids.add(receipt.id);
    if (!Number.isSafeInteger(receipt.expectedBytes) || receipt.expectedBytes < 500 || receipt.expectedBytes > 10_000_000
      || typeof receipt.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.expectedSha256)
      || !Number.isSafeInteger(receipt.expectedRecordCount) || receipt.expectedRecordCount < 1) {
      throw new Error(`地域局evidence receiptのbytes/SHA/recordCountが不正です: ${receipt.id}`);
    }
  }
}

function validateArchiveEvidenceMap(value, documents, directReceipts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("地域局archive evidence mapがオブジェクトではありません");
  const exactTopKeys = ["capture", "records", "schemaVersion", "verification", "verifiedAt"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactTopKeys)
    || value.schemaVersion !== 1 || value.verifiedAt !== "2026-08-12" || value.capture !== ARCHIVE_CAPTURE
    || typeof value.verification !== "string" || !value.verification.includes("Full GET") || !value.verification.includes("strict parser")) {
    throw new Error("地域局archive evidence mapの検証メタデータが不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== 95) throw new Error("地域局archive evidence receiptは95資料でなければなりません");
  const definitions = new Map(documents.map((document) => [document.id, document]));
  const directIds = new Set(directReceipts.map((receipt) => receipt.id));
  const ids = new Set();
  let recordCount = 0;
  for (const receipt of value.records) {
    const exactReceiptKeys = ["expectedBytes", "expectedRecordCount", "expectedSha256", "id", "originalUrl", "sourcePageUrl", "url"];
    if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exactReceiptKeys)) throw new Error(`${receipt?.id ?? "(なし)"}: 地域局archive evidence receiptのキーが不正です`);
    const document = definitions.get(receipt.id);
    if (!document || ids.has(receipt.id) || directIds.has(receipt.id)
      || receipt.originalUrl !== document.url || receipt.sourcePageUrl !== document.sourcePageUrl
      || receipt.url !== `https://warp.ndl.go.jp/${ARCHIVE_CAPTURE}/${receipt.originalUrl}`) {
      throw new Error(`${receipt.id}: 地域局archive evidence receiptの資料定義または公式URLが不正です`);
    }
    ids.add(receipt.id);
    if (!Number.isSafeInteger(receipt.expectedBytes) || receipt.expectedBytes < 500 || receipt.expectedBytes > 10_000_000
      || typeof receipt.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.expectedSha256)
      || !Number.isSafeInteger(receipt.expectedRecordCount) || receipt.expectedRecordCount < 1) {
      throw new Error(`${receipt.id}: 地域局archive evidence receiptのbytes/SHA/recordCountが不正です`);
    }
    recordCount += receipt.expectedRecordCount;
  }
  if (recordCount !== 1_589) throw new Error(`地域局archive evidence receiptの明細数が不正です: ${recordCount}`);
}

export function parseRegionalOfficialHtml(buffer, document) {
  validateRegionalHtmlDocument(document);
  const html = decodeOfficialHtml(buffer, document);
  const heading = extractHeading(html, document);
  for (const token of document.headingTokens) {
    if (!normalizeText(heading).includes(normalizeText(token))) {
      throw new Error(`${document.id}: 見出しが資料定義と一致しません (${token})`);
    }
  }
  assertMappedColumnHeaders(html, document);
  const dataRows = extractDataRows(html, document);
  if (!dataRows.length) throw new Error(`${document.id}: 検索可能な明細が0行です`);
  const identityOccurrences = new Map();
  return dataRows.map((cells, index) => makeRegionalRecord(cells, index + 1, document, identityOccurrences));
}

const MAPPED_HEADER_ALIASES = Object.freeze({
  contract_result: Object.freeze({
    program: ["物品役務等の名称及び数量", "公共工事の名称場所期間及び種別"],
    date: ["契約を締結した日"],
    organization: ["契約の相手方の商号又は名称"],
    corporateNumber: ["契約の相手方の法人番号"],
    method: ["一般競争入札指名競争入札の別総合評価の実施", "随意契約によることとした会計法令の根拠条文及び理由企画競争又は公募"],
    amount: ["契約金額円"],
    notes: ["備考"],
  }),
  grant_decision: Object.freeze({
    program: ["事業名"],
    organization: ["交付先名", "補助金交付先名"],
    corporateNumber: ["法人番号"],
    amount: ["交付決定額", "交付決定額単位円"],
    date: ["交付決定日"],
  }),
});

function assertMappedColumnHeaders(html, document) {
  const candidates = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    if (!/<th\b/i.test(match[1])) continue;
    const cells = extractCells(match[1], "th").map((cell) => normalizeHeader(cell.text));
    if (cells.some((cell) => MAPPED_HEADER_ALIASES[document.category].program.map(normalizeHeader).includes(cell))) {
      candidates.push(cells);
    }
  }
  if (!candidates.length) throw new Error(`${document.id}: 主表見出し行を特定できません`);
  const headers = candidates[0];
  if (candidates.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(headers))) {
    throw new Error(`${document.id}: 同一資料内で主表見出しが変化しています`);
  }
  if (headers.length !== document.expectedColumnCount) {
    throw new Error(`${document.id}: 主表見出しの列数が一致しません (${headers.length}/${document.expectedColumnCount})`);
  }
  for (const [field, aliases] of Object.entries(MAPPED_HEADER_ALIASES[document.category])) {
    const index = document.columns[field];
    if (Array.isArray(index) || index === undefined) continue;
    if (!aliases.map(normalizeHeader).includes(headers[index])) {
      throw new Error(`${document.id}: ${field}列の見出しが資料定義と一致しません: ${headers[index] || "(空)"}`);
    }
  }
}

function validateRegionalHtmlDocument(document) {
  const isRegisteredIdentity = ALL_REGIONAL_DOCUMENTS.includes(document) || REGIONAL_OFFICIAL_DOCUMENTS.includes(document);
  if (!isRegisteredIdentity || document.parser !== "regional_html" || document.format !== "html") {
    throw new Error("未登録または変更された地域経済産業局HTML資料です");
  }
  if (![10, 14, 15].includes(document.expectedColumnCount)) throw new Error(`${document.id}: 列数定義が不正です`);
  const indices = Object.values(document.columns).flat();
  if (!indices.every((value) => Number.isInteger(value) && value >= 0 && value < document.expectedColumnCount)) {
    throw new Error(`${document.id}: 列位置定義が不正です`);
  }
}

function decodeOfficialHtml(value, document) {
  const buffer = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null;
  if (!buffer || buffer.length < 500) throw new Error(`${document.id}: HTML応答が空または短すぎます`);
  const header = buffer.subarray(0, Math.min(buffer.length, 16_384)).toString("latin1");
  const declared = header.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([A-Za-z0-9._-]+)/i)?.[1]?.toLowerCase()
    ?? header.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9._-]+)/i)?.[1]?.toLowerCase();
  const encoding = ["utf-8", "utf8"].includes(declared)
    ? "utf-8"
    : ["shift_jis", "shift-jis", "sjis", "x-sjis", "windows-31j", "cp932"].includes(declared)
      ? "shift_jis"
      : null;
  if (!encoding) throw new Error(`${document.id}: HTML文字コードが未宣言または未対応です: ${declared ?? "(未宣言)"}`);
  let html;
  try {
    html = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${document.id}: HTMLを${encoding}として厳密に復号できません`);
  }
  if (!/<!doctype\s+html|<html\b/i.test(html)) throw new Error(`${document.id}: HTML文書シグネチャがありません`);
  if (/指定されたページまたはファイルは存在しません|Please Enable JavaScript|captcha-form|awsWaf|challenge-container|verify that you(?:'|’)re not a robot/i.test(html)) {
    throw new Error(`${document.id}: HTMLがエラーまたはWAF応答です`);
  }
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
}

function extractHeading(html, document) {
  const headings = [];
  const pattern = /<(title|h[12])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const value = normalizeText(stripTags(match[2]));
    if (value) headings.push(value);
  }
  const value = headings.join("／");
  if (!value) throw new Error(`${document.id}: h1またはtitle見出しがありません`);
  return value;
}

function extractDataRows(html, document) {
  const rows = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi;
  let tableMatch;
  while ((tableMatch = tablePattern.exec(html)) !== null) {
    const pending = new Map();
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(tableMatch[1])) !== null) {
      const rawCells = extractRowCells(rowMatch[1], document);
      if (!rawCells.length) continue;
      const cells = [];
      for (const [column, span] of [...pending]) {
        cells[column] = span.cell;
        span.remaining -= 1;
        if (span.remaining === 0) pending.delete(column);
      }
      let column = 0;
      for (const cell of rawCells) {
        while (cells[column]) column += 1;
        for (let offset = 0; offset < cell.colspan; offset += 1) {
          if (cells[column + offset]) throw new Error(`${document.id}: rowspan/colspanが衝突しています`);
          cells[column + offset] = cell;
          if (cell.rowspan > 1) pending.set(column + offset, { cell, remaining: cell.rowspan - 1 });
        }
        column += cell.colspan;
      }
      const values = cells.map((cell) => cell?.text ?? "");
      if (rawCells.every((cell) => cell.tag === "th")) continue;
      if (rawCells.some((cell) => cell.tag === "th")) throw new Error(`${document.id}: 明細行にthとtdが混在しています`);
      if (!values.length || values.every((value) => !value)) continue;
      if (values.length !== document.expectedColumnCount || values.some((_, index) => !cells[index])) {
        if (looksLikeOfficialDataRow(values, document)) {
          throw new Error(`${document.id}: 明細行の列数が一致しません (${values.length}/${document.expectedColumnCount})`);
        }
        continue;
      }
      rows.push(values);
    }
    if (pending.size) throw new Error(`${document.id}: rowspanが表の末尾を越えています`);
  }
  return rows;
}

function extractRowCells(html, document) {
  const pattern = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  const cells = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    cells.push({
      tag: match[1].toLowerCase(),
      text: normalizeText(stripTags(match[3])),
      colspan: parseTableSpan(match[2], "colspan", document),
      rowspan: parseTableSpan(match[2], "rowspan", document),
    });
  }
  return cells;
}

function parseTableSpan(attributes, name, document) {
  const raw = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i"))?.[1];
  if (!raw) return 1;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error(`${document.id}: ${name}が不正です: ${raw}`);
  return value;
}

function looksLikeOfficialDataRow(cells, document) {
  const program = cells[document.columns.program] ?? "";
  const date = cells[document.columns.date] ?? "";
  return Boolean(program && (parseOfficialDate(date) || /契約|補助|事業|調査|業務/.test(program)));
}

function extractCells(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}\\s*>`, "gi");
  const cells = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const colspanRaw = match[1].match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1";
    const colspan = Number(colspanRaw);
    if (!Number.isSafeInteger(colspan) || colspan < 1 || colspan > 20) throw new Error(`表のcolspanが不正です: ${colspanRaw}`);
    const text = normalizeText(stripTags(match[2]));
    for (let index = 0; index < colspan; index += 1) cells.push({ text });
  }
  return cells;
}

function makeRegionalRecord(cells, ordinal, document, identityOccurrences) {
  const at = (field) => {
    const column = document.columns[field];
    if (Array.isArray(column)) return column.map((index) => cells[index]).filter(Boolean).join("／");
    return cells[column] ?? "";
  };
  const values = {
    title: at("program"),
    organization: at("organization"),
    corporateNumberRaw: at("corporateNumber"),
    amountRaw: at("amount"),
    dateRaw: at("date"),
    methodRaw: document.category === "contract_result" ? at("method") : "補助金等の交付決定",
    notes: at("notes"),
  };
  for (const field of ["title", "organization", "dateRaw", "amountRaw"]) {
    if (!values[field]) throw new Error(`${document.id}: ${ordinal}行目の必須値${field}が空です`);
  }
  const date = parseOfficialDate(values.dateRaw);
  if (!date) throw new Error(`${document.id}: 日付を解釈できません: ${values.dateRaw}`);
  if (fiscalYearOfDate(date) !== document.fiscalYear) throw new Error(`${document.id}: 日付が資料年度外です: ${values.dateRaw}`);
  if (document.period && !date.startsWith(document.period)) throw new Error(`${document.id}: 月別資料と契約日が一致しません: ${values.dateRaw}`);
  const corporateNumber = normalizeCorporateNumber(values.corporateNumberRaw);
  const amount = parseAmount(values.amountRaw);
  const identitySourceUrl = regionalSourceIdentityUrl(document);
  const identityHash = createHash("sha256").update(JSON.stringify([
    identitySourceUrl, document.category, values.dateRaw, values.organization, values.corporateNumberRaw, values.title, values.amountRaw,
  ])).digest("hex").slice(0, 24);
  const occurrence = (identityOccurrences.get(identityHash) ?? 0) + 1;
  identityOccurrences.set(identityHash, occurrence);
  return {
    sourceKey: `${document.id}:${identityHash}:${occurrence}`,
    datasetId: document.id,
    category: document.category,
    kind: document.kind,
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    sourceOrdinal: ordinal,
    sourceRowNumber: ordinal,
    sourcePeriodRaw: document.period ?? `FY${document.fiscalYear}`,
    title: values.title,
    organization: values.organization,
    corporateNumber,
    corporateNumberRaw: values.corporateNumberRaw,
    date,
    dateRaw: values.dateRaw,
    amount,
    amountRaw: values.amountRaw,
    methodRaw: values.methodRaw,
    notes: values.notes,
    sourceUrl: document.url,
  };
}

export function regionalSourceIdentityUrl(document) {
  return document?.originalUrl ?? document?.url ?? null;
}

function stripTags(value) {
  return decodeEntities(String(value ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}

function decodeEntities(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[\s　・、,，.。:：;；()（）/／・-]/g, "");
}

function normalizeText(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").replace(/[ \u00a0　]+/g, " ").trim();
}

function normalizeCorporateNumber(value) {
  const digits = String(value ?? "").replace(/^法人番号\s*/u, "").replace(/[^0-9]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

function parseAmount(value) {
  const normalized = String(value ?? "").replace(/[￥¥円,，\s]/g, "");
  if (!/^\d+(?:\.0+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) ? number : null;
}

function parseOfficialDate(value) {
  const raw = normalizeText(value);
  let match = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^令和([元\d]+)年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(2018 + (match[1] === "元" ? 1 : Number(match[1])), Number(match[2]), Number(match[3]));
  return null;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYearOfDate(date) {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}
