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

export const INTERNAL_PARTIAL_SEARCH_PREFIX = "\u0001contains:";

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

function entityNames(entity) {
  const names = [entity.organization];
  if (Array.isArray(entity.organizations)) names.push(...entity.organizations);
  if (Array.isArray(entity.aliases)) names.push(...entity.aliases);
  return [...new Set(names.map((name) => String(name ?? "").trim()).filter(Boolean))];
}

function entityIdentities(entity) {
  if (typeof entity?.identity === "string" && Array.isArray(entity.aliasIdentities)) {
    return [entity.identity, ...entity.aliasIdentities];
  }
  return entityNames(entity).map((name) => normalizeCompanyIdentity(name));
}

export function entityHasExactCompanyIdentity(entity, query) {
  const identity = normalizeCompanyIdentity(query);
  if (!identity) return false;
  return entityIdentities(entity).includes(identity);
}

function parseCompanyQuery(query) {
  const raw = String(query ?? "");
  const forcePartial = raw.startsWith(INTERNAL_PARTIAL_SEARCH_PREFIX);
  return {
    forcePartial,
    query: forcePartial ? raw.slice(INTERNAL_PARTIAL_SEARCH_PREFIX.length) : raw,
  };
}

export function filterCompanyEntities(entities, query) {
  const parsed = parseCompanyQuery(query);
  const matches = matchCompanyEntities(entities, parsed.query);
  return parsed.forcePartial ? matches.contains : matches.primary;
}

export function matchCompanyEntities(entities, query) {
  const normalized = normalizeCompanySearchTerm(query);
  if (!normalized) {
    const all = [...entities];
    return { exact: [], contains: all, primary: all };
  }
  if (/^\d{13}$/.test(normalized)) {
    const exact = entities.filter((entity) => entity.corporateNumber === normalized);
    return { exact, contains: exact, primary: exact };
  }

  const identity = normalizeCompanyIdentity(query);
  if (!identity) return { exact: [], contains: [], primary: [] };

  const exact = [];
  const contains = [];
  for (const entity of entities) {
    let exactMatch = false;
    let containsMatch = false;
    for (const normalizedName of entityIdentities(entity)) {
      if (normalizedName === identity) exactMatch = true;
      if (normalizedName.includes(identity)) containsMatch = true;
      if (exactMatch && containsMatch) break;
    }
    if (exactMatch) exact.push(entity);
    if (containsMatch) contains.push(entity);
  }
  return { exact, contains, primary: exact.length ? exact : contains };
}

export function resolveCompanyNumbers(rows, query) {
  const parsed = parseCompanyQuery(query);
  const normalized = normalizeCompanySearchTerm(parsed.query);
  if (!normalized) return null;
  return new Set(
    filterCompanyEntities(rows, query)
      .map((row) => row.corporateNumber)
      .filter(Boolean),
  );
}

export function filterCompanyRecords(rows, {
  query = "",
  agency = "all",
  stage = "all",
  year = "all",
} = {}) {
  const parsed = parseCompanyQuery(query);
  const normalizedQuery = normalizeCompanySearchTerm(parsed.query);
  const matchedEntities = normalizedQuery ? filterCompanyEntities(rows, query) : null;
  const matchedCorporateNumbers = matchedEntities
    ? new Set(matchedEntities.map((row) => row.corporateNumber).filter(Boolean))
    : null;
  const matchedNumberlessRows = matchedEntities
    ? new Set(matchedEntities.filter((row) => !row.corporateNumber))
    : null;

  return rows.filter((row) => {
    if (matchedEntities) {
      if (row.corporateNumber) {
        if (!matchedCorporateNumbers.has(row.corporateNumber)) return false;
      } else if (!matchedNumberlessRows.has(row)) {
        return false;
      }
    }
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
    // Corporate-numberless rows are intentionally split per source row. A shared name is
    // not enough evidence that two rows identify the same legal entity.
    const groupKey = row.corporateNumber || `numberless:${row.id ?? normalizeCompanySearchTerm(row.organization)}`;
    const current = groups.get(groupKey);
    if (current) current.push(row);
    else groups.set(groupKey, [row]);
  }
  return groups;
}

export function summarizeCompanyIdentityCoverage(rows) {
  const verifiedCorporateNumbers = new Set();
  let numberlessRecordCount = 0;
  for (const row of rows) {
    const corporateNumber = String(row.corporateNumber ?? "");
    if (/^\d{13}$/.test(corporateNumber)) verifiedCorporateNumbers.add(corporateNumber);
    else numberlessRecordCount += 1;
  }
  return {
    verifiedCorporationCount: verifiedCorporateNumbers.size,
    numberlessRecordCount,
  };
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
