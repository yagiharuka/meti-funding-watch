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
    group = { organization: row.organization, corporateNumber, aliases: new Set(), entries: [] };
    groups.set(key, group);
  }
  group.aliases.add(row.organization);
  group.entries.push({
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
  });
}

function removeBlankPartnerRows(entries) {
  const buckets = new Map();
  for (const entry of entries) {
    const bucketKey = [entry.reviewSheetYear, entry.reviewProjectId, entry.block].join("|");
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(entry);
    buckets.set(bucketKey, bucket);
  }

  const result = [];
  for (const bucket of buckets.values()) {
    const amountRows = bucket.filter((entry) => entry.amount !== null);
    if (amountRows.length) {
      // 同じレビュー年度・事業・支出ブロック・受取先について金額記載行がある場合のみ、
      // その組合せの金額空欄行を企業検索用索引から省く。金額記載行同士は統合しない。
      result.push(...amountRows);
    } else {
      // 金額記載行がない組合せは、原資料の空欄行を失わないよう全行を保持する。
      result.push(...bucket);
    }
  }
  return result;
}

const recipients = [...groups.values()].map((group) => {
  const entries = removeBlankPartnerRows(group.entries).sort((a, b) =>
    b.reviewSheetYear - a.reviewSheetYear
    || (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY)
    || a.program.localeCompare(b.program, "ja")
    || (a.sourceRowNumber ?? Number.MAX_SAFE_INTEGER) - (b.sourceRowNumber ?? Number.MAX_SAFE_INTEGER));
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
    amount: "行政事業レビュー公式CSV『支出先の合計支出額』。同一レビュー年度・事業・支出ブロック・受取先について金額記載行がある場合のみ、同じ組合せの金額空欄行を企業検索用索引から省く。金額記載行同士は統合しない。",
    aggregationWarning: "GビズINFO掲載値、NEDO交付決定額、上流・中間・下流の支出額を相互に合算しない。",
  },
  recipients,
};
await writeFile("data/review-company-index.json", `${JSON.stringify(output)}\n`);
console.log(`Review company index: ${recipients.length} recipients / ${rows.length} source rows`);
