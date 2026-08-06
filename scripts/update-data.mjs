import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  auditGbizImport,
  normalizeGbizAgency,
  parseDashboardRow,
  stripHtml,
  toGbizBulkRecords,
} from "./gbiz-csv.mjs";
import {
  cleanCell,
  fiscalYear,
  hasValidCorporateNumber,
  parseAmount,
  parseJapaneseDate,
} from "./gbiz-values.mjs";

const dataPath = new URL("../data/funding-data.json", import.meta.url);
const summaryPath = new URL("../data/funding-summary.json", import.meta.url);
const registryPath = new URL("../data/source-registry.json", import.meta.url);
const pageDataPath = new URL("../data/pages/", import.meta.url);

const [current, registry] = await Promise.all([
  readJson(dataPath),
  readJson(registryPath),
]);

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const next = structuredClone(current);
const configured = new Map(
  registry.sources.filter((source) => source.enabled).map((source) => [source.id, source]),
);
const results = [];
let importSucceededAt = null;

next.records = next.records
  .filter(isGbizRecord)
  .map(sanitizeLegacyGbizRecord);
next.sources = next.sources.filter((source) => configured.has(source.id));
delete next.reviewPrograms;
delete next.reviewPayments;
delete next.aggregates;
for (const source of configured.values()) {
  if (!next.sources.some((candidate) => candidate.id === source.id)) {
    next.sources.push({
      id: source.id,
      name: source.name,
      recordCount: 0,
      method: source.method || "公式公開データ",
      frequency: source.frequency || "日次確認",
      lastChecked: "未取得",
      status: "watch",
    });
  }
}
const gbizMetadata = next.sources.find((source) => source.id === "gbiz");
if (gbizMetadata) {
  for (const legacyField of [
    "officialRecordCount",
    "officialSubsidyCount",
    "officialProcurementCount",
    "officialMetiSubtotalCount",
    "officialPatentCount",
    "recordCountGap",
    "importedRecordCount",
    "importedSubsidyCount",
    "importedProcurementCount",
  ]) {
    delete gbizMetadata[legacyField];
  }
}

const dashboardStats = await refreshGbiz();
const importSucceeded = await refreshGbizBulk(dashboardStats);
if (!importSucceeded && process.env.CI === "true") {
  for (const result of results) {
    console.error(`${result.ok ? "OK" : "STALE"} ${result.name}: ${result.message}`);
  }
  throw new Error("GビズINFO全件CSVの取得・件数照合が完了しなかったため、CIでの公開更新を中止します");
}
next.coverage = buildCoverage(next);
if (importSucceededAt) next.generatedAt = importSucceededAt;
next.records.sort((a, b) => {
  return (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.id.localeCompare(b.id);
});

validate(next);
await writePageData(next);
await Promise.all([
  writeFile(dataPath, `${JSON.stringify(next)}\n`),
  writeFile(summaryPath, `${JSON.stringify({
    ...next,
    records: [],
  }, null, 2)}\n`),
]);

for (const result of results) {
  console.log(`${result.ok ? "OK" : "STALE"} ${result.name}: ${result.message}`);
}
console.log(`Wrote ${next.records.length.toLocaleString("en-US")} records to ${dataPath.pathname}`);

async function writePageData(data) {
  await rm(pageDataPath, { recursive: true, force: true });
  await mkdir(pageDataPath, { recursive: true });
  const series = {
    commitments: groupRowsByYear(data.records, (row) => row.fiscalYear ?? "unclassified"),
  };
  const manifest = {
    generatedAt: data.generatedAt,
    commitments: {},
  };
  const writes = [];

  for (const [seriesName, groups] of Object.entries(series)) {
    for (const [year, rows] of groups) {
      const filename = `${seriesName}-${year}.json`;
      manifest[seriesName][year] = filename;
      writes.push(writeFile(new URL(filename, pageDataPath), `${JSON.stringify(rows)}\n`));
    }
  }
  await Promise.all(writes);
  await writeFile(new URL("manifest.json", pageDataPath), `${JSON.stringify(manifest, null, 2)}\n`);
}

function groupRowsByYear(rows, yearForRow) {
  const groups = new Map();
  for (const row of rows) {
    const year = String(yearForRow(row));
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(row);
  }
  return groups;
}

async function refreshGbiz() {
  const source = configured.get("gbiz");
  if (!source) return null;

  try {
    const html = await fetchText(source.indexUrl);
    const meti = parseDashboardRow(html, "経済産業省 (小計)");
    const patent = parseDashboardRow(html, "特許庁");
    const dashboardSubsidyCount = meti.subsidies + patent.subsidies;
    const dashboardProcurementCount = meti.procurements + patent.procurements;
    const dashboardRecordCount = dashboardSubsidyCount + dashboardProcurementCount;
    const dashboardCheckedAt = new Date().toISOString();
    const stats = {
      dashboardCheckedAt,
      dashboardRecordCount,
      dashboardSubsidyCount,
      dashboardProcurementCount,
      dashboardMetiSubtotalCount: meti.subsidies + meti.procurements,
      dashboardPatentCount: patent.subsidies + patent.procurements,
    };
    updateSource("gbiz", {
      ...stats,
      dashboardSiteGap: dashboardRecordCount - next.records.length,
      lastChecked: today,
      status: "watch",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `公式画面（経産省小計＋特許庁） 補助金 ${dashboardSubsidyCount.toLocaleString("ja-JP")}件、調達 ${dashboardProcurementCount.toLocaleString("ja-JP")}件`,
    });
    return stats;
  } catch (error) {
    markStale("gbiz", source, error);
    return null;
  }
}

async function refreshGbizBulk(dashboardStats) {
  const source = configured.get("gbiz");
  if (!source?.downloadUrl) return false;

  const tokenName = source.apiTokenEnv || "GBIZINFO_API_TOKEN";
  const token = process.env[tokenName]?.trim();
  if (!token) {
    updateSource("gbiz", { status: "watch" });
    results.push({
      ok: false,
      name: "GビズINFO 全件CSV",
      message: `${tokenName}未設定のため前回の明細と最終取込日時を保持`,
    });
    return false;
  }
  try {
    const subsidyCsv = await downloadGbizCsv(source.downloadUrl, "Hojokinjoho", token);
    const procurementCsv = await downloadGbizCsv(source.downloadUrl, "Chotatsujoho", token);
    const csvRetrievedAt = new Date().toISOString();
    const subsidyResult = toGbizBulkRecords(subsidyCsv, "subsidy");
    const procurementResult = toGbizBulkRecords(procurementCsv, "procurement");
    logGbizScan("補助金", subsidyResult.stats);
    logGbizScan("調達", procurementResult.stats);
    const newRecords = [...subsidyResult.records, ...procurementResult.records];
    assertUniqueRecordIds(newRecords);
    const audit = auditGbizImport(subsidyResult, procurementResult, dashboardStats);
    importSucceededAt = new Date().toISOString();
    next.records = newRecords;
    updateSource("gbiz", {
      ...audit,
      recordCount: audit.csvImportedRecordCount,
      csvRetrievedAt,
      csvSubsidyFileBytes: Buffer.byteLength(subsidyCsv, "utf8"),
      csvProcurementFileBytes: Buffer.byteLength(procurementCsv, "utf8"),
      csvSubsidySha256: sha256(subsidyCsv),
      csvProcurementSha256: sha256(procurementCsv),
      csvTotalSubsidyRows: subsidyResult.stats.totalRows,
      csvTotalProcurementRows: procurementResult.stats.totalRows,
      dashboardSiteGap: undefined,
      method: "GビズINFO全件CSVを毎日再取得",
      lastChecked: today,
      lastSuccessfulImportAt: importSucceededAt,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: "GビズINFO 全件CSV",
      message: `CSV対象 ${audit.csvEligibleRecordCount.toLocaleString("ja-JP")}行を全件取込 `
        + `（CSV取込差 ${formatSignedCount(audit.csvImportGap)}、公式画面－CSV ${formatSignedCount(audit.dashboardMinusCsvEligibleCount)}）`,
    });
    return true;
  } catch (error) {
    updateSource("gbiz", { status: "watch" });
    results.push({
      ok: false,
      name: "GビズINFO 全件CSV",
      message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
    });
    return false;
  }
}

function formatSignedCount(value) {
  if (value === null) return "未照合";
  return `${value.toLocaleString("ja-JP")}件`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function downloadGbizCsv(downloadPageUrl, downfile, token) {
  const pageResponse = await fetch(downloadPageUrl, {
    headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!pageResponse.ok) throw new Error(`GビズINFOダウンロード画面: ${pageResponse.status}`);
  const html = await pageResponse.text();
  const action = html.match(/<form[^>]+action=["']([^"']*\/Download(?:;jsessionid=[^"']+)?)['"][^>]+id=["']down["']/i)?.[1]
    || html.match(/<form[^>]+id=["']down["'][^>]+action=["']([^"']*\/Download(?:;jsessionid=[^"']+)?)['"]/i)?.[1];
  if (!action) throw new Error("GビズINFOの全件ダウンロード先が見つかりません");

  const cookies = typeof pageResponse.headers.getSetCookie === "function"
    ? pageResponse.headers.getSetCookie()
    : [pageResponse.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  const body = new URLSearchParams({
    downfile,
    meta: "META",
    downenc: "UTF-8",
    apiToken: token,
    downtype: "csv",
  });
  const response = await fetch(new URL(action.replaceAll("&amp;", "&"), downloadPageUrl), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader,
      referer: downloadPageUrl,
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
    },
    body,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`GビズINFO ${downfile}: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(text)) {
    const error = text.match(/class=["']alert-title-txt["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    throw new Error(`GビズINFO ${downfile}: ${error ? stripHtml(error) : "CSVを取得できませんでした"}`);
  }
  return text.replace(/^\uFEFF/, "");
}

function logGbizScan(kind, stats) {
  console.log(`SCAN GビズINFO ${kind}: ${JSON.stringify(stats)}`);
}

function parseNullableInteger(value) {
  const amount = parseAmount(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

function assertUniqueRecordIds(records) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new Error(`GビズINFO 全件CSV: キー情報が重複しています (${record.id})`);
    }
    ids.add(record.id);
  }
}

function isGbizRecord(record) {
  return record?.ingestSource === "gbiz-bulk-csv" || String(record?.id ?? "").startsWith("gbiz-");
}

function sanitizeLegacyGbizRecord(record) {
  const {
    route: _route,
    flowLevel: _flowLevel,
    flowDepth: _flowDepth,
    ...safe
  } = record;
  const date = typeof safe.date === "string" && parseJapaneseDate(safe.date) === safe.date
    ? safe.date
    : null;
  const amount = safe.amount === null || Number.isSafeInteger(safe.amount)
    ? safe.amount
    : null;
  return {
    ...safe,
    fiscalYear: date ? fiscalYear(date) : null,
    date,
    dateRaw: typeof safe.dateRaw === "string" ? safe.dateRaw : (date ?? ""),
    program: typeof safe.program === "string" ? safe.program : "",
    amount,
    amountRaw: typeof safe.amountRaw === "string"
      ? safe.amountRaw
      : amount === null ? "" : String(amount),
    sourceAgency: typeof safe.sourceAgency === "string" ? safe.sourceAgency : "",
    publisherCanonical: safe.publisherCanonical
      || normalizeGbizAgency(typeof safe.sourceAgency === "string" ? safe.sourceAgency : "")
      || "",
    sourceKey: typeof safe.sourceKey === "string" ? safe.sourceKey : "",
    ingestSource: "gbiz-bulk-csv",
  };
}

function buildCoverage(data) {
  const gbizRecords = data.records.filter(isGbizRecord);
  const gbizFiscalYears = distinctYears(gbizRecords.map((row) => row.fiscalYear));

  return {
    gbiz: {
      fiscalYears: gbizFiscalYears,
      unclassifiedDateCount: gbizRecords.filter((row) => row.fiscalYear === null).length,
      completeness: "source-records",
      note: "GビズINFO全件CSVから抽出した経産省小計・特許庁の補助金・調達。年度は認定日・受注日ベース",
    },
  };
}

function distinctYears(values) {
  return [...new Set(values.filter(Number.isInteger))].sort((a, b) => a - b);
}

function updateSource(id, patch) {
  const source = next.sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`データソース ${id} が funding-data.json にありません`);
  Object.assign(source, patch);
}

function markStale(id, source, error) {
  updateSource(id, { status: "watch" });
  results.push({
    ok: false,
    name: source.name,
    message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
  });
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  return response.text();
}

async function fetchWithTimeout(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

function validate(data) {
  if (!Array.isArray(data.records) || !Array.isArray(data.sources)) {
    throw new Error("funding-data.json の構造が不正です");
  }
  const ids = new Set();
  for (const record of data.records) {
    if (ids.has(record.id)) throw new Error(`重複ID: ${record.id}`);
    ids.add(record.id);
    if (!hasValidCorporateNumber(record.corporateNumber)) {
      throw new Error(`法人番号が不正です: ${record.id}`);
    }
    if (record.amount !== null && !Number.isSafeInteger(record.amount)) {
      throw new Error(`金額が不正です: ${record.id}`);
    }
    if (record.date === null) {
      if (record.fiscalYear !== null) throw new Error(`日付なし行の年度が不正です: ${record.id}`);
    } else {
      if (parseJapaneseDate(record.date) !== record.date || fiscalYear(record.date) !== record.fiscalYear) {
        throw new Error(`日付・算出年度が不正です: ${record.id}`);
      }
    }
    if (!["contracted", "subsidy_published"].includes(record.stage)) {
      throw new Error(`区分が不正です: ${record.id}`);
    }
    if ("route" in record || "flowLevel" in record || "flowDepth" in record) {
      throw new Error(`根拠のない資金経路情報があります: ${record.id}`);
    }
    if (!/^https:\/\//.test(record.sourceUrl)) {
      throw new Error(`掲載ページURLが不正です: ${record.id}`);
    }
  }
  const gbizSource = data.sources.find((source) => source.id === "gbiz");
  if (!gbizSource || gbizSource.recordCount !== data.records.length) {
    throw new Error("GビズINFOの収録件数が明細件数と一致しません");
  }
  if (Number.isSafeInteger(gbizSource.csvEligibleRecordCount)) {
    if (
      gbizSource.csvImportedRecordCount !== gbizSource.recordCount
      || gbizSource.csvImportGap !== gbizSource.csvEligibleRecordCount - gbizSource.csvImportedRecordCount
      || gbizSource.csvImportGap !== 0
    ) {
      throw new Error("GビズINFO全件CSVの対象行と取込行が一致しません");
    }
    const importedSubsidyCount = data.records.filter((record) => record.stage === "subsidy_published").length;
    const importedProcurementCount = data.records.filter((record) => record.stage === "contracted").length;
    if (
      gbizSource.csvImportedSubsidyCount !== importedSubsidyCount
      || gbizSource.csvEligibleSubsidyCount !== importedSubsidyCount
      || gbizSource.csvImportedProcurementCount !== importedProcurementCount
      || gbizSource.csvEligibleProcurementCount !== importedProcurementCount
    ) {
      throw new Error("GビズINFO全件CSVの区分別件数が一致しません");
    }
  }
  if (
    Number.isSafeInteger(gbizSource.dashboardRecordCount)
    && Number.isSafeInteger(gbizSource.csvEligibleRecordCount)
  ) {
    if (
      gbizSource.dashboardRecordCount
        !== gbizSource.dashboardSubsidyCount + gbizSource.dashboardProcurementCount
      || gbizSource.dashboardMinusCsvEligibleCount
        !== gbizSource.dashboardRecordCount - gbizSource.csvEligibleRecordCount
    ) {
      throw new Error("GビズINFO公式画面と全件CSVの参考照合値が不正です");
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
