import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";

import {
  AMOUNT_STATUSES,
  FLOW_LEVELS,
  REVIEW_SCHEMA_VERSION,
  buildReviewGraphs,
  cleanCell,
  createReviewPayments,
  csvObjectRows,
  isMetiReviewRow,
  migrateLegacyPayment,
  parseNullableInteger,
  parseNullableNumber,
} from "./review-data-model.mjs";

const SOURCE = {
  indexUrl: "https://rssystem.go.jp/download-csv",
  fiscalYearsUrl: "https://rssystem.go.jp/api/projects/fiscal-years/",
  filesBaseUrl: "https://rssystem.go.jp/files/",
};
const options = parseArguments(process.argv.slice(2));
const outputPath = directoryUrl(options.outputDirectory ?? fileURLToPath(new URL("../data/review-cache/", import.meta.url)));
const outputFilePath = fileURLToPath(outputPath).replace(/[\\/]$/, "");
const temporaryPath = directoryUrl(`${outputFilePath}.next`);
const previousPath = directoryUrl(`${outputFilePath}.previous`);
const fixturePath = options.fixtureDirectory ? directoryUrl(options.fixtureDirectory) : null;
const generatedAt = parseClock(options.now).toISOString();

const previous = await loadPreviousCache();
const candidates = await discoverReviewSheetYears();
const yearly = [];
const unavailable = [];
for (const reviewSheetYear of candidates) {
  try {
    yearly.push(await loadReviewSheetYear(reviewSheetYear));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const carryForward = previous?.yearly.get(reviewSheetYear);
    unavailable.push({ reviewSheetYear, reason, carryForwardUsed: Boolean(carryForward) });
    if (carryForward) yearly.push(carryForward);
  }
}
if (!yearly.length) throw new Error("行政事業レビューの公式CSVまたは前回検証済み年度を1年度も利用できませんでした");

const programs = yearly.flatMap((item) => item.programs).sort((a, b) => b.reviewSheetYear - a.reviewSheetYear || a.projectNumber.localeCompare(b.projectNumber, "ja"));
const payments = yearly.flatMap((item) => item.payments).sort((a, b) => b.reviewSheetYear - a.reviewSheetYear || (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY) || a.organization.localeCompare(b.organization, "ja"));
const excludedRows = yearly.flatMap((item) => item.excludedRows);
const sourceReceipts = yearly.flatMap((item) => item.receipts);
validate(programs, payments, sourceReceipts);

await rm(temporaryPath, { recursive: true, force: true });
await mkdir(temporaryPath, { recursive: true });
const paymentGroups = new Map();
for (const payment of payments) {
  const suffix = payment.id.slice(-2);
  const bucket = (Number.parseInt(suffix, 16) & 0x3f).toString(16).padStart(2, "0");
  if (!paymentGroups.has(bucket)) paymentGroups.set(bucket, []);
  paymentGroups.get(bucket).push(payment);
}
const paymentFiles = [...paymentGroups.keys()].sort().map((bucket) => `payments-${bucket}.json`);
const excludedRowsFile = "excluded-rows.json";
await Promise.all([
  writeFile(new URL("programs.json", temporaryPath), `${JSON.stringify(programs)}\n`),
  writeFile(new URL(excludedRowsFile, temporaryPath), `${JSON.stringify(excludedRows)}\n`),
  ...paymentFiles.map((filename) => {
    const bucket = filename.slice("payments-".length, -5);
    return writeFile(new URL(filename, temporaryPath), `${JSON.stringify(paymentGroups.get(bucket))}\n`);
  }),
]);
const manifest = {
  schemaVersion: REVIEW_SCHEMA_VERSION,
  generatedAt,
  lastSuccessfulSourceRefreshAt: yearly.some((item) => !item.carryForward)
    ? generatedAt
    : previous?.manifest.lastSuccessfulSourceRefreshAt ?? null,
  lastSuccessfulSourceRefreshDate: yearly.some((item) => !item.carryForward)
    ? jstCalendarDate(generatedAt)
    : previous?.manifest.lastSuccessfulSourceRefreshDate ?? previous?.manifest.lastSuccessfulSourceRefresh ?? null,
  // Deprecated compatibility field. It is a calendar date, not a timestamp.
  lastSuccessfulSourceRefresh: yearly.some((item) => !item.carryForward)
    ? jstCalendarDate(generatedAt)
    : previous?.manifest.lastSuccessfulSourceRefreshDate ?? previous?.manifest.lastSuccessfulSourceRefresh ?? null,
  refreshStatus: yearly.every((item) => item.carryForward) ? "carry-forward" : unavailable.length ? "partial-carry-forward" : "fresh",
  sourceUrl: SOURCE.indexUrl,
  reviewSheetYears: yearly.map((item) => item.reviewSheetYear).sort((a, b) => a - b),
  unavailableReviewSheetYears: unavailable,
  programsFile: "programs.json",
  paymentFiles,
  excludedRowsFile,
  programCount: programs.length,
  paymentCount: payments.length,
  excludedRowCount: excludedRows.length,
  carryForwardReviewSheetYears: yearly.filter((item) => item.carryForward).map((item) => item.reviewSheetYear).sort((a, b) => a - b),
  rowAccounting: summarizeAccounting(yearly),
  sourceReceipts,
  ...(sourceReceipts.length === 0 && previous?.manifest.bootstrapProvenance
    ? { bootstrapProvenance: previous.manifest.bootstrapProvenance }
    : {}),
  semantics: {
    paymentAmount: "行政事業レビュー公式CSV『支出先の合計支出額』掲載値",
    aggregationWarning: "上流・中間・終端の支出先を相互に合算しない。契約額・交付決定額・GビズINFO掲載値とも合算しない。",
    negativeSearchWarning: "未掲載・未収録・移行年度の詳細欠落があるため、0件を受給なしとは解釈しない。",
    routeWarning: "経路CSVに根拠がない経路は生成しない。複数上流がある場合は単一経路に決め打ちしない。",
  },
};
await writeFile(new URL("manifest.json", temporaryPath), `${JSON.stringify(manifest, null, 2)}\n`);
if (options.requireFresh && manifest.refreshStatus !== "fresh") {
  const unavailableYears = unavailable.map((item) => item.reviewSheetYear).join("・") || "不明";
  await rm(temporaryPath, { recursive: true, force: true });
  throw new Error(`行政事業レビューを新規取得できない年度があります（${unavailableYears}年度）。前回値は公開用データへ置き換えません`);
}
await atomicReplaceDirectory();
console.log(`Administrative review: ${manifest.reviewSheetYears.join("・")} sheets / ${programs.length} programs / ${payments.length} payment rows / ${sourceReceipts.length} source receipts`);
if (unavailable.length) console.log(`Unavailable candidate years: ${JSON.stringify(unavailable)}`);

async function discoverReviewSheetYears() {
  if (fixturePath) {
    const years = JSON.parse(await readFile(new URL("years.json", fixturePath), "utf8"));
    if (!Array.isArray(years) || !years.length || years.some((year) => !Number.isInteger(year))) {
      throw new Error("レビュー固定フィクスチャのyears.jsonが不正です");
    }
    return [...new Set(years)].sort((a, b) => a - b);
  }
  let discoveryError = null;
  try {
    const response = await fetchChecked(SOURCE.fiscalYearsUrl, { accept: "application/json" });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) throw new Error(`年度一覧がJSONではありません（${contentType || "content-type不明"}）`);
    const years = [...new Set(collectFiscalYears(await response.json()))].filter((year) => year >= 2024).sort((a, b) => a - b);
    if (!years.length) throw new Error("年度一覧に2024年度以降がありません");
    return years;
  } catch (error) {
    discoveryError = error instanceof Error ? error.message : String(error);
  }
  if (options.requireFresh) throw new Error(`行政事業レビューの年度一覧を取得できません: ${discoveryError}`);
  const previousYears = [...new Set(previous?.manifest.reviewSheetYears ?? [])]
    .filter((year) => Number.isInteger(year) && year >= 2024)
    .sort((a, b) => a - b);
  if (previousYears.length) return previousYears;
  throw new Error(`行政事業レビューの年度一覧を取得できず、前回年度もありません: ${discoveryError}`);
}

async function loadReviewSheetYear(reviewSheetYear) {
  const specs = [
    ["organizations", `1-1_RS_${reviewSheetYear}_基本情報_組織情報.zip`],
    ["budgets", `2-1_RS_${reviewSheetYear}_予算・執行_サマリ.zip`],
    ["payments", `5-1_RS_${reviewSheetYear}_支出先_支出情報.zip`],
    ["flows", `5-2_RS_${reviewSheetYear}_支出先_支出ブロックのつながり.zip`],
  ];
  const downloaded = [];
  for (const [kind, filename] of specs) {
    const url = new URL(`${reviewSheetYear}/rs/${filename}`, SOURCE.filesBaseUrl).href;
    let buffer;
    let fixtureOnly = false;
    if (fixturePath) {
      const csv = await readFile(new URL(`${reviewSheetYear}/${kind}.csv`, fixturePath), "utf8");
      buffer = Buffer.from(zipSync(
        { [filename.replace(/\.zip$/, ".csv")]: strToU8(csv) },
        { level: 0, mtime: new Date("1980-01-01T00:00:00.000Z") },
      ));
      fixtureOnly = true;
    } else {
      buffer = await fetchReviewArchive(url, `${reviewSheetYear} ${filename}`);
    }
    downloaded.push(decodeReviewArchive({ reviewSheetYear, kind, filename, url, buffer, fixtureOnly }));
    if (!fixturePath) await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  }
  const byKind = Object.fromEntries(downloaded.map((item) => [item.kind, item.csv]));
  const programById = new Map();
  for (const { row } of csvObjectRows(byKind.organizations)) {
    if (!isMetiReviewRow(row)) continue;
    const projectNumber = cleanCell(row["予算事業ID"]);
    if (!projectNumber || programById.has(projectNumber)) continue;
    const organization = [row["局・庁"], row["部"], row["課"], row["室"]].map(cleanCell).filter(Boolean).join(" / ");
    programById.set(projectNumber, { id: `rs-${reviewSheetYear}-${projectNumber}`, reviewSheetYear, projectNumber, name: cleanCell(row["事業名"]), organization: organization || "経済産業省", budgetFiscalYear: reviewSheetYear, initialBudget: null, availableBudget: null, executionFiscalYear: null, execution: null, executionRate: null, sourceUrl: SOURCE.indexUrl });
  }
  if (!programById.size) throw new Error(`${reviewSheetYear}: 組織情報CSVに経済産業省の行がありません`);
  for (const { row } of csvObjectRows(byKind.budgets)) {
    if (!isMetiReviewRow(row)) continue;
    const project = programById.get(cleanCell(row["予算事業ID"])); if (!project) continue;
    const budgetYear = Number(cleanCell(row["予算年度"]));
    const initialBudget = parseNullableInteger(row["当初予算（合計）"]), availableBudget = parseNullableInteger(row["計（歳出予算現額合計）"]), execution = parseNullableInteger(row["執行額（合計）"]), executionRate = parseNullableNumber(row["執行率"]);
    if (budgetYear === reviewSheetYear) { project.initialBudget = initialBudget; project.availableBudget = availableBudget; }
    if (budgetYear < reviewSheetYear && execution !== null && (project.executionFiscalYear === null || budgetYear > project.executionFiscalYear)) { project.executionFiscalYear = budgetYear; project.execution = execution; project.executionRate = executionRate; }
  }
  const graphByProject = buildReviewGraphs(csvObjectRows(byKind.flows));
  const result = createReviewPayments({
    reviewSheetYear,
    rows: csvObjectRows(byKind.payments),
    programById,
    graphByProject,
  });
  if (!result.accounting.sourcePaymentRowCount) throw new Error(`${reviewSheetYear}: 支出情報CSVに経済産業省の行がありません`);
  return {
    reviewSheetYear,
    programs: [...programById.values()],
    payments: result.payments,
    excludedRows: result.excludedRows,
    accounting: result.accounting,
    receipts: downloaded.map((item) => item.receipt),
    carryForward: false,
  };
}

async function loadPreviousCache() {
  try {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", outputPath), "utf8"));
    const programs = JSON.parse(await readFile(new URL(manifest.programsFile, outputPath), "utf8"));
    const rawPayments = (await Promise.all(manifest.paymentFiles.map(async (filename) =>
      JSON.parse(await readFile(new URL(filename, outputPath), "utf8"))))).flat();
    const payments = manifest.schemaVersion === REVIEW_SCHEMA_VERSION
      ? rawPayments
      : rawPayments.map(migrateLegacyPayment);
    let excludedRows = [];
    if (manifest.excludedRowsFile) {
      try { excludedRows = JSON.parse(await readFile(new URL(manifest.excludedRowsFile, outputPath), "utf8")); } catch {}
    }
    const yearly = new Map();
    for (const reviewSheetYear of manifest.reviewSheetYears ?? []) {
      const yearPrograms = programs.filter((row) => row.reviewSheetYear === reviewSheetYear);
      const yearPayments = payments.filter((row) => row.reviewSheetYear === reviewSheetYear);
      if (!yearPrograms.length || !yearPayments.length) continue;
      const yearExcluded = excludedRows.filter((row) => row.reviewSheetYear === reviewSheetYear);
      const accounting = manifest.rowAccounting?.byYear?.[reviewSheetYear] ?? {
        status: "unknown_legacy_cache",
        sourcePaymentRowCount: null,
        publishedPaymentRowCount: yearPayments.length,
        excludedPaymentRowCount: null,
        excludedByReason: null,
        amountStatusCounts: null,
      };
      yearly.set(reviewSheetYear, {
        reviewSheetYear,
        programs: yearPrograms,
        payments: yearPayments,
        excludedRows: yearExcluded,
        accounting,
        receipts: (manifest.sourceReceipts ?? []).filter((receipt) => receipt.reviewSheetYear === reviewSheetYear),
        carryForward: true,
      });
    }
    return { manifest, yearly };
  } catch {
    return null;
  }
}

function summarizeAccounting(items) {
  const byYear = Object.fromEntries(items.map((item) => [item.reviewSheetYear, item.accounting]));
  const complete = items.every((item) => item.accounting.status === "complete");
  const totals = complete ? {
    sourcePaymentRowCount: items.reduce((sum, item) => sum + item.accounting.sourcePaymentRowCount, 0),
    publishedPaymentRowCount: items.reduce((sum, item) => sum + item.accounting.publishedPaymentRowCount, 0),
    excludedPaymentRowCount: items.reduce((sum, item) => sum + item.accounting.excludedPaymentRowCount, 0),
    excludedByReason: mergeCounts(items.map((item) => item.accounting.excludedByReason)),
    amountStatusCounts: mergeCounts(items.map((item) => item.accounting.amountStatusCounts), AMOUNT_STATUSES),
  } : {
    sourcePaymentRowCount: null,
    publishedPaymentRowCount: items.reduce((sum, item) => sum + item.payments.length, 0),
    excludedPaymentRowCount: null,
    excludedByReason: null,
    amountStatusCounts: null,
  };
  return { status: complete ? "complete" : "partial_unknown_legacy_cache", byYear, totals };
}

function mergeCounts(groups, requiredKeys = []) {
  const merged = Object.fromEntries(requiredKeys.map((key) => [key, 0]));
  for (const group of groups) for (const [key, value] of Object.entries(group ?? {})) merged[key] = (merged[key] ?? 0) + value;
  return merged;
}

async function atomicReplaceDirectory() {
  await rm(previousPath, { recursive: true, force: true });
  let previousMoved = false;
  try {
    await rename(outputPath, previousPath);
    previousMoved = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    if (previousMoved) await rename(previousPath, outputPath);
    throw error;
  }
  await rm(previousPath, { recursive: true, force: true });
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function decodeReviewArchive({ reviewSheetYear, kind, filename, url, buffer, fixtureOnly }) {
  if (buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") throw new Error(`${reviewSheetYear} ${filename}: ZIPシグネチャがありません`);
  const archive = unzipSync(new Uint8Array(buffer));
  const csvName = Object.keys(archive).find((name) => name.endsWith(".csv"));
  if (!csvName) throw new Error(`${reviewSheetYear} ${filename}: ZIP内にCSVがありません`);
  const csv = new TextDecoder("utf-8").decode(archive[csvName]).replace(/^\uFEFF/, "");
  return {
    kind,
    filename,
    csv,
    receipt: { reviewSheetYear, kind, filename, url, bytes: buffer.length, sha256: sha256(buffer), ...(fixtureOnly ? { fixtureOnly: true } : {}) },
  };
}
function directoryUrl(value) { return new URL(`${pathToFileURL(resolve(value)).href.replace(/\/$/, "")}/`); }
function parseClock(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error(`--nowがISO 8601日時ではありません: ${value}`);
  return date;
}
function jstCalendarDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--require-fresh") {
      parsed.requireFresh = true;
      continue;
    }
    const value = args[index + 1];
    if (!["--fixture-dir", "--output-dir", "--now"].includes(key) || !value || value.startsWith("--")) {
      throw new Error(`不明または値のない引数です: ${key}`);
    }
    if (key === "--fixture-dir") parsed.fixtureDirectory = value;
    if (key === "--output-dir") parsed.outputDirectory = value;
    if (key === "--now") parsed.now = value;
    index += 1;
  }
  return parsed;
}
function collectFiscalYears(value) { if (Array.isArray(value)) return value.flatMap(collectFiscalYears); if (value && typeof value === "object") return Object.values(value).flatMap(collectFiscalYears); const year = Number(value); return Number.isInteger(year) ? [year] : []; }
async function fetchChecked(url, extraHeaders = {}) { const response = await fetch(url, { headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)", ...extraHeaders }, signal: AbortSignal.timeout(3 * 60_000) }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`); return response; }
async function fetchReviewArchive(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const reviewSheetYear = new URL(url).pathname.split("/").find((part) => /^20\d{2}$/.test(part));
      const response = await fetchChecked(url, {
        accept: "application/zip, application/octet-stream;q=0.9, */*;q=0.8",
        referer: `${SOURCE.indexUrl}/${reviewSheetYear ?? ""}`,
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/127 Safari/537.36 meti-funding-watch/0.1",
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length >= 4 && buffer.subarray(0, 4).toString("hex") === "504b0304") return buffer;
      lastError = new Error(`${label}: ZIPではない応答を受信しました（${response.headers.get("content-type") || "content-type不明"}）`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1_500));
  }
  throw lastError ?? new Error(`${label}: 公式ZIPを取得できませんでした`);
}
function validate(programs, payments, receipts) {
  if (!programs.length || !payments.length) throw new Error("行政事業レビューの出力が空です");
  if (new Set(programs.map((row) => row.id)).size !== programs.length) throw new Error("行政事業レビュー事業IDが重複しています");
  if (new Set(payments.map((row) => row.id)).size !== payments.length) throw new Error("行政事業レビュー支出先IDが重複しています");
  for (const row of payments) {
    if ((row.amount !== null && !Number.isSafeInteger(row.amount)) || !AMOUNT_STATUSES.includes(row.amountStatus)
      || !FLOW_LEVELS.includes(row.flowLevel) || (row.route !== null && !Array.isArray(row.route))
      || !row.sourceUrl.startsWith("https://")) throw new Error(`行政事業レビュー支出先明細が不正です: ${row.id}`);
    if (row.flowLevel === "unclassified" && row.flowDepth === null && (row.route !== null || row.sourceAgency !== null)) {
      throw new Error(`経路根拠がない支出先に経路または支出元が設定されています: ${row.id}`);
    }
    if (row.corporateNumber && !/^\d{13}$/.test(row.corporateNumber)) throw new Error(`行政事業レビュー法人番号が不正です: ${row.id}`);
  }
  for (const receipt of receipts) if (!/^[0-9a-f]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) throw new Error(`行政事業レビュー原資料receiptが不正です: ${receipt.filename}`);
}
