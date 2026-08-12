/**
 * JPO workbooks whose official XLSX URLs were checked on 2026-08-12.
 *
 * This registry is imported by the production updater.  Every addition must
 * therefore remain fail-closed behind the strict workbook parser, source
 * receipt checks where archived, and published-data continuity checks.
 * Deleted year pages are never used as provenance links.  When an older XLSX
 * still exists but its year page no longer does, sourcePageUrl points to the
 * live category index and discoveryStatus records that limitation.
 */

const VERIFIED_AT = "2026-08-12";

const SOURCE_PAGES = Object.freeze({
  competitiveIndex: "https://www.jpo.go.jp/news/chotatsu/rakusatu/kyosonyusatu/index.html",
  discretionaryIndex: "https://www.jpo.go.jp/news/chotatsu/rakusatu/zuikeyaku/index.html",
  grantIndex: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/index.html",
});

const SUBJECT_HEADERS = Object.freeze({
  goods: Object.freeze(["物品役務等の名称及び数量"]),
  commission: Object.freeze(["物品役務等の名称及び数量"]),
  publicWorks: Object.freeze(["公共工事の名称、場所、期間及び種別"]),
});

const CONTRACT_HEADER_ALIASES = Object.freeze({
  "物品役務等の名称及び数量": Object.freeze([
    "物品役務等の名称及び数量",
    "公共工事の名称、場所、期間及び種別",
  ]),
  "契約を締結した日": Object.freeze(["契約を締結した日"]),
  "契約の相手方の商号又は名称": Object.freeze([
    "契約の相手方の商号又は名称",
    "商号又は名称",
  ]),
  "契約の相手方の法人番号": Object.freeze([
    "契約の相手方の法人番号",
    "法人番号",
  ]),
  "契約金額円": Object.freeze([
    "契約金額（円）",
    "契約金額円",
    "契約金額",
  ]),
  "契約の相手方の住所": Object.freeze([
    "契約の相手方の住所",
    "住所",
  ]),
  "備考": Object.freeze(["備考"]),
});

const GRANT_HEADER_ALIASES = Object.freeze({
  "事業名": Object.freeze(["事業名"]),
  "交付先名": Object.freeze(["交付先名"]),
  "法人番号": Object.freeze(["法人番号"]),
  "交付決定額": Object.freeze(["交付決定額"]),
  "交付決定日": Object.freeze(["交付決定日"]),
  "備考": Object.freeze(["備考"]),
});

const CONTRACT_KINDS = Object.freeze({
  competitive: Object.freeze({
    goods: "競争入札（物品・役務等）",
    commission: "競争入札（委託費）",
    publicWorks: "競争入札（公共工事）",
  }),
  discretionary: Object.freeze({
    goods: "随意契約（物品・役務等）",
    commission: "随意契約（委託費）",
    publicWorks: "随意契約（公共工事）",
  }),
});

const SUBJECT_SLUGS = Object.freeze({
  goods: "ukeoi",
  commission: "itaku",
  publicWorks: "kokyokoji",
});

const CONTRACT_EXPECTED_SHEETS = Object.freeze({
  "2020-competitive-goods": 12,
  "2020-competitive-commission": 2,
  "2020-competitive-publicWorks": 2,
  "2020-discretionary-goods": 8,
  "2020-discretionary-commission": 4,
  "2020-discretionary-publicWorks": 3,
  "2021-competitive-goods": 12,
  "2021-competitive-commission": 7,
  "2021-competitive-publicWorks": 2,
  "2021-discretionary-goods": 6,
  "2021-discretionary-commission": 1,
  "2021-discretionary-publicWorks": 3,
  "2022-competitive-goods": 12,
  "2022-competitive-commission": 7,
  "2022-competitive-publicWorks": 2,
  "2022-discretionary-goods": 6,
  "2022-discretionary-commission": 1,
  "2022-discretionary-publicWorks": 1,
  "2023-competitive-goods": 12,
  "2023-competitive-commission": 8,
  "2023-competitive-publicWorks": 1,
  "2023-discretionary-goods": 9,
  "2023-discretionary-commission": 1,
  "2023-discretionary-publicWorks": 1,
  "2024-competitive-goods": 12,
  "2024-competitive-commission": 6,
  "2024-competitive-publicWorks": 1,
  "2024-discretionary-goods": 6,
  "2024-discretionary-commission": 2,
  "2025-competitive-commission": 7,
  "2025-competitive-publicWorks": 2,
  "2025-discretionary-commission": 3,
});

// These nine exact WARP workbooks were already in the published dataset before
// the broader historical replay map was introduced.  Pin the raw response and
// strict-parser receipts from the last verified committed manifest so every
// archived source, not only a newly substituted one, is mandatory and
// reproducible.  They intentionally remain outside the 50-entry replacement
// allowlist because their exact WARP URLs are already part of this registry.
const ARCHIVED_CONTRACT_RECEIPTS = Object.freeze({
  "2022-discretionary-goods": Object.freeze({
    bytes: 47_540, sha256: "7983e6e50dad36e3d464fb477fbcbf27959ed92022e48765e744fac4d1874a81", records: 94,
  }),
  "2022-discretionary-commission": Object.freeze({
    bytes: 15_636, sha256: "44b10ee3ec396ee0c6c0094d4e45d8ae4a57e92848da3f67471127954240c0c0", records: 4,
  }),
  "2022-discretionary-publicWorks": Object.freeze({
    bytes: 15_984, sha256: "e59a391309d24aecb2dc92f70e471869b86d9d1f138adf78b3efdd4a05da0edd", records: 1,
  }),
  "2023-competitive-goods": Object.freeze({
    bytes: 72_985, sha256: "d07e116503db7bf2fe537af3293970d8180899864627c12070871f9969cf6a10", records: 165,
  }),
  "2023-competitive-commission": Object.freeze({
    bytes: 35_266, sha256: "564b58ae9a044d9900ec5ebbba2e6350cdf4a0b431dc587ed9ab4b170c43309d", records: 17,
  }),
  "2023-competitive-publicWorks": Object.freeze({
    bytes: 14_272, sha256: "b8253e7f7d3f2994b6916ba4a6ca7cefb0105127b9bd6146a7d35333954dfdf8", records: 1,
  }),
  "2023-discretionary-goods": Object.freeze({
    bytes: 55_405, sha256: "0e07f9eeb94090fed18bb4ea1dc248522cddbac57b2b6fbf5c9c5b4ba980f4c5", records: 100,
  }),
  "2023-discretionary-commission": Object.freeze({
    bytes: 15_546, sha256: "5e53ce50144c87c280e4da3476d89937ff5b872bfdb10eb2b1f80a66d3b40c3f", records: 5,
  }),
  "2023-discretionary-publicWorks": Object.freeze({
    bytes: 16_305, sha256: "1cf0e9ed8effbb9919342bb129904241f0a8530144f8cfa760d63fa53e1daca5", records: 1,
  }),
});

function liveYearPage(contractClass, fiscalYear) {
  const directory = contractClass === "competitive" ? "kyosonyusatu" : "zuikeyaku";
  return `https://www.jpo.go.jp/news/chotatsu/rakusatu/${directory}/${fiscalYear}.html`;
}

function contractDocument(fiscalYear, contractClass, subjectClass, options = {}) {
  const directory = contractClass === "competitive" ? "kyosonyusatu" : "zuikeyaku";
  const originalUrl = `https://www.jpo.go.jp/news/chotatsu/rakusatu/${directory}/document/${fiscalYear}/${fiscalYear}_${SUBJECT_SLUGS[subjectClass]}.xlsx`;
  const sourcePageUrl = options.sourcePageUrl ?? (options.linkedFromLiveYearPage
    ? liveYearPage(contractClass, fiscalYear)
    : SOURCE_PAGES[contractClass === "competitive" ? "competitiveIndex" : "discretionaryIndex"]);
  const key = `${fiscalYear}-${contractClass}-${subjectClass}`;
  return Object.freeze({
    id: `jpo-${fiscalYear}-${contractClass}-${toKebabCase(subjectClass)}`,
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear,
    category: "contract_result",
    contractClass,
    subjectClass: toKebabCase(subjectClass),
    kind: CONTRACT_KINDS[contractClass][subjectClass],
    amountStage: "契約金額欄の掲載値",
    sourcePageUrl,
    url: options.url ?? originalUrl,
    ...(options.url ? { originalUrl } : {}),
    ...(options.archiveProvider ? { archiveProvider: options.archiveProvider } : {}),
    ...(options.archiveExpectedBytes ? {
      archiveExpectedBytes: options.archiveExpectedBytes,
      archiveExpectedSha256: options.archiveExpectedSha256,
      archiveExpectedRecordCount: options.archiveExpectedRecordCount,
    } : {}),
    format: "xlsx",
    contractSubjectHeaders: options.contractSubjectHeaders ?? SUBJECT_HEADERS[subjectClass],
    headerAliases: CONTRACT_HEADER_ALIASES,
    discoveryStatus: options.discoveryStatus ?? (options.linkedFromLiveYearPage
      ? "linked_from_live_year_page"
      : "orphaned_official_file"),
    emptySentinel: null,
    coverageClaim: "公式年度XLSXに掲載された行（年度内の全月掲載を意味しない）",
    multiplePartyPolicy: "one_official_row",
    expectedSheetCount: CONTRACT_EXPECTED_SHEETS[key],
    verifiedAt: VERIFIED_AT,
  });
}

function archivedContractDocument(fiscalYear, contractClass, subjectClass, capture, pageCapture, options = {}) {
  const directory = contractClass === "competitive" ? "kyosonyusatu" : "zuikeyaku";
  const originalPath = `https://www.jpo.go.jp/news/chotatsu/rakusatu/${directory}`;
  const receiptKey = `${fiscalYear}-${contractClass}-${subjectClass}`;
  const receipt = ARCHIVED_CONTRACT_RECEIPTS[receiptKey];
  if (!receipt) throw new Error(`検証済みJPO WARP receiptがありません: ${receiptKey}`);
  return contractDocument(fiscalYear, contractClass, subjectClass, {
    ...options,
    url: `https://warp.ndl.go.jp/${capture}/${originalPath}/document/${fiscalYear}/${fiscalYear}_${SUBJECT_SLUGS[subjectClass]}.xlsx`,
    sourcePageUrl: `https://warp.ndl.go.jp/${pageCapture}/${originalPath}/${fiscalYear}.html`,
    discoveryStatus: "archived_official_file",
    archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）",
    archiveExpectedBytes: receipt.bytes,
    archiveExpectedSha256: receipt.sha256,
    archiveExpectedRecordCount: receipt.records,
  });
}

function grantDocument(fiscalYear, half, options = {}) {
  const isFirstHalf = half === "h1";
  const suffix = isFirstHalf ? "04_09" : "10_03";
  return Object.freeze({
    id: `jpo-${fiscalYear}-grant-decisions-${half}`,
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear,
    category: "grant_decision",
    half,
    kind: `補助金等の交付決定（${isFirstHalf ? "4月～9月" : "10月～3月"}）`,
    amountStage: "交付決定額欄の掲載値",
    sourcePageUrl: options.linkedFromLiveYearPage
      ? `https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/${fiscalYear}.html`
      : SOURCE_PAGES.grantIndex,
    url: `https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/${fiscalYear}/${fiscalYear}_${suffix}.xlsx`,
    format: "xlsx",
    contractSubjectHeaders: Object.freeze([]),
    headerAliases: GRANT_HEADER_ALIASES,
    discoveryStatus: options.linkedFromLiveYearPage
      ? "linked_from_live_year_page"
      : "orphaned_official_file",
    emptySentinel: "交付決定なし",
    coverageClaim: "公式半期XLSXに掲載された行",
    multiplePartyPolicy: "one_official_row",
    expectedSheetCount: 1,
    verifiedAt: VERIFIED_AT,
  });
}

function toKebabCase(value) {
  return value === "publicWorks" ? "public-works" : value;
}

const documents = [
  // FY2020 and FY2021 year pages have been retired, but all six annual
  // contract files for each year remain downloadable from the JPO host.
  ...[2020, 2021].flatMap((year) => [
    contractDocument(year, "competitive", "goods"),
    contractDocument(year, "competitive", "commission"),
    contractDocument(year, "competitive", "publicWorks"),
    contractDocument(year, "discretionary", "goods"),
    contractDocument(year, "discretionary", "commission"),
    contractDocument(year, "discretionary", "publicWorks"),
  ]),

  // Only the FY2022 contract URLs that still return actual workbooks are
  // registered.  The three guessed discretionary paths return the JPO 404
  // page and are intentionally absent.
  contractDocument(2022, "competitive", "goods"),
  contractDocument(2022, "competitive", "commission"),
  contractDocument(2022, "competitive", "publicWorks"),
  ...["goods", "commission", "publicWorks"].map((subject) =>
    archivedContractDocument(
      2022,
      "discretionary",
      subject,
      "20230502/20230501202632",
      "20230502/20230501202632",
      // These archived public-works workbooks use the generic subject label
      // in their actual header even though their official category is works.
      subject === "publicWorks" ? { contractSubjectHeaders: SUBJECT_HEADERS.goods } : {},
    )),

  ...["competitive", "discretionary"].flatMap((contractClass) =>
    ["goods", "commission", "publicWorks"].map((subject) => {
      const capture = contractClass === "competitive"
        ? "20240502/20240501124054"
        : "20240502/20240501124103";
      return archivedContractDocument(
        2023,
        contractClass,
        subject,
        capture,
        capture,
        subject === "publicWorks" ? { contractSubjectHeaders: SUBJECT_HEADERS.goods } : {},
      );
    })),

  // FY2021 grant files remain available although their year page is retired.
  grantDocument(2021, "h1"),
  grantDocument(2021, "h2"),
  ...[2022, 2023, 2024].flatMap((year) => [
    grantDocument(year, "h1", { linkedFromLiveYearPage: true }),
    grantDocument(year, "h2", { linkedFromLiveYearPage: true }),
  ]),

  ...["goods", "commission", "publicWorks"].map((subject) =>
    contractDocument(2024, "competitive", subject, { linkedFromLiveYearPage: true })),
  contractDocument(2024, "discretionary", "goods", { linkedFromLiveYearPage: true }),
  contractDocument(2024, "discretionary", "commission", { linkedFromLiveYearPage: true }),

  // These FY2025 files fill three categories missing from OFFICIAL_DOCUMENTS.
  // The guessed FY2025 discretionary-public-works path returns an official
  // 404 page, so fail-closed registration excludes it.
  contractDocument(2025, "competitive", "commission", { linkedFromLiveYearPage: true }),
  contractDocument(2025, "competitive", "publicWorks", { linkedFromLiveYearPage: true }),
  contractDocument(2025, "discretionary", "commission", { linkedFromLiveYearPage: true }),
];

export const JPO_HISTORICAL_DOCUMENTS = Object.freeze(documents);
