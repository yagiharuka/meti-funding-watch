export const MIRASAPO_SEARCH_URL = "https://mirasapo-connect.go.jp/chusho-subsidies";

export const MIRASAPO_SUBSIDIES = [
  { value: "GO_TECH", label: "Go-Tech事業" },
  { value: "IT_DOUNYU", label: "IT導入補助金" },
  { value: "JAPAN_BRAND", label: "ジャパンブランド補助金" },
  { value: "MONODUKURI", label: "ものづくり補助金" },
  { value: "JIGYOU_SAIKOUCHIKU", label: "事業再構築補助金" },
  { value: "JIZOKUKA", label: "持続化補助金" },
  { value: "SHORYOKUKA", label: "中小企業省力化投資補助金" },
];

const SUBSIDY_CODES = new Set(MIRASAPO_SUBSIDIES.map(({ value }) => value));
const SUBSIDY_LABEL_BY_CODE = new Map(MIRASAPO_SUBSIDIES.map(({ value, label }) => [value, label]));

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

function readSingle(searchParams, name) {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw new Error(`${name}は1つだけ指定できます`);
  }
  return values[0]?.trim() ?? "";
}

export function normalizeMirasapoSearchParams(searchParams) {
  const rawPage = readSingle(searchParams, "page") || "1";
  if (!/^\d{1,5}$/.test(rawPage)) {
    throw new Error("pageが不正です");
  }
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 20_000) {
    throw new Error("pageが範囲外です");
  }

  const keyword = readSingle(searchParams, "keyword");
  if ([...keyword].length > 20) {
    throw new Error("キーワードは20文字以内で指定してください");
  }

  const prefCode = readSingle(searchParams, "prefCode");
  if (prefCode && !/^(?:0[1-9]|[1-3]\d|4[0-7])$/.test(prefCode)) {
    throw new Error("都道府県コードが不正です");
  }

  const subsidyCode = readSingle(searchParams, "subsidyCode");
  if (subsidyCode && !SUBSIDY_CODES.has(subsidyCode)) {
    throw new Error("補助金コードが不正です");
  }

  return { page, keyword, prefCode, subsidyCode };
}

export function buildMirasapoSourceUrl(criteria) {
  const url = new URL(MIRASAPO_SEARCH_URL);
  if (criteria.page > 1) url.searchParams.set("page", String(criteria.page));
  if (criteria.keyword) url.searchParams.set("keyword", criteria.keyword);
  if (criteria.prefCode) url.searchParams.set("prefCode", criteria.prefCode);
  if (criteria.subsidyCode) url.searchParams.set("subsidyCodes", criteria.subsidyCode);
  return url;
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}の形式が変わりました`);
  }
  return value;
}

function requireString(value, label, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${label}の形式が変わりました`);
  }
  return value.trim();
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}の形式が変わりました`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === undefined) return "";
  return requireString(value, label);
}

function optionalSingleItemArray(value, label) {
  if (value === undefined) return "";
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`${label}の形式が変わりました`);
  }
  return requireString(value[0], `${label}[0]`, { allowEmpty: false });
}

function parseUpstreamQuery(root, pageProps) {
  const nextQuery = requirePlainObject(root.query, "公式検索データ.query");
  const appliedQuery = requirePlainObject(pageProps.query, "公式検索データ.pageProps.query");

  const rawPage = nextQuery.page === undefined
    ? "1"
    : requireString(nextQuery.page, "公式検索データ.query.page", { allowEmpty: false });
  if (!/^\d{1,5}$/.test(rawPage)) {
    throw new Error("公式検索データ.query.pageの形式が変わりました");
  }
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 20_000) {
    throw new Error("公式検索データ.query.pageの形式が変わりました");
  }

  const requestQuery = {
    page,
    keyword: optionalString(nextQuery.keyword, "公式検索データ.query.keyword"),
    prefCode: optionalString(nextQuery.prefCode, "公式検索データ.query.prefCode"),
    subsidyCode: optionalString(nextQuery.subsidyCodes, "公式検索データ.query.subsidyCodes"),
  };
  const pagePropsQuery = {
    keyword: optionalString(appliedQuery.keyword, "公式検索データ.pageProps.query.keyword"),
    prefCode: optionalSingleItemArray(appliedQuery.prefCode, "公式検索データ.pageProps.query.prefCode"),
    subsidyCode: optionalSingleItemArray(appliedQuery.subsidyCodes, "公式検索データ.pageProps.query.subsidyCodes"),
  };

  for (const key of ["keyword", "prefCode", "subsidyCode"]) {
    if (requestQuery[key] !== pagePropsQuery[key]) {
      throw new Error(`公式検索が${key}条件を反映していません`);
    }
  }
  return { ...pagePropsQuery, page };
}

export function parseMirasapoSearchHtml(html, { includeQuery = false } = {}) {
  if (typeof html !== "string" || !html.includes("__NEXT_DATA__")) {
    throw new Error("公式検索の応答形式が変わりました");
  }
  const match = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error("公式検索データを取得できませんでした");
  }

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("公式検索データを解析できませんでした");
  }

  const root = requirePlainObject(parsed, "公式検索データ");
  const props = requirePlainObject(root.props, "公式検索データ.props");
  const pageProps = requirePlainObject(props.pageProps, "公式検索データ.pageProps");
  if (!Array.isArray(pageProps.listView)) {
    throw new Error("公式検索結果の形式が変わりました");
  }
  if (pageProps.listView.length > 20) {
    throw new Error("公式検索結果の件数形式が変わりました");
  }

  const totalPages = requireInteger(pageProps.total, "公式検索の総ページ数");
  const countText = requireString(pageProps.count, "公式検索の表示件数", { allowEmpty: false });
  if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(countText)) {
    throw new Error("公式検索の表示件数形式が変わりました");
  }
  const totalRecords = Number(countText.replaceAll(",", ""));
  requireInteger(totalRecords, "公式検索の表示件数");

  const query = includeQuery ? parseUpstreamQuery(root, pageProps) : null;

  const records = pageProps.listView.map((raw, index) => {
    const row = requirePlainObject(raw, `公式検索結果${index + 1}行目`);
    const id = requireString(row.id, `公式検索結果${index + 1}行目.id`, { allowEmpty: false });
    return {
      id,
      name: requireString(row.name, `公式検索結果${index + 1}行目.name`, { allowEmpty: false }),
      prefecture: requireString(row.address, `公式検索結果${index + 1}行目.address`),
      subsidy: requireString(row.subsidy, `公式検索結果${index + 1}行目.subsidy`, { allowEmpty: false }),
      year: requireString(row.year, `公式検索結果${index + 1}行目.year`),
      round: requireString(row.times, `公式検索結果${index + 1}行目.times`),
      plan: requireString(row.plan, `公式検索結果${index + 1}行目.plan`),
      sourceUrl: `${MIRASAPO_SEARCH_URL}/${encodeURIComponent(id)}`,
    };
  });

  if (new Set(records.map(({ id }) => id)).size !== records.length) {
    throw new Error("公式検索結果に同じIDが重複しています");
  }

  // The official search currently represents an empty result as one empty page.
  if (totalRecords === 0 && (totalPages !== 1 || records.length !== 0)) {
    throw new Error("公式検索の0件応答が整合しません");
  }
  if (totalRecords > 0 && totalPages !== Math.ceil(totalRecords / 20)) {
    throw new Error("公式検索の件数とページ数が整合しません");
  }

  return includeQuery
    ? { totalRecords, totalPages, records, query }
    : { totalRecords, totalPages, records };
}

export function validateMirasapoSearchResult(parsed, criteria) {
  const query = requirePlainObject(parsed.query, "公式検索の検索条件");
  for (const key of ["page", "keyword", "prefCode", "subsidyCode"]) {
    if (query[key] !== criteria[key]) {
      throw new Error(`公式検索が${key}条件を反映していません`);
    }
  }

  if (parsed.totalRecords === 0) {
    if (criteria.page !== 1) {
      throw new RangeError("指定されたページは検索結果の範囲外です");
    }
    if (parsed.records.length !== 0) {
      throw new Error("公式検索の0件応答が整合しません");
    }
    return;
  }

  if (criteria.page > parsed.totalPages) {
    throw new RangeError("指定されたページは検索結果の範囲外です");
  }

  const expectedRecords = criteria.page < parsed.totalPages
    ? 20
    : parsed.totalRecords - (parsed.totalPages - 1) * 20;
  if (parsed.records.length !== expectedRecords) {
    throw new Error("公式検索のページ内件数が整合しません");
  }

  const expectedPrefecture = criteria.prefCode
    ? PREFECTURES[Number(criteria.prefCode) - 1]
    : "";
  const expectedSubsidy = criteria.subsidyCode
    ? SUBSIDY_LABEL_BY_CODE.get(criteria.subsidyCode)
    : "";
  for (const record of parsed.records) {
    if (expectedPrefecture && record.prefecture !== expectedPrefecture) {
      throw new Error("公式検索結果が指定した都道府県と一致しません");
    }
    if (expectedSubsidy && record.subsidy !== expectedSubsidy) {
      throw new Error("公式検索結果が指定した補助金と一致しません");
    }
  }
}
