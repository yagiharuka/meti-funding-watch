import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const OUTPUT_PATH = "data/official-supplement-jogmec-inventory.json";
const AUDIT_PATH = ".audit/jogmec-inventory.json";
const ALLOWED_HOSTS = new Set(["www.jogmec.go.jp", "jogmec.go.jp"]);
const MAX_HTML_PAGES = 700;
const MAX_DOCUMENTS = 1_500;
const MAX_BYTES = 30 * 1024 * 1024;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const RELEVANT = /(?:契約|入札|落札|随意|調達|公募|採択|補助|助成|交付|委託|結果|公表|情報公開|procurement|bid|tender|contract|award|subsid)/iu;
const RESULT = /(?:契約結果|契約情報|落札結果|入札結果|随意契約|競争契約|公募結果|採択結果|選定結果|交付決定|実施予定先|結果公表|award|result)/iu;
const ANNOUNCEMENT_ONLY = /(?:入札公告|公募公告|調達予定|仕様書|募集要領|公告一覧)/iu;
const DOCUMENT_EXTENSION = /\.(?:pdf|xlsx?|csv)(?:$|[?#])/iu;
const HTML_EXTENSION = /(?:\.html?|\/)(?:$|[?#])/iu;

function clean(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/[\t\r\n 　]+/gu, " ")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (!ALLOWED_HOSTS.has(url.hostname)) return null;
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/u.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of String(html).matchAll(pattern)) {
    const url = canonicalUrl(match[2], baseUrl);
    if (!url) continue;
    const text = clean(match[4]);
    const attrs = clean(`${match[1]} ${match[3]}`);
    const contextStart = Math.max(0, match.index - 180);
    const contextEnd = Math.min(html.length, (match.index ?? 0) + match[0].length + 180);
    const context = clean(html.slice(contextStart, contextEnd));
    links.push({ url, text, attrs, context });
  }
  return links;
}

function titleFromHtml(html) {
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return clean(h1 || title || "");
}

function inferYears(value) {
  const text = clean(value);
  const years = new Set();
  for (const match of text.matchAll(/(?:19|20)\d{2}/gu)) {
    const year = Number(match[0]);
    if (year >= 1990 && year <= new Date().getUTCFullYear() + 1) years.add(year);
  }
  for (const match of text.matchAll(/令和(元|\d{1,2})/gu)) {
    const n = match[1] === "元" ? 1 : Number(match[1]);
    if (n >= 1 && n <= 30) years.add(2018 + n);
  }
  for (const match of text.matchAll(/平成(元|\d{1,2})/gu)) {
    const n = match[1] === "元" ? 1 : Number(match[1]);
    if (n >= 1 && n <= 31) years.add(1988 + n);
  }
  return [...years].sort((a, b) => a - b);
}

function classify(value) {
  const text = clean(value);
  if (/採択結果|公募結果|選定結果|交付決定|実施予定先/iu.test(text)) return "selection_result";
  if (/随意契約/iu.test(text)) return "discretionary_contract";
  if (/落札結果|入札結果/iu.test(text)) return "bid_result";
  if (/契約結果|競争契約|契約情報/iu.test(text)) return "contract_result";
  if (ANNOUNCEMENT_ONLY.test(text) && !RESULT.test(text)) return "announcement_only";
  if (/補助|助成|交付/iu.test(text)) return "grant_related";
  if (/契約|入札|落札|調達|公募|採択/iu.test(text)) return "procurement_related";
  return "unknown";
}

function fileType(url, contentType = "") {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".pdf") || /application\/pdf/iu.test(contentType)) return "pdf";
  if (path.endsWith(".xlsx") || /spreadsheetml/iu.test(contentType)) return "xlsx";
  if (path.endsWith(".xls") || /ms-excel/iu.test(contentType)) return "xls";
  if (path.endsWith(".csv") || /text\/csv/iu.test(contentType)) return "csv";
  if (/text\/html|application\/xhtml/iu.test(contentType) || HTML_EXTENSION.test(url)) return "html";
  return "other";
}

async function fetchResource(url, { expectHtml = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(expectHtml ? 25_000 : 45_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const lengthHeader = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (lengthHeader > MAX_BYTES) throw new Error(`content-length ${lengthHeader} exceeds ${MAX_BYTES}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error(`body ${buffer.length} exceeds ${MAX_BYTES}`);
      if (expectHtml && !/html|xhtml/iu.test(contentType) && buffer.subarray(0, 200).toString("utf8").indexOf("<html") < 0) {
        throw new Error(`not HTML (${contentType})`);
      }
      return {
        requestedUrl: url,
        finalUrl: canonicalUrl(response.url, url) ?? response.url,
        status: response.status,
        contentType,
        bytes: buffer.length,
        sha256: sha256(buffer),
        buffer,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function seedUrls() {
  const values = new Set([
    "https://www.jogmec.go.jp/",
    "https://www.jogmec.go.jp/robots.txt",
    "https://www.jogmec.go.jp/sitemap.xml",
  ]);
  try {
    const source = await readFile("scripts/jogmec-official-supplement.mjs", "utf8");
    for (const match of source.matchAll(/https:\/\/(?:www\.)?jogmec\.go\.jp\/[A-Za-z0-9_./?=&%+-]+/gu)) values.add(match[0]);
  } catch {
    // The current repository may not yet have a dedicated parser.
  }
  return [...values];
}

function sitemapUrls(xml, baseUrl) {
  return [...String(xml).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/giu)]
    .map((match) => canonicalUrl(clean(match[1]), baseUrl))
    .filter(Boolean);
}

async function crawl() {
  const seeds = await seedUrls();
  const queue = [];
  const queued = new Set();
  const pages = [];
  const candidateMap = new Map();
  const failures = [];

  const enqueue = (url, depth, reason) => {
    if (!url || queued.has(url) || queue.length + pages.length >= MAX_HTML_PAGES * 3) return;
    queued.add(url);
    queue.push({ url, depth, reason });
  };

  for (const seed of seeds) {
    if (seed.endsWith("robots.txt")) continue;
    if (seed.endsWith("sitemap.xml")) {
      try {
        const fetched = await fetchResource(seed);
        for (const url of sitemapUrls(fetched.buffer.toString("utf8"), seed)) {
          if (RELEVANT.test(url)) enqueue(url, 0, "sitemap-keyword");
        }
      } catch (error) {
        failures.push({ url: seed, stage: "sitemap", error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    enqueue(seed, 0, "seed");
  }

  while (queue.length && pages.length < MAX_HTML_PAGES && candidateMap.size < MAX_DOCUMENTS) {
    const entry = queue.shift();
    let fetched;
    try {
      fetched = await fetchResource(entry.url, { expectHtml: true });
    } catch (error) {
      failures.push({ url: entry.url, stage: "html", error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const html = fetched.buffer.toString("utf8");
    const title = titleFromHtml(html);
    const pageText = clean(html).slice(0, 30_000);
    const pageClass = classify(`${title} ${entry.url} ${pageText.slice(0, 3_000)}`);
    pages.push({
      url: entry.url,
      finalUrl: fetched.finalUrl,
      depth: entry.depth,
      reason: entry.reason,
      title,
      classification: pageClass,
      bytes: fetched.bytes,
      sha256: fetched.sha256,
    });

    for (const link of linksFromHtml(html, fetched.finalUrl)) {
      const combined = `${link.text} ${link.context} ${link.url}`;
      const isDocument = DOCUMENT_EXTENSION.test(link.url);
      const isResult = RESULT.test(combined);
      const relevant = RELEVANT.test(combined);
      if (isDocument || isResult) {
        const existing = candidateMap.get(link.url);
        const candidate = {
          url: link.url,
          referringPageUrl: fetched.finalUrl,
          referringPageTitle: title,
          anchorText: link.text,
          context: link.context.slice(0, 800),
          classification: classify(combined),
          resultLikely: isResult && !(ANNOUNCEMENT_ONLY.test(combined) && !RESULT.test(combined)),
          inferredYears: inferYears(combined),
        };
        if (!existing || (!existing.resultLikely && candidate.resultLikely) || candidate.context.length > existing.context.length) {
          candidateMap.set(link.url, candidate);
        }
      }
      if (!isDocument && entry.depth < 4 && relevant && !queued.has(link.url)) {
        enqueue(link.url, entry.depth + 1, isResult ? "result-link" : "keyword-link");
      }
    }
  }

  const candidates = [];
  const candidateEntries = [...candidateMap.values()]
    .sort((a, b) => Number(b.resultLikely) - Number(a.resultLikely) || a.url.localeCompare(b.url))
    .slice(0, MAX_DOCUMENTS);
  const concurrency = 8;
  for (let offset = 0; offset < candidateEntries.length; offset += concurrency) {
    const batch = candidateEntries.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (candidate) => {
      try {
        const fetched = await fetchResource(candidate.url);
        const type = fileType(fetched.finalUrl, fetched.contentType);
        let documentTitle = candidate.anchorText;
        let bodyClassification = candidate.classification;
        let bodyYears = candidate.inferredYears;
        if (type === "html") {
          const html = fetched.buffer.toString("utf8");
          documentTitle = titleFromHtml(html) || documentTitle;
          const sample = clean(html).slice(0, 20_000);
          bodyClassification = classify(`${candidate.context} ${documentTitle} ${sample}`);
          bodyYears = [...new Set([...bodyYears, ...inferYears(`${documentTitle} ${sample}`)])].sort((a, b) => a - b);
        }
        return {
          ...candidate,
          finalUrl: fetched.finalUrl,
          title: documentTitle,
          classification: bodyClassification,
          inferredYears: bodyYears,
          fileType: type,
          status: fetched.status,
          contentType: fetched.contentType,
          bytes: fetched.bytes,
          sha256: fetched.sha256,
          fetchError: null,
        };
      } catch (error) {
        return {
          ...candidate,
          finalUrl: candidate.url,
          title: candidate.anchorText,
          fileType: fileType(candidate.url),
          status: null,
          contentType: "",
          bytes: null,
          sha256: null,
          fetchError: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    candidates.push(...results);
    console.error(`JOGMEC inventory: ${Math.min(offset + batch.length, candidateEntries.length)}/${candidateEntries.length} candidates fetched`);
  }

  return { seeds, pages, candidates, failures };
}

const crawled = await crawl();
const fetchedCandidates = crawled.candidates.filter((candidate) => !candidate.fetchError);
const resultCandidates = fetchedCandidates.filter((candidate) => candidate.resultLikely || ["selection_result", "discretionary_contract", "bid_result", "contract_result"].includes(candidate.classification));
const documentCandidates = fetchedCandidates.filter((candidate) => ["pdf", "xlsx", "xls", "csv"].includes(candidate.fileType));
const years = [...new Set(resultCandidates.flatMap((candidate) => candidate.inferredYears))].sort((a, b) => a - b);
if (crawled.pages.length < 5) throw new Error(`JOGMEC公式ページの巡回数が少なすぎます: ${crawled.pages.length}`);
if (!resultCandidates.length) throw new Error("JOGMECの結果公表候補を発見できませんでした");

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  id: "jogmec",
  name: "JOGMEC",
  collectionStatus: "inventory_only",
  scopeNote: "JOGMEC公式サイトの契約・入札・落札・随意契約・公募採択等の結果公表候補を棚卸しした資料台帳。受取先・日付・金額の行解析が完了するまでは収録完了を意味しない。公告・仕様書・募集要領だけの資料は本番明細の対象外とする。",
  seedUrls: crawled.seeds,
  crawledPageCount: crawled.pages.length,
  candidateCount: crawled.candidates.length,
  fetchedCandidateCount: fetchedCandidates.length,
  resultCandidateCount: resultCandidates.length,
  documentCandidateCount: documentCandidates.length,
  fetchFailureCount: crawled.candidates.length - fetchedCandidates.length + crawled.failures.length,
  inferredYears: years,
  pages: crawled.pages,
  candidates: crawled.candidates,
  crawlFailures: crawled.failures,
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
await writeFile(AUDIT_PATH, `${JSON.stringify({
  generatedAt: output.generatedAt,
  collectionStatus: output.collectionStatus,
  crawledPageCount: output.crawledPageCount,
  candidateCount: output.candidateCount,
  fetchedCandidateCount: output.fetchedCandidateCount,
  resultCandidateCount: output.resultCandidateCount,
  documentCandidateCount: output.documentCandidateCount,
  fetchFailureCount: output.fetchFailureCount,
  inferredYears: output.inferredYears,
}, null, 2)}\n`);
console.log(`JOGMEC inventory: ${output.crawledPageCount} pages / ${output.candidateCount} candidates / ${output.resultCandidateCount} result candidates / ${output.documentCandidateCount} documents`);
