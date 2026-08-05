import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const dataPath = new URL("../data/funding-data.json", import.meta.url);
const registryPath = new URL("../data/source-registry.json", import.meta.url);

const [current, registry] = await Promise.all([
  readJson(dataPath),
  readJson(registryPath),
]);

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const next = structuredClone(current);
const configured = new Map(
  registry.sources.filter((source) => source.enabled).map((source) => [source.id, source]),
);
const results = [];

await refreshGbiz();
await refreshNedo();
await refreshGbizApi();

next.generatedAt = new Date().toISOString();
next.records.sort((a, b) => {
  return b.amount - a.amount || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
});

validate(next);
await writeFile(dataPath, `${JSON.stringify(next, null, 2)}\n`);

for (const result of results) {
  console.log(`${result.ok ? "OK" : "STALE"} ${result.name}: ${result.message}`);
}
console.log(`Wrote ${next.records.length.toLocaleString("en-US")} records to ${dataPath.pathname}`);

async function refreshGbiz() {
  const source = configured.get("gbiz");
  if (!source) return;

  try {
    const html = await fetchText(source.indexUrl);
    const rowStart = html.indexOf("経済産業省 (小計)");
    if (rowStart < 0) throw new Error("経産省小計行が見つかりません");

    const rowText = stripHtml(html.slice(rowStart, rowStart + 2_000));
    const numbers = [...rowText.matchAll(/\b[\d,]+\b/g)]
      .slice(0, 4)
      .map((match) => Number(match[0].replaceAll(",", "")));

    if (numbers.length < 4 || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error("経産省小計の件数を解析できません");
    }

    const [, subsidies, procurements] = numbers;
    updateSource("gbiz", {
      recordCount: subsidies + procurements,
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `補助金 ${subsidies.toLocaleString("ja-JP")}件、調達 ${procurements.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    markStale("gbiz", source, error);
  }
}

async function refreshGbizApi() {
  const source = configured.get("gbiz");
  if (!source?.apiBaseUrl) return;

  const tokenName = source.apiTokenEnv || "GBIZINFO_API_TOKEN";
  const token = process.env[tokenName]?.trim();
  if (!token) {
    results.push({
      ok: true,
      name: "GビズINFO API v2",
      message: `${tokenName}未設定のため明細取得をスキップ`,
    });
    return;
  }

  const corporateNumbers = [...new Set(
    next.records
      .map((record) => record.corporateNumber)
      .filter((number) => /^\d{13}$/.test(number)),
  )];

  try {
    const batches = await mapWithConcurrency(corporateNumbers, 6, async (corporateNumber) => {
      const [procurements, subsidies] = await Promise.all([
        fetchGbizActivities(source.apiBaseUrl, corporateNumber, "procurement", token),
        fetchGbizActivities(source.apiBaseUrl, corporateNumber, "subsidy", token),
      ]);
      return [
        ...toGbizRecords(procurements, "procurement"),
        ...toGbizRecords(subsidies, "subsidy"),
      ];
    });

    const loadedRecords = deduplicate(batches.flat());
    const retainedRecords = next.records.filter((record) => record.ingestSource !== "gbiz-api");
    const occupiedKeys = new Set(retainedRecords.map(fundingIdentity));
    const newRecords = loadedRecords.filter((record) => !occupiedKeys.has(fundingIdentity(record)));

    next.records = [...retainedRecords, ...newRecords];
    updateSource("gbiz", {
      method: "API v2 / dashboard",
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: "GビズINFO API v2",
      message: `${corporateNumbers.length.toLocaleString("ja-JP")}法人から経産省系明細 ${newRecords.length.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    updateSource("gbiz", { status: "watch" });
    results.push({
      ok: false,
      name: "GビズINFO API v2",
      message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
    });
  }
}

async function fetchGbizActivities(baseUrl, corporateNumber, kind, token) {
  const url = `${baseUrl}/${corporateNumber}/${kind}?metadata_flg=true`;
  let response;
  try {
    response = await fetchWithTimeout(url, {
      "X-hojinInfo-api-token": token,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("404 ")) return [];
    throw error;
  }
  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`GビズINFO ${kind}: ${JSON.stringify(payload.errors)}`);
  }
  return Array.isArray(payload["hojin-infos"]) ? payload["hojin-infos"] : [];
}

function toGbizRecords(organizations, kind) {
  return organizations.flatMap((organization) => {
    const corporateNumber = cleanCell(organization.corporate_number);
    const name = cleanCell(organization.name);
    const activities = Array.isArray(organization[kind]) ? organization[kind] : [];

    if (!/^\d{13}$/.test(corporateNumber) || !isCompanyName(name)) return [];

    return activities.flatMap((activity) => {
      const agency = normalizeGbizAgency(cleanCell(activity.government_departments));
      const amount = parseAmount(activity.amount);
      const date = parseJapaneseDate(
        cleanCell(kind === "procurement" ? activity.date_of_order : activity.date_of_approval),
      );
      const program = cleanCell(activity.title);
      const metadataKey = cleanCell(activity["meta-data"]?.key_field);

      if (!agency || !amount || !date || !program) return [];

      const stage = kind === "procurement" ? "contracted" : "subsidy_published";
      return [{
        id: `gbiz-${stableId([kind, metadataKey, date, corporateNumber, amount, program])}`,
        fiscalYear: fiscalYear(date),
        date,
        organization: name,
        corporateNumber,
        sourceAgency: agency,
        program,
        amount,
        stage,
        route: agency === "経済産業省"
          ? ["経済産業省", name]
          : ["経済産業省", agency, name],
        sourceName: "GビズINFO REST API v2",
        sourceUrl: `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${corporateNumber}`,
        quality: "aggregated",
        ingestSource: "gbiz-api",
      }];
    });
  });
}

function normalizeGbizAgency(value) {
  const agencies = [
    ["新エネルギー・産業技術総合開発機構", "NEDO"],
    ["情報処理推進機構", "IPA"],
    ["製品評価技術基盤機構", "NITE"],
    ["工業所有権情報・研修館", "INPIT"],
    ["中小企業基盤整備機構", "中小機構"],
    ["石油天然ガス・金属鉱物資源機構", "JOGMEC"],
    ["エネルギー・金属鉱物資源機構", "JOGMEC"],
    ["日本貿易振興機構", "JETRO"],
    ["資源エネルギー庁", "資源エネルギー庁"],
    ["中小企業庁", "中小企業庁"],
    ["特許庁", "特許庁"],
    ["経済産業省", "経済産業省"],
  ];
  return agencies.find(([needle]) => value.includes(needle))?.[1] || null;
}

async function refreshNedo() {
  const source = configured.get("nedo");
  if (!source) return;

  try {
    const indexHtml = await fetchText(source.indexUrl);
    const csvLinks = discoverCsvLinks(indexHtml, source.indexUrl);
    if (!csvLinks.length) throw new Error("月別CSVが見つかりません");

    const batches = await Promise.all(csvLinks.map(loadNedoCsv));
    const loadedRecords = deduplicate(batches.flat());

    if (!loadedRecords.length) throw new Error("有効な企業契約を抽出できません");

    next.records = [
      ...next.records.filter((record) => {
        const isMonthlyNedoRecord =
          record.ingestSource === "nedo-monthly-csv" ||
          (record.sourceAgency === "NEDO" && /nedo\.go\.jp\/content\/.*\.csv/.test(record.sourceUrl));
        return !isMonthlyNedoRecord;
      }),
      ...loadedRecords,
    ];
    updateSource("nedo", {
      recordCount: loadedRecords.length,
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `${csvLinks.length}か月分から企業契約 ${loadedRecords.length.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    markStale("nedo", source, error);
  }
}

async function loadNedoCsv(link) {
  const response = await fetchWithTimeout(link.url);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("shift_jis").decode(bytes);
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.includes("契約件名及び品名"));
  if (headerIndex < 0) throw new Error(`${link.label}: ヘッダーが見つかりません`);

  const headers = rows[headerIndex].map(cleanCell);
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = [
    "契約件名及び品名",
    "契約締結日",
    "契約の相手先の名称",
    "法人番号",
    "契約金額（円）",
  ];
  for (const header of required) {
    if (!(header in column)) throw new Error(`${link.label}: ${header}列がありません`);
  }

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const organization = cleanCell(row[column["契約の相手先の名称"]]);
    const corporateNumber = cleanCell(row[column["法人番号"]]).replace(/\D/g, "");
    const amount = Number(cleanCell(row[column["契約金額（円）"]]).replace(/\D/g, ""));
    const date = parseJapaneseDate(cleanCell(row[column["契約締結日"]]));
    const program = cleanCell(row[column["契約件名及び品名"]]);

    if (
      !isCompanyName(organization) ||
      !/^\d{13}$/.test(corporateNumber) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !date ||
      !program
    ) {
      return [];
    }

    return [{
      id: `nedo-${stableId([date, corporateNumber, amount, program])}`,
      fiscalYear: fiscalYear(date),
      date,
      organization,
      corporateNumber,
      sourceAgency: "NEDO",
      program,
      amount,
      stage: "contracted",
      route: ["経済産業省", "NEDO", organization],
      sourceName: `NEDO ${link.label}契約CSV`,
      sourceUrl: link.url,
      quality: "primary",
      ingestSource: "nedo-monthly-csv",
    }];
  });
}

function discoverCsvLinks(html, indexUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+\.csv(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    links.push({
      url: new URL(match[1], indexUrl).href,
      label: stripHtml(match[2]).replace(/\s+/g, "").trim() || "月別",
    });
  }
  return [...new Map(links.map((link) => [link.url, link])).values()];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cleanCell(value = "") {
  return value.replace(/^\uFEFF/, "").replace(/[\u3000\s]+/g, " ").trim();
}

function stripHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJapaneseDate(value) {
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const match = value.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function isCompanyName(name) {
  return /(株式会社|有限会社|合同会社|合名会社|合資会社|相互会社)/.test(name);
}

function stableId(parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
}

function parseAmount(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function fundingIdentity(record) {
  return [record.corporateNumber, record.date, record.amount].join("\u001f");
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function deduplicate(records) {
  const unique = new Map();
  for (const record of records) unique.set(record.id, record);
  return [...unique.values()];
}

function updateSource(id, patch) {
  const source = next.sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`データソース ${id} が funding-data.json にありません`);
  Object.assign(source, patch);
}

function markStale(id, source, error) {
  updateSource(id, { status: "watch" });
  results.push({
    ok: false,
    name: source.name,
    message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
  });
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  return response.text();
}

async function fetchWithTimeout(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

function validate(data) {
  if (!Array.isArray(data.records) || !Array.isArray(data.sources)) {
    throw new Error("funding-data.json の構造が不正です");
  }
  const ids = new Set();
  for (const record of data.records) {
    if (ids.has(record.id)) throw new Error(`重複ID: ${record.id}`);
    ids.add(record.id);
    if (!/^\d{13}$/.test(record.corporateNumber)) {
      throw new Error(`法人番号が不正です: ${record.id}`);
    }
    if (!Number.isSafeInteger(record.amount) || record.amount <= 0) {
      throw new Error(`金額が不正です: ${record.id}`);
    }
    if (!/^https:\/\//.test(record.sourceUrl)) {
      throw new Error(`原典URLが不正です: ${record.id}`);
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
