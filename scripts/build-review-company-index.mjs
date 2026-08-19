import { readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("data/review-cache/manifest.json", "utf8"));
const rows = (await Promise.all(manifest.paymentFiles.map(async (filename) =>
  JSON.parse(await readFile(`data/review-cache/${filename}`, "utf8")),
))).flat();

const normalize = (value = "") => String(value)
  .normalize("NFKC")
  .toLocaleLowerCase("ja-JP")
  .replace(/[\s　]+/g, " ")
  .trim();

const groups = new Map();
for (const row of rows) {
  if (!row.organization) continue;
  const corporateNumber = /^\d{13}$/.test(String(row.corporateNumber ?? "")) ? String(row.corporateNumber) : "";
  const key = corporateNumber || `name:${normalize(row.organization)}`;
  let group = groups.get(key);
  if (!group) {
    group = { organization: row.organization, corporateNumber, aliases: new Set(), entries: new Map() };
    groups.set(key, group);
  }
  group.aliases.add(row.organization);
  const entryKey = [row.reviewSheetYear, row.reviewProjectId, row.block, corporateNumber || normalize(row.organization)].join("|");
  const candidate = {
    id: row.id,
    reviewSheetYear: row.reviewSheetYear,
    reviewProjectId: row.reviewProjectId,
    program: row.program,
    amount: row.amount,
    amountRaw: row.amountRaw,
    amountStatus: row.amountStatus,
    sourceAgency: row.sourceAgency,
    route: row.route,
    block: row.block,
    sourceUrl: row.sourceUrl,
    sourceRowNumber: row.sourceRowNumber,
    flowLevel: row.flowLevel,
  };
  const current = group.entries.get(entryKey);
  if (!current || (current.amount == null && candidate.amount != null)) group.entries.set(entryKey, candidate);
}

const recipients = [...groups.values()].map((group) => {
  const entries = [...group.entries.values()].sort((a, b) =>
    b.reviewSheetYear - a.reviewSheetYear
    || (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY)
    || a.program.localeCompare(b.program, "ja"));
  const aliases = [...group.aliases].sort((a, b) => a.localeCompare(b, "ja"));
  const amountKnownTotal = entries.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const amountKnownCount = entries.filter((row) => row.amount != null).length;
  return {
    organization: group.organization,
    corporateNumber: group.corporateNumber,
    aliases,
    searchText: normalize(`${aliases.join(" ")} ${group.corporateNumber}`),
    entryCount: entries.length,
    amountKnownTotal,
    amountKnownCount,
    amountUnknownCount: entries.length - amountKnownCount,
    entries,
  };
}).sort((a, b) => b.amountKnownTotal - a.amountKnownTotal || b.entryCount - a.entryCount || a.organization.localeCompare(b.organization, "ja"));

const output = {
  schemaVersion: 1,
  generatedAt: manifest.generatedAt,
  reviewSheetYears: manifest.reviewSheetYears,
  recipientCount: recipients.length,
  semantics: {
    amount: "行政事業レビュー公式CSV『支出先の合計支出額』。同一事業・支出先ブロック・受取先の重複行は、金額記載行を優先して企業検索用に1行へ整理する。",
    aggregationWarning: "GビズINFO掲載値、NEDO交付決定額、上流・中間・下流の支出額を相互に合算しない。",
  },
  recipients,
};
await writeFile("data/review-company-index.json", `${JSON.stringify(output)}\n`);
console.log(`Review company index: ${recipients.length} recipients / ${rows.length} source rows`);
