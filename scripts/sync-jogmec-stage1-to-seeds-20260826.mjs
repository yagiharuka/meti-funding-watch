import { readFile, writeFile } from "node:fs/promises";

const DATA_PATH = "data/official-supplement-jogmec.json";
const SEEDS_PATH = "data/official-supplement-seeds.json";

function validIndexAmount(row) {
  return (typeof row.amount === "number" && Number.isSafeInteger(row.amount) && row.amount >= 0)
    || (row.amount === null && row.category === "implementation_decision");
}

function sourceById(seeds, id) {
  const source = seeds.sources?.find((entry) => entry.id === id);
  if (!source) throw new Error(`公式補足シードに${id}がありません`);
  return source;
}

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const seeds = JSON.parse(await readFile(SEEDS_PATH, "utf8"));
if (data.schemaVersion !== 1 || data.id !== "jogmec" || !Array.isArray(data.records)) throw new Error("JOGMEC専用データの形式が不正です");
if (seeds.schemaVersion !== 1 || !Array.isArray(seeds.sources)) throw new Error("公式補足シードの形式が不正です");
const previous = sourceById(seeds, "jogmec");
if (!Array.isArray(previous.records)) throw new Error("JOGMEC既存シード明細がありません");

const merged = new Map();
for (const row of previous.records) merged.set(row.id, row);
for (const row of data.records) {
  if (!validIndexAmount(row)) continue;
  if (!row.id || !row.organization || !row.sourceUrl?.startsWith("https://")) throw new Error(`JOGMEC索引可能行が不正です: ${row.id ?? "(idなし)"}`);
  merged.set(row.id, row);
}
const records = [...merged.values()].sort((a, b) =>
  (b.fiscalYear ?? -1) - (a.fiscalYear ?? -1)
  || (b.date ?? "").localeCompare(a.date ?? "")
  || (b.amount ?? -1) - (a.amount ?? -1)
  || a.organization.localeCompare(b.organization, "ja"));
if (records.length < previous.records.length) throw new Error(`JOGMECシード件数が後退しました: ${records.length}/${previous.records.length}`);

const indexExcludedNullContractCount = data.records.filter((row) => row.amount === null && row.category !== "implementation_decision").length;
const updated = {
  ...previous,
  name: "JOGMEC",
  collectionStatus: data.collectionStatus,
  inventoryCandidateCount: data.inventoryCandidateCount,
  resultCandidateCount: data.resultCandidateCount,
  parsedDocumentCount: data.parsedDocumentCount,
  unparsedDocumentCount: data.unparsedDocumentCount,
  parseFailureCount: data.parseFailureCount,
  indexExcludedNullContractCount,
  coverageNote: `${data.scopeNote} 現行の公式補足索引には、数値金額を確認できた行と、採択・実施予定先で個社別金額がない行を収録する。契約金額非公表・単価等の${indexExcludedNullContractCount}行は0円化せず専用監査ファイルに保持し、索引側のnull契約額対応までは検索明細から除外する。`,
  records,
};
seeds.sources = seeds.sources.map((source) => source.id === "jogmec" ? updated : source);
seeds.updatedAt = new Date().toISOString();
await writeFile(SEEDS_PATH, `${JSON.stringify(seeds, null, 2)}\n`);
console.log(`JOGMEC seed sync: ${records.length} indexed / ${data.records.length} retained / ${indexExcludedNullContractCount} null contract rows audit-only`);
