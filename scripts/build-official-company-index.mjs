import { mkdir, readFile, writeFile } from "node:fs/promises";

const MIN_FISCAL_YEAR = 2017;
const EXCLUDED_EXECUTORS = new Set([
  "hokkaido",
  "tohoku",
  "kanto",
  "chubu",
  "kansai",
  "chugoku",
  "shikoku",
  "kyushu",
  "okinawa",
]);
const SOURCE_ORDER = [
  "meti",
  "anre",
  "smea",
  "jpo",
  "nedo",
  "smrj",
];

const officialManifest = JSON.parse(await readFile("data/official/manifest.json", "utf8"));
const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));

if (officialManifest.schemaVersion !== 1 || !officialManifest.files || typeof officialManifest.files !== "object") {
  throw new Error("機関公表資料manifestの形式が不正です");
}
if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) {
  throw new Error("公式補足シードの形式が不正です");
}

const officialFiles = Object.entries(officialManifest.files)
  .filter(([year]) => Number(year) >= MIN_FISCAL_YEAR)
  .map(([, filename]) => filename);
const officialRows = (await Promise.all(officialFiles.map(async (filename) =>
  JSON.parse(await readFile(`data/official/${filename}`, "utf8")),
))).flat();

function normalizeSearch(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/g, "株式会社")
    .replace(/\(有\)|㈲/g, "有限会社")
    .replace(/[\s　]+/g, " ")
    .toLocaleLowerCase("ja-JP")
    .trim();
}

function validAmount(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validCorporateNumber(value) {
  return typeof value === "string" && /^\d{13}$/.test(value);
}

function validHttps(value) {
  return typeof value === "string" && value.startsWith("https://");
}

const executorMetadata = officialManifest.coverage?.executors ?? {};
const governmentRecords = officialRows
  .filter((row) =>
    SOURCE_ORDER.includes(row.executorId)
    && !EXCLUDED_EXECUTORS.has(row.executorId)
    && Number(row.fiscalYear) >= MIN_FISCAL_YEAR
    && validAmount(row.amount)
    && row.organization
    && validHttps(row.sourceDocumentUrl || row.sourcePageUrl))
  .map((row) => ({
    id: `official-company-${row.id}`,
    sourceId: row.executorId,
    sourceName: row.executorName || executorMetadata[row.executorId]?.name || row.executorId,
    organization: row.organization,
    corporateNumber: validCorporateNumber(row.corporateNumber) ? row.corporateNumber : "",
    fiscalYear: row.fiscalYear,
    date: row.date ?? null,
    program: row.program ?? "",
    theme: "",
    phase: "",
    supportYears: "",
    category: row.category,
    amountStage: row.amountStage || (row.category === "grant_decision" ? "交付決定額" : "契約額"),
    amount: row.amount,
    sourceUrl: row.sourceDocumentUrl || row.sourcePageUrl,
    sourcePageUrl: row.sourcePageUrl || row.sourceDocumentUrl,
    sourceKey: row.sourceKey,
    searchText: normalizeSearch([row.organization, validCorporateNumber(row.corporateNumber) ? row.corporateNumber : ""].filter(Boolean).join(" ")),
  }));

const seedRecords = seeds.sources.flatMap((source) => {
  if (!["nedo", "smrj"].includes(source.id)) throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
  if (!Array.isArray(source.records)) throw new Error(`${source.id}: recordsが配列ではありません`);
  return source.records.map((row) => {
    if (
      !row.id
      || !row.organization
      || !validAmount(row.amount)
      || Number(row.fiscalYear) < MIN_FISCAL_YEAR
      || !validHttps(row.sourceUrl)
    ) {
      throw new Error(`${source.id}: 公式補足シード明細が不正です: ${row.id ?? "(idなし)"}`);
    }
    const corporateNumber = validCorporateNumber(row.corporateNumber) ? row.corporateNumber : "";
    return {
      ...row,
      id: `official-company-${source.id}-${row.id}`,
      sourceId: source.id,
      sourceName: source.name,
      corporateNumber,
      date: row.date ?? null,
      program: row.program ?? "",
      theme: row.theme ?? "",
      phase: row.phase ?? "",
      supportYears: row.supportYears ?? "",
      sourcePageUrl: row.sourcePageUrl ?? row.sourceUrl,
      sourceKey: row.sourceKey ?? row.id,
      searchText: normalizeSearch([row.organization, corporateNumber].filter(Boolean).join(" ")),
    };
  });
});

const records = [...governmentRecords, ...seedRecords]
  .sort((a, b) =>
    (b.fiscalYear ?? -1) - (a.fiscalYear ?? -1)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || b.amount - a.amount
    || a.organization.localeCompare(b.organization, "ja"));

const ids = new Set();
for (const row of records) {
  if (ids.has(row.id)) throw new Error(`公式企業索引IDが重複しています: ${row.id}`);
  ids.add(row.id);
}

const sourceNotes = new Map();
for (const [id, metadata] of Object.entries(executorMetadata)) {
  if (!SOURCE_ORDER.includes(id) || EXCLUDED_EXECUTORS.has(id)) continue;
  const count = records.filter((row) => row.sourceId === id).length;
  if (!count) continue;
  const fiscalYears = Array.isArray(metadata.fiscalYears)
    ? metadata.fiscalYears.filter((year) => Number(year) >= MIN_FISCAL_YEAR)
    : [];
  const contractStatus = metadata.contractResults?.status ?? "契約結果の収録状況不明";
  const grantStatus = metadata.grantDecisions?.status ?? "交付決定の収録状況不明";
  const actualYears = fiscalYears.length ? fiscalYears.join("・") : "確認済み年度";
  sourceNotes.set(id, {
    id,
    name: metadata.name,
    fiscalYears,
    recordCount: count,
    coverageNote: `対象方針は2017年度以降。現在この索引で確認済みなのは${actualYears}年度の公表資料です。契約結果: ${contractStatus}／交付決定: ${grantStatus}`,
  });
}
for (const source of seeds.sources) {
  const count = records.filter((row) => row.sourceId === source.id).length;
  if (!count) continue;
  sourceNotes.set(source.id, {
    id: source.id,
    name: source.name,
    fiscalYears: [...new Set(source.records.map((row) => row.fiscalYear))].sort((a, b) => a - b),
    recordCount: count,
    coverageNote: source.coverageNote,
  });
}

const sources = SOURCE_ORDER
  .filter((id) => sourceNotes.has(id))
  .map((id) => sourceNotes.get(id));

const output = {
  schemaVersion: 1,
  generatedAt: [officialManifest.generatedAt, seeds.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  recordCount: records.length,
  sourceCount: sources.length,
  excludedExecutors: [...EXCLUDED_EXECUTORS],
  scopeNote: "企業検索用の公式資料索引。2017年度以降を対象方針とし、経済産業省本省、資源エネルギー庁、中小企業庁、特許庁の既存検証済み公表資料と、NEDO・中小企業基盤整備機構の確認済み補足情報を使用する。地方経済産業局・沖縄総合事務局は企業検索の対象外。現時点では機関ごとに実際の収録開始年度が異なり、2017年度以降の全年度・全制度・全契約を網羅するものではない。ここで見つからないことは支出がないことを意味しない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",
  sources,
  records,
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/official-company-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official company index: ${records.length} records / ${sources.length} sources`);
