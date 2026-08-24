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
const SOURCE_ORDER = ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite"];

async function readOptionalJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const officialManifest = JSON.parse(await readFile("data/official/manifest.json", "utf8"));
const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));
const jetro = JSON.parse(await readFile("data/official-supplement-jetro.json", "utf8"));
const aist = JSON.parse(await readFile("data/official-supplement-aist.json", "utf8"));
const inpit = JSON.parse(await readFile("data/official-supplement-inpit.json", "utf8"));
const nite = JSON.parse(await readFile("data/official-supplement-nite.json", "utf8"));
const centralHistory = JSON.parse(await readFile("data/official-central-history.json", "utf8"));
const metiLegacy = await readOptionalJson("data/official-meti-legacy-records.json", {
  schemaVersion: 1,
  recordCount: 0,
  records: [],
});

if (officialManifest.schemaVersion !== 1 || !officialManifest.files || typeof officialManifest.files !== "object") {
  throw new Error("機関公表資料manifestの形式が不正です");
}
if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) {
  throw new Error("公式補足シードの形式が不正です");
}
for (const source of [jetro, aist, inpit, nite]) {
  if (source.schemaVersion !== 1 || !source.id || !Array.isArray(source.records)) {
    throw new Error(`${source.name ?? source.id ?? "追加公式補足"}の形式が不正です`);
  }
}
if (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");
if (aist.id !== "aist") throw new Error("産総研公式補足のIDが不正です");
if (inpit.id !== "inpit") throw new Error("INPIT公式補足のIDが不正です");
if (nite.id !== "nite") throw new Error("NITE公式補足のIDが不正です");
const seedSources = [...seeds.sources, jetro, aist, inpit, nite];
if (
  centralHistory.schemaVersion !== 1
  || !Array.isArray(centralHistory.documents)
  || !Array.isArray(centralHistory.records)
  || centralHistory.records.length !== centralHistory.records.length
  || centralHistory.records.length !== 599
) {
  throw new Error("中央機関旧公式資料の形式または検証済み行数が不正です");
}
if (
  metiLegacy.schemaVersion !== 1
  || !Array.isArray(metiLegacy.records)
  || metiLegacy.recordCount !== metiLegacy.records.length
  || ![0, 3598].includes(metiLegacy.recordCount)
) {
  throw new Error("本省旧公式資料の静的索引が不正です");
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
function fiscalYearsFor(sourceId, rows) {
  return [...new Set(rows.filter((row) => row.sourceId === sourceId).map((row) => row.fiscalYear))]
    .filter((year) => Number.isSafeInteger(year))
    .sort((a, b) => a - b);
}
function normalizeOrganizations(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((name) => String(name ?? "").trim()).filter(Boolean))];
}

function normalizeOfficialRow(row, idPrefix, fallbackSourceId = null, fallbackSourceName = null) {
  const sourceId = row.sourceId ?? row.executorId ?? fallbackSourceId;
  const sourceName = row.sourceName ?? row.executorName ?? fallbackSourceName ?? sourceId;
  const sourceUrl = row.sourceUrl ?? row.sourceDocumentUrl ?? row.sourcePageUrl;
  const sourcePageUrl = row.sourcePageUrl ?? row.sourceUrl ?? row.sourceDocumentUrl;
  if (
    !SOURCE_ORDER.includes(sourceId)
    || EXCLUDED_EXECUTORS.has(sourceId)
    || Number(row.fiscalYear) < MIN_FISCAL_YEAR
    || !validAmount(row.amount)
    || !row.organization
    || !validHttps(sourceUrl)
  ) return null;
  const corporateNumber = validCorporateNumber(row.corporateNumber) ? row.corporateNumber : "";
  const organizations = normalizeOrganizations(row.organizations);
  return {
    id: `${idPrefix}${row.id}`,
    sourceId,
    sourceName,
    organization: row.organization,
    organizations,
    corporateNumber,
    fiscalYear: row.fiscalYear,
    date: row.date ?? null,
    program: row.program ?? "",
    theme: row.theme ?? "",
    phase: row.phase ?? "",
    supportYears: row.supportYears ?? "",
    category: row.category,
    amountStage: row.amountStage || (row.category === "grant_decision" ? "交付決定額" : "契約額"),
    amount: row.amount,
    sourceUrl,
    sourcePageUrl,
    sourceKey: row.sourceKey ?? row.id,
    searchText: normalizeSearch([row.organization, ...organizations, corporateNumber].filter(Boolean).join(" ")),
  };
}

const executorMetadata = officialManifest.coverage?.executors ?? {};
const governmentRecords = officialRows
  .map((row) => normalizeOfficialRow(
    row,
    "official-company-",
    row.executorId,
    row.executorName || executorMetadata[row.executorId]?.name,
  ))
  .filter(Boolean);

const legacyMetiRecords = metiLegacy.records
  .map((row) => normalizeOfficialRow(row, "official-company-meti-legacy-", "meti", "経済産業省（本省）"))
  .filter(Boolean);

const centralHistoryRecords = centralHistory.records
  .map((row) => normalizeOfficialRow(row, "official-company-central-", row.sourceId, row.sourceName))
  .filter(Boolean);

const seedRecords = seedSources.flatMap((source) => {
  if (!["nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite"].includes(source.id)) throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
  if (!Array.isArray(source.records)) throw new Error(`${source.id}: recordsが配列ではありません`);
  return source.records.map((row) => normalizeOfficialRow(
    { ...row, sourceId: source.id, sourceName: source.name },
    `official-company-${source.id}-`,
    source.id,
    source.name,
  )).filter(Boolean);
});

const records = [...governmentRecords, ...legacyMetiRecords, ...centralHistoryRecords, ...seedRecords]
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
if (centralHistoryRecords.length !== 599) throw new Error(`中央機関旧資料の企業索引行数が不正です: ${centralHistoryRecords.length}/599`);
if (metiLegacy.recordCount && legacyMetiRecords.length !== 3598) throw new Error(`本省旧資料の企業索引行数が不正です: ${legacyMetiRecords.length}/3598`);

const seedById = new Map(seedSources.map((source) => [source.id, source]));
const sourceNotes = new Map();
for (const id of SOURCE_ORDER) {
  const sourceRows = records.filter((row) => row.sourceId === id);
  if (!sourceRows.length) continue;
  const fiscalYears = fiscalYearsFor(id, records);
  const metadata = executorMetadata[id];
  const seed = seedById.get(id);
  const name = metadata?.name ?? seed?.name ?? sourceRows[0].sourceName ?? id;
  let coverageNote;

  if (id === "meti") {
    const contractStatus = metadata?.contractResults?.status ?? "契約結果の収録状況不明";
    const grantStatus = metadata?.grantDecisions?.status ?? "交付決定の収録状況不明";
    coverageNote = `対象方針は2017年度以降。企業検索では${fiscalYears.join("・")}年度の検証済み本省資料を使用。2017～2021年度の旧資料はWARP Full GET・SHA-256・厳格パースで固定した資料のみ追加。契約結果: ${contractStatus}／交付決定: ${grantStatus}`;
  } else if (["anre", "smea", "jpo"].includes(id)) {
    const contractStatus = metadata?.contractResults?.status ?? "契約結果の収録状況不明";
    const grantStatus = metadata?.grantDecisions?.status ?? "交付決定の収録状況不明";
    coverageNote = `対象方針は2017年度以降。現在この索引で確認済みなのは${fiscalYears.join("・")}年度の公表資料です。契約結果: ${contractStatus}／交付決定: ${grantStatus}`;
  } else if (id === "nedo") {
    coverageNote = `2017・2018年度の「競争性のない随意契約」公式PDFから、単一受取先・契約日・契約金額を一意に検証できた22行を追加。${seed?.coverageNote ?? ""} NEDO全事業・全契約の網羅データではありません。`;
  } else if (id === "smrj") {
    coverageNote = `中小機構本部の2017～2019年度競争入札・随意契約公式PDFから、単一法人番号・契約日・契約金額を一意に検証できた577行を追加。${seed?.coverageNote ?? ""} 地域本部等を含む全契約の網羅データではありません。`;
  } else {
    coverageNote = seed?.coverageNote ?? `${name}の確認済み公表情報のみを収録。全入札・全契約を網羅しません。`;
  }
  sourceNotes.set(id, { id, name, fiscalYears, recordCount: sourceRows.length, coverageNote });
}

const sources = SOURCE_ORDER.filter((id) => sourceNotes.has(id)).map((id) => sourceNotes.get(id));
const generatedCandidates = [officialManifest.generatedAt, seeds.updatedAt, jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt]
  .filter(Boolean)
  .map((value) => new Date(value).getTime())
  .filter(Number.isFinite);
const generatedAt = generatedCandidates.length
  ? new Date(Math.max(...generatedCandidates)).toISOString()
  : officialManifest.generatedAt;

const output = {
  schemaVersion: 1,
  generatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  recordCount: records.length,
  sourceCount: sources.length,
  excludedExecutors: [...EXCLUDED_EXECUTORS],
  scopeNote: "企業検索用の公式資料索引。2017年度以降を対象方針とし、経済産業省本省、資源エネルギー庁、中小企業庁、特許庁、NEDO、中小企業基盤整備機構、JOGMEC、JETRO、産業技術総合研究所、工業所有権情報・研修館（INPIT）、製品評価技術基盤機構（NITE）の検証済み公表資料だけを使用する。地方経済産業局・沖縄総合事務局は企業検索の対象外。機関ごと・年度ごとに実際の収録範囲は異なり、2017年度以降の全年度・全制度・全契約を網羅するものではない。ここで見つからないことは支出がないことを意味しない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",
  sources,
  records,
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/official-company-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official company index: ${records.length} records / ${sources.length} sources / central-history ${centralHistoryRecords.length} / legacy-METI ${legacyMetiRecords.length}`);
