import { mkdir, readFile, writeFile } from "node:fs/promises";

const MIN_FISCAL_YEAR = 2017;
const EXCLUDED_EXECUTORS = new Set([
  "hokkaido", "tohoku", "kanto", "chubu", "kansai", "chugoku", "shikoku", "kyushu", "okinawa",
]);
const SOURCE_ORDER = ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"];

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
const nedo = JSON.parse(await readFile("data/official-supplement-nedo.json", "utf8"));
const nedoPublic = await readOptionalJson("data/official-supplement-nedo-public-results.json", {
  schemaVersion: 1,
  id: "nedo-public-results",
  name: "NEDO 公募結果・実施予定先",
  generatedAt: null,
  coverageNote: "NEDO公募結果の歴史データは未生成。",
  records: [],
});
const jetro = JSON.parse(await readFile("data/official-supplement-jetro.json", "utf8"));
const aist = JSON.parse(await readFile("data/official-supplement-aist.json", "utf8"));
const inpit = JSON.parse(await readFile("data/official-supplement-inpit.json", "utf8"));
const nite = JSON.parse(await readFile("data/official-supplement-nite.json", "utf8"));
const ipa = JSON.parse(await readFile("data/official-supplement-ipa.json", "utf8"));
const rieti = JSON.parse(await readFile("data/official-supplement-rieti.json", "utf8"));
const centralHistory = JSON.parse(await readFile("data/official-central-history.json", "utf8"));
const metiLegacy = await readOptionalJson("data/official-meti-legacy-records.json", { schemaVersion: 1, recordCount: 0, records: [] });

if (officialManifest.schemaVersion !== 1 || !officialManifest.files || typeof officialManifest.files !== "object") throw new Error("機関公表資料manifestの形式が不正です");
if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) throw new Error("公式補足シードの形式が不正です");
for (const source of [nedo, nedoPublic, jetro, aist, inpit, nite, ipa, rieti]) {
  if (source.schemaVersion !== 1 || !source.id || !Array.isArray(source.records)) throw new Error(`${source.name ?? source.id ?? "追加公式補足"}の形式が不正です`);
}
if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");
if (nedoPublic.id !== "nedo-public-results") throw new Error("NEDO公募結果補足のIDが不正です");
if (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");
if (aist.id !== "aist") throw new Error("産総研公式補足のIDが不正です");
if (inpit.id !== "inpit") throw new Error("INPIT公式補足のIDが不正です");
if (nite.id !== "nite") throw new Error("NITE公式補足のIDが不正です");
if (ipa.id !== "ipa") throw new Error("IPA公式補足のIDが不正です");
if (rieti.id !== "rieti") throw new Error("RIETI公式補足のIDが不正です");

const seedSources = [nedo, ...seeds.sources.filter((source) => source.id !== "nedo"), jetro, aist, inpit, nite, ipa, rieti];
if (
  centralHistory.schemaVersion !== 1
  || !Array.isArray(centralHistory.documents)
  || !Array.isArray(centralHistory.records)
  || centralHistory.records.length !== 599
) throw new Error("中央機関旧公式資料の形式または検証済み行数が不正です");
if (
  metiLegacy.schemaVersion !== 1
  || !Array.isArray(metiLegacy.records)
  || metiLegacy.recordCount !== metiLegacy.records.length
  || ![0, 3598].includes(metiLegacy.recordCount)
) throw new Error("本省旧公式資料の静的索引が不正です");

const officialFiles = Object.entries(officialManifest.files)
  .filter(([year]) => Number(year) >= MIN_FISCAL_YEAR)
  .map(([, filename]) => filename);
const officialRows = (await Promise.all(officialFiles.map(async (filename) => JSON.parse(await readFile(`data/official/${filename}`, "utf8"))))).flat();

function normalizeSearch(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/g, "株式会社")
    .replace(/\(有\)|㈲/g, "有限会社")
    .replace(/[\s　]+/g, " ")
    .toLocaleLowerCase("ja-JP")
    .trim();
}
function validAmount(value) { return typeof value === "number" && Number.isSafeInteger(value); }
function validCorporateNumber(value) { return typeof value === "string" && /^\d{13}$/.test(value); }
function validHttps(value) { return typeof value === "string" && value.startsWith("https://"); }
function fiscalYearsFor(sourceId, rows) {
  return [...new Set(rows.filter((row) => row.sourceId === sourceId).map((row) => row.fiscalYear))]
    .filter((year) => Number.isSafeInteger(year)).sort((a, b) => a - b);
}
function normalizeOrganizations(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((name) => String(name ?? "").trim()).filter(Boolean))];
}
function amountIsValidForRow(row) {
  if (row.category === "implementation_selected") return row.amount === null && row.amountStage === "個社金額の公表なし";
  return validAmount(row.amount);
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
    || !amountIsValidForRow(row)
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
const governmentRecords = officialRows.map((row) => normalizeOfficialRow(row, "official-company-", row.executorId, row.executorName || executorMetadata[row.executorId]?.name)).filter(Boolean);
const legacyMetiRecords = metiLegacy.records.map((row) => normalizeOfficialRow(row, "official-company-meti-legacy-", "meti", "経済産業省（本省）")).filter(Boolean);
const centralHistoryRecords = centralHistory.records.map((row) => normalizeOfficialRow(row, "official-company-central-", row.sourceId, row.sourceName)).filter(Boolean);
const seedRecords = seedSources.flatMap((source) => {
  if (!["nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"].includes(source.id)) throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
  return source.records.map((row) => normalizeOfficialRow({ ...row, sourceId: source.id, sourceName: source.name }, `official-company-${source.id}-`, source.id, source.name)).filter(Boolean);
});
const nedoParticipationRecords = nedoPublic.records.map((row) => normalizeOfficialRow(
  { ...row, sourceId: "nedo", sourceName: "NEDO" },
  "official-company-nedo-public-",
  "nedo",
  "NEDO",
)).filter(Boolean);
if (nedoParticipationRecords.length !== nedoPublic.records.length) throw new Error("NEDO公募結果の企業索引化で行が欠落しました");

const records = [...governmentRecords, ...legacyMetiRecords, ...centralHistoryRecords, ...seedRecords, ...nedoParticipationRecords]
  .sort((a, b) =>
    (b.fiscalYear ?? -1) - (a.fiscalYear ?? -1)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || (b.amount ?? -1) - (a.amount ?? -1)
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
    coverageNote = `対象方針は2017年度以降。企業検索では${fiscalYears.join("・")}年度の検証済み本省資料を使用。契約結果: ${contractStatus}／交付決定: ${grantStatus}`;
  } else if (["anre", "smea", "jpo"].includes(id)) {
    const contractStatus = metadata?.contractResults?.status ?? "契約結果の収録状況不明";
    const grantStatus = metadata?.grantDecisions?.status ?? "交付決定の収録状況不明";
    coverageNote = `対象方針は2017年度以降。現在この索引で確認済みなのは${fiscalYears.join("・")}年度の公表資料です。契約結果: ${contractStatus}／交付決定: ${grantStatus}`;
  } else if (id === "nedo") {
    coverageNote = `2017・2018年度の旧契約結果、金額を確認できるDTSU/GX交付決定、ならびに2017～2025年度の年度別公募結果から確認した実施予定先・委託予定先・助成予定先・採択先を収録。個社金額が公表されていない参加確認行は金額不明のまま保持し、事業総額等を割り当てない。${nedoPublic.records.length ? nedoPublic.coverageNote : ""}`;
  } else if (id === "smrj") {
    coverageNote = `中小機構本部の2017～2019年度競争入札・随意契約公式PDFから検証できた行を追加。${seed?.coverageNote ?? ""} 地域本部等を含む全契約の網羅データではありません。`;
  } else {
    coverageNote = seed?.coverageNote ?? `${name}の確認済み公表情報のみを収録。全入札・全契約を網羅しません。`;
  }
  sourceNotes.set(id, { id, name, fiscalYears, recordCount: sourceRows.length, coverageNote });
}

const sources = SOURCE_ORDER.filter((id) => sourceNotes.has(id)).map((id) => sourceNotes.get(id));
const generatedCandidates = [
  officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, nedoPublic.generatedAt, jetro.updatedAt, aist.updatedAt,
  inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt, centralHistory.generatedAt, metiLegacy.verifiedAt,
].filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
const generatedAt = generatedCandidates.length ? new Date(Math.max(...generatedCandidates)).toISOString() : officialManifest.generatedAt;

const output = {
  schemaVersion: 1,
  generatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  recordCount: records.length,
  sourceCount: sources.length,
  excludedExecutors: [...EXCLUDED_EXECUTORS],
  scopeNote: "企業検索用の公式資料索引。2017年度以降を対象方針とし、13機関の検証済み公表資料を使用する。NEDOは2017～2025年度の年度別公募結果から、個社金額が公表されていない実施予定先等も参加確認行として収録する。金額不明行に事業総額・上限額を割り当てない。地方経済産業局・沖縄総合事務局は企業検索の対象外。機関・年度・制度ごとに実際の収録範囲は異なり、全支出を網羅するものではない。GビズINFO掲載値、行政事業レビュー支出額、公式資料の金額は相互に合算しない。",
  sources,
  records,
};

await mkdir("public/data", { recursive: true });
await writeFile("public/data/official-company-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official company index: ${records.length} records / ${sources.length} sources / central-history ${centralHistoryRecords.length} / legacy-METI ${legacyMetiRecords.length}`);
