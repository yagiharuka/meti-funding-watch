import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const NEDO_SEARCH_URL = "https://www.nedo.go.jp/activities/startups/gxsearch.html";
const OUTPUT_PATH = "data/official-supplement-nedo.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const IDENTITY_FIELDS = ["organization", "program", "theme", "phase", "supportYears", "category"];

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
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function sectionValue(text, label, nextLabels) {
  const start = text.indexOf(label);
  if (start < 0) return "";
  const tail = text.slice(start + label.length).replace(/^\s+/, "");
  let end = tail.length;
  for (const next of nextLabels) {
    const index = tail.indexOf(next);
    if (index >= 0 && index < end) end = index;
  }
  return tail.slice(0, end).split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

function normalizeOrganization(value = "") {
  return String(value).replace(/^NEDO\s*/u, "").trim();
}

function normalizeSupportYears(value = "") {
  return String(value).replace(/\s+/g, "").replace(/[~〜～-]/g, "～");
}

function sourceSlug(sourceUrl) {
  const filename = new URL(sourceUrl).pathname.split("/").pop()?.replace(/\.html?$/i, "");
  if (!filename || !/^company[\w-]*$/i.test(filename)) throw new Error(`NEDO company URLが不正です: ${sourceUrl}`);
  return filename;
}

export function parseNedoListingHtml(html, listUrl = NEDO_SEARCH_URL, { minLinks = 10 } = {}) {
  const links = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*\/activities\/startups\/company[\w-]*\.html(?:\?[^"']*)?)["'][^>]*>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = new URL(match[1], listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.nedo.go.jp") continue;
    links.add(url.href);
  }
  const values = [...links].sort();
  if (values.length < minLinks) throw new Error(`NEDO採択事業者リンクが少なすぎます: ${values.length}/${minLinks}`);
  return values;
}

export function parseNedoCompanyHtml(html, sourceUrl) {
  const text = htmlToText(html);
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const organization = normalizeOrganization(htmlToText(heading));
  if (!organization) throw new Error(`NEDO企業名を取得できません: ${sourceUrl}`);

  const program = sectionValue(text, "事業名", ["研究開発テーマ", "事業概要", "事業内容"]);
  if (!program) throw new Error(`NEDO事業名を取得できません: ${sourceUrl}`);
  if (!program.includes("GX分野のディープテック・スタートアップ")) return null;

  const theme = sectionValue(text, "研究開発テーマ", ["事業概要", "事業内容", "フェーズ"]);
  if (!theme) throw new Error(`NEDO研究開発テーマを取得できません: ${sourceUrl}`);

  const amountHeader = text.indexOf("交付決定額");
  if (amountHeader < 0) throw new Error(`NEDO交付決定額欄がありません: ${sourceUrl}`);
  const tableText = text.slice(amountHeader, amountHeader + 1500);
  const phase = tableText.match(/\b(STS|PCA)\b/u)?.[1] ?? "";
  const supportYearsRaw = tableText.match(/(20\d{2})\s*[～~-]\s*(20\d{2})\s*年度/u)?.[0] ?? "";
  const supportYears = normalizeSupportYears(supportYearsRaw);
  const amountMatch = tableText.match(/([\d,.]+)\s*百万円/u);
  if (!phase || !supportYears || !amountMatch) {
    throw new Error(`NEDO交付決定表を解析できません: ${sourceUrl}`);
  }
  const startYear = Number(supportYears.match(/20\d{2}/u)?.[0]);
  const amountMillions = Number(amountMatch[1].replace(/,/g, ""));
  const amount = amountMillions * 1_000_000;
  if (!Number.isSafeInteger(startYear) || startYear < 2021 || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`NEDO年度または交付決定額が不正です: ${sourceUrl}`);
  }

  const slug = sourceSlug(sourceUrl);
  return {
    id: `nedo-gx-${slug}`,
    organization,
    corporateNumber: "",
    fiscalYear: startYear,
    date: null,
    program,
    theme,
    phase,
    supportYears,
    category: "grant_decision",
    amountStage: "交付決定額",
    amount,
    sourceUrl,
    sourcePageUrl: NEDO_SEARCH_URL,
    sourceKey: `nedo-gx-${slug}`,
  };
}

async function fetchHtml(url, fetchImpl = fetch, { minBytes = 1_000 } = {}) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NEDO取得失敗: HTTP ${response.status} ${url}`);
  const html = await response.text();
  if (html.length < minBytes) throw new Error(`NEDO応答が短すぎます: ${html.length}/${minBytes} ${url}`);
  return html;
}

function mergeNedoRecords(previous, current) {
  const previousByUrl = new Map(previous.map((row) => [row.sourceUrl, row]));
  const merged = new Map(previous.map((row) => [row.sourceUrl, row]));
  for (const parsed of current) {
    const old = previousByUrl.get(parsed.sourceUrl);
    const row = old ? {
      ...parsed,
      id: old.id,
      sourceKey: old.sourceKey ?? old.id,
      corporateNumber: old.corporateNumber || parsed.corporateNumber,
    } : parsed;
    if (old) {
      const changedIdentity = IDENTITY_FIELDS.filter((field) => (old[field] ?? "") !== (row[field] ?? ""));
      if (changedIdentity.length) throw new Error(`NEDO既存行の識別項目が変わりました: ${old.id} (${changedIdentity.join(", ")})`);
      if (old.amount !== row.amount || old.amountStage !== row.amountStage) {
        throw new Error(`NEDO既存行の公表金額が変わりました: ${old.id}`);
      }
    }
    merged.set(row.sourceUrl, row);
  }
  return [...merged.values()].sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || a.organization.localeCompare(b.organization, "ja")
    || a.id.localeCompare(b.id));
}

export async function refreshNedoOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "nedo" || !Array.isArray(previous.records)) {
    throw new Error("NEDO公式補足の既存ファイル形式が不正です");
  }

  const listingHtml = await fetchHtml(NEDO_SEARCH_URL, fetchImpl, { minBytes: 20_000 });
  const links = parseNedoListingHtml(listingHtml);
  const parsed = [];
  const failures = [];
  const batchSize = 8;
  for (let offset = 0; offset < links.length; offset += batchSize) {
    const batch = links.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        return { row: parseNedoCompanyHtml(await fetchHtml(url, fetchImpl, { minBytes: 2_000 }), url) };
      } catch (error) {
        return { error: `${url}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
    for (const result of results) {
      if (result.row) parsed.push(result.row);
      else if (result.error) failures.push(result.error);
    }
  }

  if (failures.length) {
    throw new Error(`NEDO detail取得・解析失敗を検出しました: ${failures.length}/${links.length}\n${failures.slice(0, 10).join("\n")}`);
  }
  if (parsed.length < previous.records.length || parsed.length < 5) {
    throw new Error(`NEDO GX解析件数が既存収録を下回りました: ${parsed.length}/${previous.records.length}`);
  }

  const records = mergeNedoRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "nedo",
    name: "NEDO",
    coverageNote: `NEDOのDTSU・GX採択事業者検索サイトから、GX分野のディープテック・スタートアップ支援について企業名・研究開発テーマ・フェーズ・事業年度・交付決定額を定型HTMLで継続取得。今回 ${links.length}ページを確認し、GX ${parsed.length}件を解析。過去に確認済みの行は一覧掲載終了後も保持する。NEDO全事業・全契約を網羅するものではない。`,
    listingCount: links.length,
    parsedCount: parsed.length,
    parseFailureCount: failures.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshNedoOfficialSupplement();
  console.log(`NEDO official supplement: ${output.records.length} retained / ${output.parsedCount}/${output.listingCount} GX parsed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
