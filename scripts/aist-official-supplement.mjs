import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const AIST_LIST_URLS = Object.freeze([
  "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/dai_ippan/chuu_rakusatsu",
  "https://www.aist.go.jp/aist_j/procure/supplyinfo/pub/dai_seihu/chuu_rakusatsu",
]);

const OUTPUT_PATH = "data/official-supplement-aist.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const IDENTITY_FIELDS = ["organization", "corporateNumber", "date", "program", "category"];

function decodeEntities(value = "") {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function htmlToText(html = "") {
  return decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`AIST: invalid contract date ${year}-${month}-${day}`);
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeProgram(value) {
  return String(value ?? "")
    .replace(/\s*[-–—]?\s*産総研[:：]調達情報\s*$/u, "")
    .replace(/の落札者等?の公表\s*$/u, "")
    .trim();
}

export function parseAistListingHtml(html, listUrl, { minLinks = 5 } = {}) {
  const base = new URL(listUrl);
  const links = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']*\/aist_j\/procure\/supplyinfo\/pub\/detail\/[A-Za-z0-9_-]+(?:\.html)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const title = htmlToText(match[2]);
    if (!/落札者/u.test(title) || !/公表/u.test(title)) continue;
    const url = new URL(match[1], base).href;
    links.set(url, { url, title: normalizeProgram(title) });
  }
  const values = [...links.values()];
  if (values.length < minLinks) {
    throw new Error(`AIST一覧の落札者公表リンクが少なすぎます: ${values.length}/${minLinks} (${listUrl})`);
  }
  return values;
}

export function parseAistAwardHtml(html, sourceUrl) {
  const text = htmlToText(html);
  if (!/落札者/u.test(text) || !/契約日[:：]/u.test(text) || !/契約金額[:：]/u.test(text)) {
    throw new Error(`AIST detailの必須構造がありません: ${sourceUrl}`);
  }

  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const program = normalizeProgram(htmlToText(heading ?? ""));
  if (!program) throw new Error(`AIST detailの件名を取得できません: ${sourceUrl}`);

  const dateMatch = text.match(/契約日[:：]\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/u);
  if (!dateMatch) throw new Error(`AIST detailの契約日を取得できません: ${sourceUrl}`);
  const date = isoDate(dateMatch[1], dateMatch[2], dateMatch[3]);

  const corporateNumber = text.match(/法人番号[:：]\s*(\d{13})/u)?.[1] ?? "";
  if (!corporateNumber) throw new Error(`AIST detailの法人番号を取得できません: ${sourceUrl}`);

  const partyMatch = text.match(/契約相手方[:：]\s*([^\n]+?)(?=\s*[（(][^\n]*法人番号|\n)/u);
  const partyRaw = partyMatch?.[1]?.trim() ?? "";
  const organization = partyRaw.split(/[（(]/u)[0].trim();
  if (!organization) throw new Error(`AIST detailの契約相手方を取得できません: ${sourceUrl}`);

  const amountMatch = text.match(/契約金額[:：]\s*([\d,]+)円\s*[（(]([^）)]+)[）)]/u);
  if (!amountMatch) throw new Error(`AIST detailの契約金額を取得できません: ${sourceUrl}`);
  const amount = Number(amountMatch[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(amount)) throw new Error(`AIST detailの契約金額が不正です: ${sourceUrl}`);
  const amountStage = `契約金額（${amountMatch[2].trim()}）`;

  const detailId = new URL(sourceUrl).pathname.match(/\/detail\/([^/.]+)/u)?.[1];
  if (!detailId) throw new Error(`AIST detail IDを取得できません: ${sourceUrl}`);

  return {
    id: `aist-${detailId}`,
    organization,
    corporateNumber,
    fiscalYear: fiscalYear(date),
    date,
    program,
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage,
    amount,
    sourceUrl,
    sourcePageUrl: sourceUrl,
    sourceKey: `aist-${detailId}`,
  };
}

async function fetchHtml(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`AIST取得失敗: HTTP ${response.status} ${url}`);
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`AIST応答が短すぎます: ${html.length} bytes ${url}`);
  return html;
}

function mergeRecords(previous, current) {
  const byId = new Map(previous.map((row) => [row.id, row]));
  for (const row of current) {
    const old = byId.get(row.id);
    if (old) {
      const changedIdentity = IDENTITY_FIELDS.filter((field) => (old[field] ?? null) !== (row[field] ?? null));
      if (changedIdentity.length) {
        throw new Error(`AIST既存行の識別項目が変わりました: ${row.id} (${changedIdentity.join(", ")})`);
      }
      if (old.amount !== row.amount || old.amountStage !== row.amountStage) {
        throw new Error(`AIST既存行の公表金額が変わりました: ${row.id}`);
      }
    }
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
    || a.id.localeCompare(b.id));
}

export async function refreshAistOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const listingResults = await Promise.all(AIST_LIST_URLS.map(async (url) =>
    parseAistListingHtml(await fetchHtml(url, fetchImpl), url)));
  const details = [...new Map(listingResults.flat().map((row) => [row.url, row])).values()];
  if (details.length < 20) throw new Error(`AIST落札者公表detailが少なすぎます: ${details.length}/20`);

  const parsed = [];
  const failures = [];
  const batchSize = 8;
  for (let offset = 0; offset < details.length; offset += batchSize) {
    const batch = details.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        return { row: parseAistAwardHtml(await fetchHtml(item.url, fetchImpl), item.url) };
      } catch (error) {
        return { error: `${item.url}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
    for (const result of results) {
      if (result.row) parsed.push(result.row);
      else failures.push(result.error);
    }
  }

  const parseRatio = parsed.length / details.length;
  if (parsed.length < 10 || parseRatio < 0.7) {
    throw new Error(`AIST detail解析率が基準未満です: ${parsed.length}/${details.length} (${(parseRatio * 100).toFixed(1)}%)\n${failures.slice(0, 10).join("\n")}`);
  }

  let previous = { schemaVersion: 1, records: [] };
  try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previous.schemaVersion !== 1 || !Array.isArray(previous.records)) {
    throw new Error("AIST公式補足の既存ファイル形式が不正です");
  }

  const records = mergeRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "aist",
    name: "産業技術総合研究所（産総研）",
    coverageNote: `産総研の「落札者等の公表」一覧（一般競争・政府調達）から、契約相手方・法人番号・契約日・契約金額を定型HTMLで確認できた行を継続取得。今回の一覧 ${details.length}件中 ${parsed.length}件を解析。過去に確認済みの行は一覧掲載終了後も保持する。産総研の全契約・随意契約を網羅するものではない。`,
    listingCount: details.length,
    parsedCount: parsed.length,
    parseFailureCount: failures.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshAistOfficialSupplement();
  console.log(`AIST official supplement: ${output.records.length} retained / ${output.parsedCount}/${output.listingCount} parsed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
