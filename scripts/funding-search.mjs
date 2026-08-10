export const FUNDING_PAGE_SIZE = 100;
export const FUNDING_QUERY_MAX_LENGTH = 100;
export const FUNDING_MAX_PAGE = 10_000;
export const FUNDING_STAGES = new Set(["all", "contracted", "subsidy_published"]);

export function sanitizeFundingSearchQuery(raw) {
  let value = String(raw ?? "").trim().slice(0, FUNDING_QUERY_MAX_LENGTH);
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return value;
}

export function sanitizeFundingSearchPage(raw) {
  const value = String(raw ?? "");
  if (!/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= FUNDING_MAX_PAGE ? page : 1;
}

export function normalizeFundingSearchParams(searchParams) {
  const query = (searchParams.get("q") ?? "").trim();
  if (query.length > FUNDING_QUERY_MAX_LENGTH) throw new RangeError("検索語は100文字以内です");
  const agency = (searchParams.get("agency") ?? "all").trim() || "all";
  if (agency.length > 100) throw new RangeError("公表組織が不正です");
  const stage = searchParams.get("stage") ?? "all";
  if (!FUNDING_STAGES.has(stage)) throw new RangeError("掲載区分が不正です");
  const year = searchParams.get("year") ?? "all";
  if (year !== "all" && year !== "unclassified" && !/^\d{4}$/.test(year)) {
    throw new RangeError("年度が不正です");
  }
  const page = Number(searchParams.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > FUNDING_MAX_PAGE) throw new RangeError("ページが不正です");
  return { query, agency, stage, year, page };
}

export function searchFundingRecords(records, criteria, agencies) {
  if (criteria.agency !== "all" && !agencies.includes(criteria.agency)) {
    throw new RangeError("公表組織が検索対象にありません");
  }
  const needle = criteria.query.toLocaleLowerCase("ja-JP");
  const matching = records.filter((row) => {
    if (needle && !`${row.organization} ${row.corporateNumber}`.toLocaleLowerCase("ja-JP").includes(needle)) return false;
    if (criteria.agency !== "all" && row.sourceAgency !== criteria.agency) return false;
    if (criteria.stage !== "all" && row.stage !== criteria.stage) return false;
    if (criteria.year === "unclassified" && row.fiscalYear !== null) return false;
    if (/^\d{4}$/.test(criteria.year) && String(row.fiscalYear) !== criteria.year) return false;
    return true;
  });
  const totalRecords = matching.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / FUNDING_PAGE_SIZE));
  if (criteria.page > totalPages) throw new RangeError("ページが検索結果の範囲外です");
  const offset = (criteria.page - 1) * FUNDING_PAGE_SIZE;
  return {
    totalRecords,
    totalPages,
    page: criteria.page,
    pageSize: FUNDING_PAGE_SIZE,
    records: matching.slice(offset, offset + FUNDING_PAGE_SIZE),
  };
}

export function sortFundingRecords(records) {
  return [...records].sort((a, b) =>
    (b.fiscalYear ?? Number.NEGATIVE_INFINITY) - (a.fiscalYear ?? Number.NEGATIVE_INFINITY)
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.organization.localeCompare(b.organization, "ja"));
}
