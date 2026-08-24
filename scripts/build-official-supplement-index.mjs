import { readFile, writeFile } from "node:fs/promises";

const MIN_FISCAL_YEAR = 2021;
const OFFICIAL_SUPPLEMENT_EXECUTORS = ["meti", "anre", "smea", "jpo"];
const OFFICIAL_SUPPLEMENT_NAMES = {
  meti: "経済産業省本省",
  anre: "資源エネルギー庁",
  smea: "中小企業庁",
  jpo: "特許庁",
};
const officialManifest = JSON.parse(await readFile("data/official/manifest.json", "utf8"));
const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));
const jetro = JSON.parse(await readFile("data/official-supplement-jetro.json", "utf8"));
const aist = JSON.parse(await readFile("data/official-supplement-aist.json", "utf8"));

if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) {
  throw new Error("公式補足シードの形式が不正です");
}
for (const source of [jetro, aist]) {
  if (source.schemaVersion !== 1 || !source.id || !Array.isArray(source.records)) {
    throw new Error(`${source.name ?? source.id ?? "追加公式補足"}の形式が不正です`);
  }
}
if (jetro.id !== "jetro") throw new Error("JETRO公式補足のIDが不正です");
if (aist.id !== "aist") throw new Error("産総研公式補足のIDが不正です");
const seedSources = [...seeds.sources, jetro, aist];

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
  if (!["nedo", "smrj", "jogmec", "jetro", "aist"].includes(source.id)) throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
  if (!Array.isArray(source.records)) throw new Error(`${source.id}: recordsが配列ではありません`);
  return source.records.map((row) => {
    if (!row.id || !row.organization || !validAmount(row.amount) || Number(row.fiscalYear) < MIN_FISCAL_YEAR || !row.sourceUrl?.startsWith("https://")) {
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

const records = [...officialSupplementRecords, ...seedRecords]
  .map((row) => ({
    ...row,
    searchText: normalizeSearch([row.organization, row.corporateNumber].filter(Boolean).join(" ")),
  }))
  .sort((a, b) =>
    (b.fiscalYear ?? -1) - (a.fiscalYear ?? -1)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || b.amount - a.amount
    || a.organization.localeCompare(b.organization, "ja"));

const ids = new Set();
for (const row of records) {
  if (ids.has(row.id)) throw new Error(`公式補足IDが重複しています: ${row.id}`);
  ids.add(row.id);
}

const officialSourceNotes = Object.fromEntries(OFFICIAL_SUPPLEMENT_EXECUTORS.map((id) => [id, {
  id,
  name: OFFICIAL_SUPPLEMENT_NAMES[id],
  coverageNote: `既存の機関公表資料キャッシュのうち、2021年度以降の${OFFICIAL_SUPPLEMENT_NAMES[id]}の契約結果・補助金等交付決定で金額を確認できた行を表示。収録開始年度・区分は機関ごとに異なり、全公表の網羅を主張しない。`,
}]));
const sourceNotes = {
  ...officialSourceNotes,
  ...Object.fromEntries(seedSources.map((source) => [source.id, {
    id: source.id,
    name: source.name,
    coverageNote: source.coverageNote,
  }])),
};

const sourceOrder = ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist"];
const sources = sourceOrder.map((id) => ({
  ...sourceNotes[id],
  recordCount: records.filter((row) => row.sourceId === id).length,
}));

const output = {
  schemaVersion: 1,
  generatedAt: [officialManifest.generatedAt, seeds.updatedAt, jetro.updatedAt, aist.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  scopeNote: "公式補足は、経済産業省本省・資源エネルギー庁・中小企業庁・特許庁・NEDO・中小企業基盤整備機構・JOGMEC・JETRO・産業技術総合研究所について、2021年度以降を基本対象とし、受取先と金額を確認できた公表情報だけを表示する。機関ごとに実際の収録開始年度は異なる。各機関の全制度・全契約を網羅するものではなく、GビズINFO掲載値や行政事業レビュー支出額とは合算しない。",
  recordCount: records.length,
  sources,
  records,
};

await writeFile("data/official-supplement-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official supplement index: ${records.length} records (${sources.map((s) => `${s.name} ${s.recordCount}`).join(" / ")})`);
