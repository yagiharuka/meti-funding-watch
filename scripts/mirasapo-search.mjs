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

export function parseMirasapoSearchHtml(html) {
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

  if (totalRecords === 0 && (totalPages !== 0 || records.length !== 0)) {
    throw new Error("公式検索の0件応答が整合しません");
  }
  if (totalRecords > 0 && totalPages !== Math.ceil(totalRecords / 20)) {
    throw new Error("公式検索の件数とページ数が整合しません");
  }

  return { totalRecords, totalPages, records };
}
