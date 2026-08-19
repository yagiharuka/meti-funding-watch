import { readFile, writeFile } from "node:fs/promises";

const MIN_FISCAL_YEAR = 2024;
const officialManifest = JSON.parse(await readFile("data/official/manifest.json", "utf8"));
const seeds = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));

if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) {
  throw new Error("公式補足シードの形式が不正です");
}

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

const metiRecords = officialRows
  .filter((row) => row.executorId === "meti" && Number(row.fiscalYear) >= MIN_FISCAL_YEAR && validAmount(row.amount) && row.organization)
  .map((row) => ({
    id: `meti-${row.id}`,
    sourceId: "meti",
    sourceName: "経済産業省本省",
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

const seedRecords = seeds.sources.flatMap((source) => {
  if (!["nedo", "smrj"].includes(source.id)) throw new Error(`公式補足シードに未許可の機関があります: ${source.id}`);
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

const records = [...metiRecords, ...seedRecords]
  .map((row) => ({
    ...row,
    searchText: normalizeSearch([
      row.organization,
      row.corporateNumber,
      row.program,
      row.theme,
      row.sourceName,
    ].filter(Boolean).join(" ")),
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

const sourceNotes = {
  meti: {
    id: "meti",
    name: "経済産業省本省",
    coverageNote: "既存の機関公表資料キャッシュのうち、2024年度以降の経済産業省本省の契約結果・補助金等交付決定で金額を確認できた行を表示。機関公表資料自体は手動更新の照合系列であり、全公表の網羅を主張しない。",
  },
  ...Object.fromEntries(seeds.sources.map((source) => [source.id, {
    id: source.id,
    name: source.name,
    coverageNote: source.coverageNote,
  }])),
};

const sourceOrder = ["meti", "nedo", "smrj"];
const sources = sourceOrder.map((id) => ({
  ...sourceNotes[id],
  recordCount: records.filter((row) => row.sourceId === id).length,
}));

const output = {
  schemaVersion: 1,
  generatedAt: [officialManifest.generatedAt, seeds.updatedAt].filter(Boolean).sort().at(-1) ?? seeds.updatedAt,
  minFiscalYear: MIN_FISCAL_YEAR,
  scopeNote: seeds.scopeNote,
  recordCount: records.length,
  sources,
  records,
};

await writeFile("data/official-supplement-index.json", `${JSON.stringify(output)}\n`);
console.log(`Official supplement index: ${records.length} records (${sources.map((s) => `${s.name} ${s.recordCount}`).join(" / ")})`);
