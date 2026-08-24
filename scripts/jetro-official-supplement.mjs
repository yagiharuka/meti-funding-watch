import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const JETRO_LIST_URL = "https://www.jetro.go.jp/procurement/bid.html";
const OUTPUT_PATH = "data/official-supplement-jetro.json";
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
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`JETRO日付が不正です: ${year}-${month}-${day}`);
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function detailSlug(sourceUrl) {
  const match = new URL(sourceUrl).pathname.match(/\/procurement\/bid\/([^/]+)\/([a-f0-9]+)\.html$/i);
  if (!match) throw new Error(`JETRO detail URLが不正です: ${sourceUrl}`);
  return `${match[1]}-${match[2]}`;
}

export function parseJetroListingHtml(html, listUrl = JETRO_LIST_URL, { minLinks = 10 } = {}) {
  const links = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*\/procurement\/bid\/[^/"']+\/[a-f0-9]+\.html(?:\?[^"']*)?)["'][^>]*>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = new URL(match[1], listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.jetro.go.jp") continue;
    links.add(url.href);
  }
  const values = [...links].sort();
  if (values.length < minLinks) throw new Error(`JETRO入札detailリンクが少なすぎます: ${values.length}/${minLinks}`);
  return values;
}

function parseAwardee(text, sourceUrl) {
  const blockMatch = text.match(/落札者\s*([\s\S]*?)(?=\n(?:選定方法|落札金額|公告日|備考)(?:\n|$))/u);
  if (!blockMatch) throw new Error(`JETRO落札者を取得できません: ${sourceUrl}`);
  const lines = blockMatch[1].split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error(`JETRO落札者を取得できません: ${sourceUrl}`);

  const corporateNumber = blockMatch[1].match(/法人番号[:：]\s*(\d{13})/u)?.[1] ?? "";
  const organization = lines[0]
    .replace(/[（(]\s*法人番号[:：].*$/u, "")
    .trim();
  if (!organization) throw new Error(`JETRO落札者名を取得できません: ${sourceUrl}`);
  return { organization, corporateNumber };
}

export function parseJetroDetailHtml(html, sourceUrl) {
  const text = htmlToText(html);
  if (!text.includes("入札結果")) return null;
  if (!text.includes("落札決定日") || !text.includes("落札者") || !text.includes("落札金額")) {
    throw new Error(`JETRO入札結果の必須項目がありません: ${sourceUrl}`);
  }

  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const program = htmlToText(heading).replace(/^入札情報\s*/u, "").trim();
  if (!program) throw new Error(`JETRO件名を取得できません: ${sourceUrl}`);

  const dateMatch = text.match(/落札決定日\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/u);
  if (!dateMatch) throw new Error(`JETRO落札決定日を取得できません: ${sourceUrl}`);
  const date = isoDate(dateMatch[1], dateMatch[2], dateMatch[3]);

  const { organization, corporateNumber } = parseAwardee(text, sourceUrl);

  const amountMatch = text.match(/落札金額\s*([\d,]+)\s*円(?:\s*[（(]([^）)]+)[）)])?/u);
  if (!amountMatch) throw new Error(`JETRO落札金額を取得できません: ${sourceUrl}`);
  const amount = Number(amountMatch[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`JETRO落札金額が不正です: ${sourceUrl}`);
  const note = amountMatch[2]?.trim() ?? "";
  const amountStage = /消費税.*除/u.test(note) ? "落札金額（税抜）" : "落札金額";
  const slug = detailSlug(sourceUrl);

  return {
    id: `jetro-${slug}`,
    organization,
    corporateNumber,
    fiscalYear: fiscalYear(date),
    date,
    program,
    theme: "",
    phase: "",
    supportYears: "",
    category: "bid_result",
    amountStage,
    amount,
    sourceUrl,
    sourcePageUrl: sourceUrl,
    sourceKey: `jetro-${slug}`,
  };
}

async function fetchHtml(url, fetchImpl = fetch, { minBytes = 1_000 } = {}) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`JETRO取得失敗: HTTP ${response.status} ${url}`);
  const html = await response.text();
  if (html.length < minBytes) throw new Error(`JETRO応答が短すぎます: ${html.length}/${minBytes} ${url}`);
  return html;
}

function mergeRecords(previous, current) {
  const byUrl = new Map(previous.map((row) => [row.sourceUrl, row]));
  for (const parsed of current) {
    const old = byUrl.get(parsed.sourceUrl);
    const row = old ? { ...parsed, id: old.id, sourceKey: old.sourceKey ?? old.id } : parsed;
    if (old) {
      const changedIdentity = IDENTITY_FIELDS.filter((field) => (old[field] ?? null) !== (row[field] ?? null));
      if (changedIdentity.length) throw new Error(`JETRO既存行の識別項目が変わりました: ${old.id} (${changedIdentity.join(", ")})`);
      if (old.amount !== row.amount || old.amountStage !== row.amountStage) {
        throw new Error(`JETRO既存行の公表金額が変わりました: ${old.id}`);
      }
    }
    byUrl.set(row.sourceUrl, row);
  }
  return [...byUrl.values()].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
    || a.id.localeCompare(b.id));
}

export async function refreshJetroOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "jetro" || !Array.isArray(previous.records)) {
    throw new Error("JETRO公式補足の既存ファイル形式が不正です");
  }

  const listing = await fetchHtml(JETRO_LIST_URL, fetchImpl, { minBytes: 10_000 });
  const links = parseJetroListingHtml(listing);
  const parsed = [];
  const failures = [];
  const batchSize = 8;
  for (let offset = 0; offset < links.length; offset += batchSize) {
    const batch = links.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        return { row: parseJetroDetailHtml(await fetchHtml(url, fetchImpl, { minBytes: 2_000 }), url) };
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
    throw new Error(`JETRO detail取得・解析失敗を検出しました: ${failures.length}/${links.length}\n${failures.slice(0, 10).join("\n")}`);
  }
  if (parsed.length < 3) {
    throw new Error(`JETRO入札結果の解析件数が少なすぎます: ${parsed.length}/3`);
  }

  const records = mergeRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "jetro",
    name: "JETRO",
    coverageNote: `JETRO公式「入札情報」の直近掲載案件から、入札結果が公表済みで落札者・落札決定日・落札金額を定型HTMLで確認できた行を継続取得。法人番号は公表されている場合のみ保持する。今回 ${links.length}ページを確認し、入札結果 ${parsed.length}件を解析。過去に確認済みの行は一覧掲載終了後も保持する。落札金額は契約金額・実支払額として扱わない。JETROの全入札・随意契約を網羅するものではない。`,
    listingCount: links.length,
    parsedCount: parsed.length,
    parseFailureCount: failures.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshJetroOfficialSupplement();
  console.log(`JETRO official supplement: ${output.records.length} retained / ${output.parsedCount}/${output.listingCount} parsed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
