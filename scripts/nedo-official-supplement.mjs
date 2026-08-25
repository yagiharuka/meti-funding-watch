import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const NEDO_SEARCH_URL = "https://www.nedo.go.jp/activities/startups/gxsearch.html";
const OUTPUT_PATH = "data/official-supplement-nedo.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const IDENTITY_FIELDS = ["organization", "program", "theme", "phase", "supportYears", "category"];
const MIN_LISTING_LINKS = 50;
const DTSU_PROGRAM = "ディープテック・スタートアップ支援事業";
const GX_PROGRAM = "GX分野のディープテック・スタートアップに対する実用化研究開発・量産化実証支援事業";

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

function sectionValue(text, labels, nextLabels) {
  const lines = String(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => labels.includes(line));
  if (start < 0) return "";
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextLabels.includes(lines[index])) break;
    return lines[index];
  }
  return "";
}

function normalizeOrganization(value = "") {
  return String(value).replace(/^NEDO\s*/u, "").trim();
}

function canonicalProgram(value = "") {
  const normalized = String(value).normalize("NFKC").replace(/[\s　]+/g, "").trim();
  if (normalized.includes("GX分野のディープテック・スタートアップ")) return GX_PROGRAM;
  if (normalized.includes("ディープテック・スタートアップ支援事業")) return DTSU_PROGRAM;
  return "";
}

function normalizeSupportYears(value = "") {
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[ \t]/g, "")
    .replace(/[~〜－ー-]/g, "～");
  const range = normalized.match(/(20\d{2})(?:年|年度)?～(20\d{2})(?:年|年度)?/u);
  if (range) return `${range[1]}～${range[2]}年度`;
  const single = normalized.match(/(20\d{2})(?:年|年度)/u);
  return single ? `${single[1]}年度` : "";
}

function amountInYen(tableText = "") {
  const amountMatch = String(tableText).match(/([\d,.]+)\s*(百万円|万円|千円|円)/u);
  if (!amountMatch) return null;
  const value = Number(amountMatch[1].replace(/,/g, ""));
  const multipliers = {
    百万円: 1_000_000,
    万円: 10_000,
    千円: 1_000,
    円: 1,
  };
  const amount = value * multipliers[amountMatch[2]];
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount;
}

function sourceSlug(sourceUrl) {
  const filename = new URL(sourceUrl).pathname.split("/").pop()?.replace(/\.html?$/i, "");
  if (!filename || !/^company[\w-]*$/i.test(filename)) throw new Error(`NEDO company URLが不正です: ${sourceUrl}`);
  return filename;
}

export function parseNedoListingHtml(html, listUrl = NEDO_SEARCH_URL, { minLinks = MIN_LISTING_LINKS } = {}) {
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

  const programRaw = sectionValue(text, ["事業名"], ["研究開発テーマ", "助成事業名", "事業概要", "事業内容"]);
  const program = canonicalProgram(programRaw);
  if (!program) throw new Error(`NEDO事業名を判定できません: ${sourceUrl}`);

  const theme = sectionValue(
    text,
    ["研究開発テーマ", "助成事業名"],
    ["事業概要", "助成事業概要", "事業内容", "助成事業内容", "フェーズ"],
  );
  if (!theme) throw new Error(`NEDO研究開発テーマを取得できません: ${sourceUrl}`);

  const amountHeader = text.indexOf("交付決定額");
  if (amountHeader < 0) throw new Error(`NEDO交付決定額欄がありません: ${sourceUrl}`);
  const tableText = text.slice(amountHeader, amountHeader + 1500);
  const phase = tableText.match(/\b(STS|PCA|DMP)\b/u)?.[1] ?? "";
  const supportYearsMatch = tableText.match(/20\d{2}(?:年|年度)?\s*[～〜~－ー-]\s*20\d{2}(?:年|年度)?|20\d{2}(?:年|年度)/u)?.[0] ?? "";
  const supportYears = normalizeSupportYears(supportYearsMatch);
  if (!phase || !supportYears) throw new Error(`NEDO交付決定表を解析できません: ${sourceUrl}`);

  const tableLines = tableText.split("\n").map((line) => line.trim()).filter(Boolean);
  const supportYearLineIndex = tableLines.findIndex((line) => normalizeSupportYears(line) === supportYears);
  const amountCell = supportYearLineIndex >= 0 ? (tableLines[supportYearLineIndex + 1] ?? "") : "";
  const amount = amountInYen(amountCell);
  if (amount === null) {
    if (/^(?:非公開|―|—|ー|－|-)$/u.test(amountCell)) return null;
    throw new Error(`NEDO交付決定額を解析できません: ${sourceUrl}`);
  }
  const startYear = Number(supportYears.match(/20\d{2}/u)?.[0]);
  if (!Number.isSafeInteger(startYear) || startYear < 2021) {
    throw new Error(`NEDO年度が不正です: ${sourceUrl}`);
  }

  const slug = sourceSlug(sourceUrl);
  return {
    id: `nedo-startup-${slug}`,
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
    sourceKey: `nedo-startup-${slug}`,
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
  if (Number.isInteger(previous.listingCount) && links.length < previous.listingCount) {
    throw new Error(`NEDO掲載ページ数が既存確認値を下回りました: ${links.length}/${previous.listingCount}`);
  }

  const parsed = [];
  const failures = [];
  let amountUnavailableCount = 0;
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
      else amountUnavailableCount += 1;
    }
  }

  if (failures.length) {
    throw new Error(`NEDO detail取得・解析失敗を検出しました: ${failures.length}/${links.length}\n${failures.slice(0, 10).join("\n")}`);
  }
  const previousParsedFloor = Math.max(previous.records.length, Number(previous.parsedCount) || 0);
  if (parsed.length < previousParsedFloor || parsed.length < 40) {
    throw new Error(`NEDO DTSU・GX解析件数が既存収録または最低基準を下回りました: ${parsed.length}/${previousParsedFloor}`);
  }
  if (parsed.length + amountUnavailableCount !== links.length) {
    throw new Error(`NEDO掲載ページの行数会計が一致しません: ${parsed.length}+${amountUnavailableCount}/${links.length}`);
  }

  const records = mergeNedoRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "nedo",
    name: "NEDO",
    coverageNote: `NEDOのDTSU・GX採択事業者検索サイトに掲載された${links.length}ページをすべて確認し、企業名・研究開発テーマ・フェーズ・事業年度・数値で公表された交付決定額を継続取得。今回 ${parsed.length}件を解析し、金額が非公開または記号表示の${amountUnavailableCount}件は0円に変換せず収録対象外とした。過去に確認済みの行は一覧掲載終了後も保持する。NEDOの他事業・調達契約・全支出を網羅するものではない。`,
    listingCount: links.length,
    parsedCount: parsed.length,
    amountUnavailableCount,
    parseFailureCount: failures.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshNedoOfficialSupplement();
  console.log(`NEDO official supplement: ${output.records.length} retained / ${output.parsedCount}/${output.listingCount} DTSU・GX parsed / ${output.amountUnavailableCount} amount unavailable`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
