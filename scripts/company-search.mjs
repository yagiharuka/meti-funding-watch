const CORPORATE_DESIGNATORS = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "一般社団法人",
  "一般財団法人",
  "公益社団法人",
  "公益財団法人",
  "特定非営利活動法人",
  "社会福祉法人",
  "学校法人",
  "医療法人",
  "独立行政法人",
  "国立研究開発法人",
];

export function normalizeCompanySearchTerm(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/g, "株式会社")
    .replace(/\(有\)|㈲/g, "有限会社")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s　]+/g, "")
    .trim();
}

export function normalizeCompanyIdentity(value = "") {
  let normalized = normalizeCompanySearchTerm(value);
  for (const designator of CORPORATE_DESIGNATORS) {
    normalized = normalized.replaceAll(designator.toLocaleLowerCase("ja-JP"), "");
  }
  return normalized;
}

export function resolveCompanyNumbers(rows, query) {
  const normalized = normalizeCompanySearchTerm(query);
  if (!normalized) return null;
  if (/^\d{13}$/.test(normalized)) return new Set([normalized]);

  const identity = normalizeCompanyIdentity(query);
  if (!identity) return new Set();

  const exact = new Set();
  for (const row of rows) {
    if (normalizeCompanyIdentity(row.organization) === identity) {
      exact.add(row.corporateNumber);
    }
  }
  if (exact.size) return exact;

  const partial = new Set();
  for (const row of rows) {
    if (normalizeCompanyIdentity(row.organization).includes(identity)) {
      partial.add(row.corporateNumber);
    }
  }
  return partial;
}

export function filterCompanyRecords(rows, {
  query = "",
  agency = "all",
  stage = "all",
  year = "all",
} = {}) {
  const matchedCorporateNumbers = resolveCompanyNumbers(rows, query);
  return rows.filter((row) => {
    if (matchedCorporateNumbers && !matchedCorporateNumbers.has(row.corporateNumber)) return false;
    if (agency !== "all" && row.sourceAgency !== agency) return false;
    if (stage !== "all" && row.stage !== stage) return false;
    if (year === "unclassified" && row.fiscalYear !== null) return false;
    if (/^\d{4}$/.test(year) && String(row.fiscalYear) !== year) return false;
    return true;
  });
}

export function groupCompanyRecords(rows) {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.corporateNumber);
    if (current) current.push(row);
    else groups.set(row.corporateNumber, [row]);
  }
  return groups;
}

export function summarizeCompanyRows(rows) {
  let amountKnownCount = 0;
  let amountUnknownCount = 0;
  const byStage = new Map();

  for (const row of rows) {
    if (row.amount === null) amountUnknownCount += 1;
    else amountKnownCount += 1;

    const item = byStage.get(row.stage) ?? {
      stage: row.stage,
      records: 0,
      amount: 0,
      amountKnownCount: 0,
    };
    item.records += 1;
    if (row.amount !== null) {
      item.amount += row.amount;
      item.amountKnownCount += 1;
    }
    byStage.set(row.stage, item);
  }

  return {
    records: rows.length,
    amountKnownCount,
    amountUnknownCount,
    byStage: [...byStage.values()].sort((left, right) => left.stage.localeCompare(right.stage)),
  };
}
