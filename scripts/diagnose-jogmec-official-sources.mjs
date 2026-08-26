import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT_DIR = ".audit/jogmec-discovery";
const HOST = "www.jogmec.go.jp";
const MAX_HTML_PAGES = 160;
const MAX_DEPTH = 2;
const FETCH_TIMEOUT_MS = 25_000;
const KEYWORD = /(?:契約|入札|調達|公募|採択|補助|助成|交付|随意|競争|落札|結果|委託)/u;
const RESULT_KEYWORD = /(?:契約結果|入札結果|落札|随意契約|採択結果|公募結果|交付決定|補助金|助成金)/u;
const DOCUMENT_EXT = /\.(?:pdf|xlsx?|csv|zip)(?:$|[?#])/i;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function canonical(raw, base) {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || url.hostname !== HOST) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|yclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function linksFromHtml(html, base) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = canonical(match[1], base);
    if (!url) continue;
    const text = clean(match[2]);
    links.push({ url, text, relevant: KEYWORD.test(`${text} ${url}`) });
  }
  return links;
}

function titleFromHtml(html) {
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  return clean(h1 || title);
}

function yearsFrom(value) {
  const years = new Set();
  const normalized = String(value).normalize("NFKC");
  for (const match of normalized.matchAll(/(?:19|20)\d{2}/g)) years.add(Number(match[0]));
  for (const match of normalized.matchAll(/令和(元|\d{1,2})/g)) years.add(2018 + (match[1] === "元" ? 1 : Number(match[1])));
  for (const match of normalized.matchAll(/平成(\d{1,2})/g)) years.add(1988 + Number(match[1]));
  return [...years].filter((year) => year >= 2000 && year <= 2035).sort((a, b) => a - b);
}

async function fetchResource(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType,
      bytes: buffer.length,
      sha256: sha256(buffer),
      durationMs: Date.now() - startedAt,
      buffer,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      contentType: "",
      bytes: 0,
      sha256: "",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      buffer: Buffer.alloc(0),
    };
  }
}

await mkdir(OUT_DIR, { recursive: true });
const parserSource = await readFile("scripts/jogmec-official-supplement.mjs", "utf8");
const embeddedUrls = [...new Set(parserSource.match(/https:\/\/www\.jogmec\.go\.jp\/[A-Za-z0-9_./?=&%-]+/g) ?? [])]
  .map((value) => canonical(value, value))
  .filter(Boolean);
const seeds = [
  ...embeddedUrls,
  "https://www.jogmec.go.jp/",
  "https://www.jogmec.go.jp/disclosure/",
  "https://www.jogmec.go.jp/news/bid/",
  "https://www.jogmec.go.jp/bid/",
].map((value) => canonical(value, value)).filter(Boolean);

const queue = [...new Set(seeds)].map((url) => ({ url, depth: 0, discoveredFrom: "seed" }));
const visited = new Set();
const htmlPages = [];
const candidates = new Map();
const failures = [];

while (queue.length && visited.size < MAX_HTML_PAGES) {
  const item = queue.shift();
  if (!item || visited.has(item.url)) continue;
  visited.add(item.url);
  const fetched = await fetchResource(item.url);
  if (!fetched.ok) {
    failures.push({ url: item.url, depth: item.depth, status: fetched.status, error: fetched.error ?? `HTTP ${fetched.status}` });
    continue;
  }
  const isHtml = /text\/html|application\/xhtml\+xml/i.test(fetched.contentType) || /<html\b/i.test(fetched.buffer.subarray(0, 2000).toString("utf8"));
  if (!isHtml) {
    candidates.set(item.url, {
      url: item.url,
      title: "",
      sourcePageUrl: item.discoveredFrom,
      status: fetched.status,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
      years: yearsFrom(item.url),
      resultLikely: RESULT_KEYWORD.test(item.url),
      fetched: true,
    });
    continue;
  }
  const html = fetched.buffer.toString("utf8");
  const title = titleFromHtml(html);
  const pageText = clean(html);
  const links = linksFromHtml(html, fetched.finalUrl);
  htmlPages.push({
    url: item.url,
    finalUrl: fetched.finalUrl,
    depth: item.depth,
    title,
    status: fetched.status,
    bytes: fetched.bytes,
    sha256: fetched.sha256,
    relevant: KEYWORD.test(`${title} ${pageText.slice(0, 20_000)}`),
    linkCount: links.length,
  });
  for (const link of links) {
    const descriptor = `${link.text} ${link.url}`;
    if (DOCUMENT_EXT.test(link.url) || RESULT_KEYWORD.test(descriptor)) {
      const existing = candidates.get(link.url);
      candidates.set(link.url, {
        url: link.url,
        title: link.text || existing?.title || "",
        sourcePageUrl: fetched.finalUrl,
        years: yearsFrom(descriptor),
        resultLikely: RESULT_KEYWORD.test(descriptor),
        fetched: existing?.fetched ?? false,
        status: existing?.status ?? null,
        contentType: existing?.contentType ?? "",
        bytes: existing?.bytes ?? 0,
        sha256: existing?.sha256 ?? "",
      });
    }
    if (item.depth < MAX_DEPTH && link.relevant && !visited.has(link.url) && !DOCUMENT_EXT.test(link.url)) {
      queue.push({ url: link.url, depth: item.depth + 1, discoveredFrom: fetched.finalUrl });
    }
  }
}

const candidateList = [...candidates.values()].sort((a, b) =>
  Number(b.resultLikely) - Number(a.resultLikely)
  || (a.years?.[0] ?? 9999) - (b.years?.[0] ?? 9999)
  || a.url.localeCompare(b.url));

for (const candidate of candidateList.filter((row) => DOCUMENT_EXT.test(row.url)).slice(0, 120)) {
  if (candidate.fetched) continue;
  const fetched = await fetchResource(candidate.url);
  candidate.fetched = true;
  candidate.status = fetched.status;
  candidate.contentType = fetched.contentType;
  candidate.bytes = fetched.bytes;
  candidate.sha256 = fetched.sha256;
  if (!fetched.ok) failures.push({ url: candidate.url, status: fetched.status, error: fetched.error ?? `HTTP ${fetched.status}` });
}

const seedJson = JSON.parse(await readFile("data/official-supplement-seeds.json", "utf8"));
const current = seedJson.sources?.find((source) => source.id === "jogmec") ?? null;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  parserEmbeddedUrls: embeddedUrls,
  seedUrls: [...new Set(seeds)],
  crawl: {
    maxDepth: MAX_DEPTH,
    maxHtmlPages: MAX_HTML_PAGES,
    visitedHtmlOrSeedCount: visited.size,
    htmlPageCount: htmlPages.length,
    candidateCount: candidateList.length,
    likelyResultCount: candidateList.filter((row) => row.resultLikely).length,
    fetchedDocumentCount: candidateList.filter((row) => row.fetched).length,
    failureCount: failures.length,
  },
  currentSource: current ? {
    coverageNote: current.coverageNote,
    recordCount: current.records?.length ?? 0,
    records: current.records ?? [],
  } : null,
  htmlPages,
  candidates: candidateList,
  failures,
};
await writeFile(`${OUT_DIR}/jogmec-source-inventory.json`, `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "# JOGMEC公式資料 取得入口診断",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "## 現状",
  "",
  `- 現在の収録行: ${report.currentSource?.recordCount ?? 0}`,
  `- 現在のcoverageNote: ${report.currentSource?.coverageNote ?? "なし"}`,
  "",
  "## 探索結果",
  "",
  `- 訪問URL: ${report.crawl.visitedHtmlOrSeedCount}`,
  `- HTMLページ: ${report.crawl.htmlPageCount}`,
  `- 資料候補: ${report.crawl.candidateCount}`,
  `- 結果資料らしい候補: ${report.crawl.likelyResultCount}`,
  `- 実取得した資料候補: ${report.crawl.fetchedDocumentCount}`,
  `- 取得失敗: ${report.crawl.failureCount}`,
  "",
  "## 上位候補",
  "",
  "| 年 | 種別 | 状態 | 資料名 | URL |",
  "|---:|---|---:|---|---|",
];
for (const row of candidateList.slice(0, 100)) {
  lines.push(`| ${row.years?.join("・") || ""} | ${row.resultLikely ? "結果候補" : "関連"} | ${row.status ?? ""} | ${(row.title || "").replace(/\|/g, "／")} | ${row.url} |`);
}
if (failures.length) {
  lines.push("", "## 取得失敗", "");
  for (const row of failures.slice(0, 50)) lines.push(`- ${row.status ?? "ERR"} ${row.url}: ${row.error}`);
}
await writeFile(`${OUT_DIR}/jogmec-source-inventory.md`, `${lines.join("\n")}\n`);
console.log(JSON.stringify(report.crawl));
