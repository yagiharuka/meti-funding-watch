import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hasValidCorporateNumber } from "./gbiz-values.mjs";

const funding = JSON.parse(await readFile("data/funding-data.json", "utf8"));
const manifest = JSON.parse(await readFile("data/review-cache/manifest.json", "utf8"));
const reviewAll = (await Promise.all(manifest.paymentFiles.map(async (f) => JSON.parse(await readFile(`data/review-cache/${f}`, "utf8"))))).flat();

const corp = (row) => String(row.corporateNumber ?? "").replace(/\D/g, "");
const validCorp = (row) => {
  const v = corp(row);
  return v !== "9999999999999" && hasValidCorporateNumber(v);
};
const uniq = (rows) => new Set(rows.map(corp));

const gbizAllRows = (funding.records ?? []).filter(validCorp);
const gbiz2024Rows = gbizAllRows.filter((r) => r.fiscalYear === 2024);
const gbizUndatedRows = gbizAllRows.filter((r) => r.fiscalYear == null);
const reviewRows = reviewAll.filter((r) => r.reviewSheetYear === 2025 && validCorp(r));

const gbizAll = uniq(gbizAllRows);
const gbiz2024 = uniq(gbiz2024Rows);
const gbizUndated = uniq(gbizUndatedRows);
const review = uniq(reviewRows);
const reviewOnly = new Set([...review].filter((c) => !gbiz2024.has(c)));

const rowsByCorp = new Map();
for (const r of reviewRows) {
  const c = corp(r);
  const arr = rowsByCorp.get(c) ?? [];
  arr.push(r);
  rowsByCorp.set(c, arr);
}

const countIf = (predicate) => [...reviewOnly].filter((c) => predicate(rowsByCorp.get(c) ?? [], c)).length;
const direct = countIf((rows) => rows.some((r) => r.flowDepth === 1));
const downstream = countIf((rows) => rows.some((r) => Number.isInteger(r.flowDepth) && r.flowDepth >= 2));
const terminal = countIf((rows) => rows.some((r) => r.flowLevel === "terminal_in_disclosed_graph"));
const intermediary = countIf((rows) => rows.some((r) => r.flowLevel === "disclosed_intermediary"));
const unclassified = countIf((rows) => rows.some((r) => r.flowLevel === "unclassified"));

const sourceMap = new Map();
for (const c of reviewOnly) {
  const agencies = new Set((rowsByCorp.get(c) ?? []).map((r) => r.sourceAgency || "不明").filter(Boolean));
  for (const a of agencies) sourceMap.set(a, (sourceMap.get(a) ?? 0) + 1);
}
const topSourceAgencies = [...sourceMap.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0], "ja")).map(([sourceAgency, corporations]) => ({ sourceAgency, corporations }));

const gbizPresence = {
  totalReviewOnly: reviewOnly.size,
  absentFromGbizEntirely: [...reviewOnly].filter((c) => !gbizAll.has(c)).length,
  presentInGbizOtherYearOrUndated: [...reviewOnly].filter((c) => gbizAll.has(c)).length,
  hasUndatedGbizRecord: [...reviewOnly].filter((c) => gbizUndated.has(c)).length,
  presentOnlyInDatedNon2024Gbiz: [...reviewOnly].filter((c) => gbizAll.has(c) && !gbizUndated.has(c)).length,
};

const directOnlyCorps = new Set([...review].filter((c) => (rowsByCorp.get(c) ?? []).some((r) => r.flowDepth === 1)));
const downstreamCorps = new Set([...review].filter((c) => (rowsByCorp.get(c) ?? []).some((r) => Number.isInteger(r.flowDepth) && r.flowDepth >= 2)));
const compareSet = (set) => ({
  reviewCorporations: set.size,
  alsoInGbiz2024: [...set].filter((c) => gbiz2024.has(c)).length,
  absentFromGbiz2024: [...set].filter((c) => !gbiz2024.has(c)).length,
  absentFromGbizEntirely: [...set].filter((c) => !gbizAll.has(c)).length,
});

const output = {
  generatedAt: new Date().toISOString(),
  totals: { gbiz2024: gbiz2024.size, review2024: review.size, reviewOnly: reviewOnly.size },
  reviewOnlyRoles: { directDepth1: direct, downstreamDepth2Plus: downstream, terminal, intermediary, unclassified, note: "同一法人が複数役割に現れるため合計はreviewOnlyと一致しない" },
  gbizPresence,
  allReviewDirectRecipients: compareSet(directOnlyCorps),
  allReviewDownstreamRecipients: compareSet(downstreamCorps),
  topSourceAgencies,
};
await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/recipient-gap-causes-2024.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
