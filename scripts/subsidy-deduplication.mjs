export const SUBSIDY_DUPLICATE_AMOUNT_TOLERANCE = 0.001;

function japaneseFiscalYear(value) {
  const normalized = String(value ?? "").normalize("NFKC");
  const western = normalized.match(/(?:^|[（(])\s*((?:19|20)\d{2})年度/u);
  if (western) return Number(western[1]);
  const era = normalized.match(/(?:^|[（(])\s*(令和|平成)(元|\d+)年度/u);
  if (!era) return null;
  const year = era[2] === "元" ? 1 : Number(era[2]);
  return era[1] === "令和" ? 2018 + year : 1988 + year;
}

export function normalizeSubsidyProgram(value = "") {
  const original = String(value ?? "").normalize("NFKC").trim();
  const fiscalYear = japaneseFiscalYear(original);
  let core = original
    .toLocaleLowerCase("ja-JP")
    .replace(/^(?:(?:19|20)\d{2}|令和(?:元|\d+)|平成(?:元|\d+))年度/u, "")
    .replace(/[\s　・･,，、。:：;；/／\\()（）\[\]［］【】「」『』〈〉《》"'’‘“”_―—ー-]+/gu, "")
    .replace(/(?:事業費)?補助金(?:交付申請書)?$/u, "")
    .replace(/事業$/u, "");
  if (!core) core = original.toLocaleLowerCase("ja-JP").replace(/[\s　]+/gu, "");
  return { core, fiscalYear };
}

function bigrams(value) {
  if (value.length < 2) return new Set([value]);
  const values = new Set();
  for (let index = 0; index < value.length - 1; index += 1) values.add(value.slice(index, index + 2));
  return values;
}

function similarProgram(left, right) {
  const a = normalizeSubsidyProgram(left);
  const b = normalizeSubsidyProgram(right);
  if (a.fiscalYear !== null && b.fiscalYear !== null && a.fiscalYear !== b.fiscalYear) return false;
  if (a.core === b.core) return true;
  if (Math.min(a.core.length, b.core.length) < 8) return false;
  const leftBigrams = bigrams(a.core);
  const rightBigrams = bigrams(b.core);
  let overlap = 0;
  for (const item of leftBigrams) if (rightBigrams.has(item)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size) >= 0.9;
}

function similarAmount(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right)) * SUBSIDY_DUPLICATE_AMOUNT_TOLERANCE;
}

function trailingZeroCount(value) {
  let integer = Math.abs(Math.trunc(value));
  let count = 0;
  while (integer > 0 && integer % 10 === 0) {
    count += 1;
    integer /= 10;
  }
  return count;
}

function representativeOrder(left, right) {
  const leftProgramYear = normalizeSubsidyProgram(left.program).fiscalYear;
  const rightProgramYear = normalizeSubsidyProgram(right.program).fiscalYear;
  const leftMatchesProgramYear = leftProgramYear !== null && leftProgramYear === left.fiscalYear ? 0 : 1;
  const rightMatchesProgramYear = rightProgramYear !== null && rightProgramYear === right.fiscalYear ? 0 : 1;
  return leftMatchesProgramYear - rightMatchesProgramYear
    || trailingZeroCount(left.amount) - trailingZeroCount(right.amount)
    || (left.fiscalYear ?? Number.POSITIVE_INFINITY) - (right.fiscalYear ?? Number.POSITIVE_INFINITY)
    || String(left.date ?? "").localeCompare(String(right.date ?? ""))
    || String(left.id).localeCompare(String(right.id));
}

export function classifySubsidyDuplicates(rows) {
  const candidatesByCorporation = new Map();
  for (const row of rows) {
    if (row?.stage !== "subsidy_published" || !similarAmount(row.amount, row.amount)) continue;
    const corporateNumber = String(row.corporateNumber ?? "");
    if (!/^\d{13}$/.test(corporateNumber)) continue;
    const candidates = candidatesByCorporation.get(corporateNumber) ?? [];
    candidates.push(row);
    candidatesByCorporation.set(corporateNumber, candidates);
  }

  const duplicateIds = new Set();
  const canonicalById = new Map();
  const groups = [];
  for (const candidates of candidatesByCorporation.values()) {
    const provisionalGroups = [];
    for (const row of [...candidates].sort(representativeOrder)) {
      const group = provisionalGroups.find((item) => similarAmount(item.canonical.amount, row.amount)
        && similarProgram(item.canonical.program, row.program));
      if (group) group.rows.push(row);
      else provisionalGroups.push({ canonical: row, rows: [row] });
    }
    for (const group of provisionalGroups) {
      if (group.rows.length < 2) continue;
      const canonical = group.canonical;
      const duplicates = group.rows.filter((row) => row !== canonical);
      for (const row of group.rows) canonicalById.set(row.id, canonical);
      for (const row of duplicates) duplicateIds.add(row.id);
      groups.push({
        corporateNumber: canonical.corporateNumber,
        canonicalId: canonical.id,
        canonicalProgram: canonical.program,
        canonicalAmount: canonical.amount,
        duplicateIds: duplicates.map((row) => row.id),
      });
    }
  }
  return {
    duplicateIds,
    canonicalById,
    duplicateExcludedCount: duplicateIds.size,
    groups,
  };
}

export function subsidyAggregationValue(row, classification) {
  const duplicateExcluded = row?.stage === "subsidy_published" && classification.duplicateIds.has(row.id);
  const canonical = classification.canonicalById.get(row.id);
  return {
    duplicateExcluded,
    amount: row.amount === null || duplicateExcluded ? 0 : row.amount,
    amountIncluded: row.amount !== null && !duplicateExcluded,
    program: canonical?.program ?? row.program,
  };
}
