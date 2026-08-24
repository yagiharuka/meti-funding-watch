import { readFile, writeFile } from "node:fs/promises";

const MIN_FISCAL_YEAR = 2017;
const OFFICIAL_SUPPLEMENT_EXECUTORS = ["meti", "anre", "smea", "jpo"];
const OFFICIAL_SUPPLEMENT_NAMES = {
  meti: "経済産業省本省",
  anre: "資源エネルギー庁",
  smea: "中小企業庁",
  jpo: "特許庁",
};

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

if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) throw new Error("公式補足シードの形式が不正です");
for (const source of [nedo, nedoPublic, jetro, aist, inpit, nite, ipa, rieti]) {
  if (source.schemaVersion !== 1 || !source.id || !Array.isArray(source.records)) {
    throw new Error(`${source.name ?? source.id ?? "追加公式補足"}の形式が不正です`);
  }
}
if (nedo.id !== "nedo") throw new Error("NEDO公式補足のIDが不正です");
if (nedoPublic.id !== "nedo-public-results") throw new Error("NEDO公募結果補足のIDが不正です");
if (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");
if (aist.id !== "aist") throw new Error("産総研公式補足のIDが不正です");
if (inpit.id !== "inpit") throw new Error("INPIT公式補足のIDが不正です");
if (nite.id !== "nite") throw new Error("NITE公式補足のIDが不正です");
if (ipa.id !== "ipa") throw new Error("IPA公式補足のIDが不正です");
if (rieti.id !== "rieti") throw new Error("RIETI公式補足のIDが不正です");

const seedSources = [
  nedo,
  ...seeds.sources.filter((source) => source.id !== "nedo"),
  jetro,
  aist,
  inpit,
  nite,
  ipa,
  rieti,
];

const officialFiles = Object.entries(officialManifest.files ?? {})
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
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value);
}
function validCorporateNumber(value) {
  return typeof value === "string" && /^\d{13}$/.test(value);
}
function validHttps(value) {
  return typeof value === "string" && value.startsWith("https://");
}

const officialSupplementRecords = officialRows
  .filter((row) => OFFICIAL_SUPPLEMENT_EXECUTORS.includes(row.executorId)
    && Number(row.fiscalYear) >= MIN_FISCAL_YEAR
    && validAmount(row.amount)
    && row.organization)
  .map((row) => ({
    id: `${row.executorId}-${row.id}`,
    sourceId: row.executorId,
    sourceName: OFFICIAL_SUPPLEMENT_NAMES[row.executorId],
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
  }));

const seedRecords = seedSources.flatMap((source) => {
  if (!["nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"].includes(source.id)) {
    throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
  }
  return source.records.map((row) => {
    if (!row.id || !row.organization || !validAmount(row.amount) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !validHttps(row.sourceUrl)) {
      throw new Error(`${source.id}: 公式補足シード明細が不正です: ${row.id ?? "(idなし)"}`);
    }
    return {
      ...row,
      sourceId: source.id,
      sourceName: source.name,
      corporateNumber: validCorporateNumber(row.corporateNumber) ? row.corporateNumber : "",
      date: row.date ?? null,
      program: row.program ?? "",
      theme: row.theme ?? "",
      phase: row.phase ?? "",
      supportYears: row.supportYears ?? "",
      sourcePageUrl: row.sourcePageUrl ?? row.sourceUrl,
      sourceKey: row.sourceKey ?? row.id,
    };
  });
});

const nedoParticipationRecords = nedoPublic.records.map((row) => {
  if (
    !row.id
    || !row.organization
    || Number(row.fiscalYear) < 2017
    || Number(row.fiscalYear) > 2025
    || row.category !== "implementation_selected"
    || row.amount !== null
    || row.amountStage !== "個社金額の公表なし"
    || !validHttps(row.sourceUrl)
    || !validHttps(row.sourcePageUrl)
  ) {
    throw new Error(`NEDO公募結果明細が不正です: ${row.id ?? "(idなし)"}`);
  }
  return {
    ...row,
    sourceId: "nedo",
    sourceName: "NEDO",
    corporateNumber: validCorporateNumber(row.corporateNumber) ? row.corporateNumber : "",
    date: row.date ?? null,
    program: row.program ?? "",
    theme: row.theme ?? "",
    phase: row.phase ?? "",
    supportYears: row.supportYears ?? "",
    sourceKey: row.sourceKey ?? row.id,
  };
});

const records = [...officialSupplementRecords, ...seedRecords, ...nedoParticipationRecords]
  .map((row) => ({
    ...row,
    searchText: normalizeSearch([row.organization, row.corporateNumber].filter(Boolean).join(" ")),
  }))
  .sort((a, b) =>
    (b.fiscalYear ?? -1) - (a.fiscalYear ?? -1)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || (b.amount ?? -1) - (a.amount ?? -1)
    || a.organization.localeCompare(b.organization, "ja"));

const ids = new Set();
for (const row of records) {
  if (ids.has(row.id)) throw new Error(`公式補足IDが重複しています: ${row.id}`);
  ids.add(row.id);
}

const officialSourceNotes = Object.fromEntries(OFFICIAL_SUPPLEMENT_EXECUTORS.map((id) => [id, {
  id,
  name: OFFICIAL_SUPPLEMENT_NAMES[id],
  coverageNote: `既存の機関公表資料キャッシュのうち、2017年度以降に取得・検証できた${OFFICIAL_SUPPLEMENT_NAMES[id]}の契約結果・補助金等交付決定で金額を確認できた行を表示。収録開始年度・区分は機関ごとに異なり、全公表の網羅を主張しない。`,
}]));
const sourceNotes = {
  ...officialSourceNotes,
  ...Object.fromEntries(seedSources.map((source) => [source.id, {
    id: source.id,
    name: source.name,
    coverageNote: source.coverageNote,
  }])),
};
if (nedoPublic.records.length) {
  sourceNotes.nedo = {
    id: "nedo",
    name: "NEDO",
    coverageNote: `${nedo.coverageNote} ${nedoPublic.coverageNote}`,
  };
}

const sourceOrder = ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"];
const sources = sourceOrder.map((id) => ({
  ...sourceNotes[id],
  recordCount: records.filter((row) => row.sourceId === id).length,
}));

const output = {
  schemaVersion: 1,
  generatedAt: [
    officialManifest.generatedAt, seeds.updatedAt, nedo.updatedAt, nedoPublic.generatedAt,
    jetro.updatedAt, aist.updatedAt, inpit.updatedAt, nite.updatedAt, ipa.updatedAt, rieti.updatedAt,
  ].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  scopeNote: "公式補足は13機関について、2017年度以降に取得・内容を確認できた公表情報を表示する。金額が公表された契約・交付決定等と、NEDOで実施予定先・委託予定先・助成予定先・採択先まで確認できるが個社金額が公表されていない行を区別する。金額不明行に事業総額・上限額を割り当てず、GビズINFO掲載値や行政事業レビュー支出額とも合算しない。機関・年度・制度ごとに収録範囲は異なり、全公表・全支出の網羅を主張しない。",
  recordCount: records.length,
  sources,
  records,
};

await writeFile("data/official-supplement-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official supplement index: ${records.length} records (${sources.map((s) => `${s.name} ${s.recordCount}`).join(" / ")})`);
