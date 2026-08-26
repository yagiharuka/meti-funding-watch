import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PARSER_PATH = "scripts/aist-official-supplement.mjs";
const OUTPUT_PATH = ".audit/aist-full-history-inventory.json";
const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const DISCOVERY_KEYWORDS = /(?:procure|procurement|chotatsu|keiyaku|contract|bid|nyusatsu|rakusatsu|zuii|result|kouhyou|公表|調達|契約|入札|落札|随意)/iu;
const DOCUMENT_EXTENSIONS = /\.(?:pdf|xlsx?|csv)(?:$|[?#])/iu;
const HTML_EXTENSIONS = /(?:\.html?(?:$|[?#])|\/$)/iu;
const MAX_CRAWL_PAGES = 120;
const MAX_SAMPLE_DOCUMENTS = 24;

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
    .replace(/[\s　]+/gu, " ")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!/^https?:$/u.test(url.protocol)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function linksFromHtml(html, pageUrl) {
  const headings = [];
  for (const match of String(html).matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/giu)) {
    headings.push({ index: match.index ?? 0, text: clean(match[2]) });
  }
  const links = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const href = match[1].match(/href\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (!href) continue;
    const url = normalizeUrl(href, pageUrl);
    if (!url) continue;
    const nearestHeading = headings.filter((heading) => heading.index <= (match.index ?? 0)).at(-1)?.text ?? "";
    links.push({
      url,
      anchorText: clean(match[2]),
      heading: nearestHeading,
      context: clean(`${nearestHeading} ${match[2]}`),
    });
  }
  return links;
}

function inferFiscalYears(value = "") {
  const text = clean(value);
  const years = new Set();
  for (const match of text.matchAll(/(?:20)(1[0-9]|2[0-9])/gu)) years.add(Number(`20${match[1]}`));
  for (const match of text.matchAll(/令和(元|\d{1,2})年(?:度)?/gu)) {
    const eraYear = match[1] === "元" ? 1 : Number(match[1]);
    years.add(2018 + eraYear);
  }
  for (const match of text.matchAll(/平成(\d{1,2})年(?:度)?/gu)) years.add(1988 + Number(match[1]));
  return [...years].filter((year) => year >= 2000 && year <= 2100).sort((a, b) => a - b);
}

function inferKind(value = "") {
  const text = clean(value);
  if (/随意/u.test(text)) return "discretionary";
  if (/競争|一般競争|指名競争/u.test(text)) return "competitive";
  if (/落札/u.test(text)) return "bid_result";
  if (/契約/u.test(text)) return "contract";
  return "unknown";
}

async function fetchResponse(url, { timeout = 25_000 } = {}) {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url || url,
    contentType: response.headers.get("content-type") ?? "",
    lastModified: response.headers.get("last-modified") ?? null,
    etag: response.headers.get("etag") ?? null,
    buffer,
  };
}

async function pdfSummary(buffer) {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("PDF signature missing");
  }
  const task = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    const limit = Math.min(pdf.numPages, 2);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const text = clean(textContent.items.map((item) => typeof item?.str === "string" ? item.str : "").join(" "));
      pages.push({ pageNumber, text: text.slice(0, 4_000) });
      page.cleanup();
    }
    return { pages: pdf.numPages, samplePages: pages };
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function main() {
  const parserSource = await readFile(PARSER_PATH, "utf8");
  const parserModule = await import(new URL(`../${PARSER_PATH}?diagnostic=${Date.now()}`, import.meta.url));
  const seedUrls = new Set();
  for (const value of Object.values(parserModule)) {
    if (typeof value === "string" && /^https:\/\//u.test(value) && /aist\.go\.jp/iu.test(value)) seedUrls.add(value);
  }
  for (const match of parserSource.matchAll(/https:\/\/[^"'`\s)]+/gu)) {
    if (/aist\.go\.jp/iu.test(match[0])) seedUrls.add(match[0]);
  }
  if (!seedUrls.size) throw new Error("産総研parserから公式入口URLを検出できません");

  const queue = [...seedUrls].map((url) => ({ url, depth: 0, discoveredFrom: null, context: "parser seed" }));
  const visited = new Set();
  const pages = [];
  const candidates = new Map();
  const failures = [];

  while (queue.length && visited.size < MAX_CRAWL_PAGES) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);
    try {
      const response = await fetchResponse(current.url);
      if (!response.ok) {
        failures.push({ url: current.url, status: response.status, phase: "crawl" });
        continue;
      }
      const contentType = response.contentType.toLowerCase();
      const isHtml = contentType.includes("text/html") || /<html\b/iu.test(response.buffer.subarray(0, 2_000).toString("utf8"));
      if (!isHtml) {
        candidates.set(response.finalUrl, {
          url: response.finalUrl,
          discoveredFrom: current.discoveredFrom,
          context: current.context,
          inferredYears: inferFiscalYears(`${current.context} ${response.finalUrl}`),
          inferredKind: inferKind(current.context),
        });
        continue;
      }
      const html = response.buffer.toString("utf8");
      const title = clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "");
      pages.push({
        url: response.finalUrl,
        depth: current.depth,
        title,
        bytes: response.buffer.length,
        sha256: sha256(response.buffer),
      });
      for (const link of linksFromHtml(html, response.finalUrl)) {
        const parsed = new URL(link.url);
        if (!/(?:^|\.)aist\.go\.jp$/iu.test(parsed.hostname)) continue;
        const relevant = DISCOVERY_KEYWORDS.test(`${link.url} ${link.context}`);
        if (DOCUMENT_EXTENSIONS.test(link.url)) {
          if (!relevant && !DISCOVERY_KEYWORDS.test(current.url)) continue;
          const existing = candidates.get(link.url);
          candidates.set(link.url, {
            url: link.url,
            discoveredFrom: response.finalUrl,
            anchorText: link.anchorText,
            heading: link.heading,
            context: link.context,
            inferredYears: inferFiscalYears(`${link.context} ${link.url}`),
            inferredKind: inferKind(link.context),
            duplicateDiscoveryCount: (existing?.duplicateDiscoveryCount ?? 0) + 1,
          });
          continue;
        }
        if (current.depth >= 3 || !HTML_EXTENSIONS.test(link.url) || !relevant) continue;
        queue.push({
          url: link.url,
          depth: current.depth + 1,
          discoveredFrom: response.finalUrl,
          context: link.context,
        });
      }
    } catch (error) {
      failures.push({
        url: current.url,
        phase: "crawl",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const documents = [];
  const candidateValues = [...candidates.values()].sort((a, b) => a.url.localeCompare(b.url));
  for (const candidate of candidateValues) {
    try {
      const response = await fetchResponse(candidate.url, { timeout: 35_000 });
      const document = {
        ...candidate,
        finalUrl: response.finalUrl,
        status: response.status,
        contentType: response.contentType,
        lastModified: response.lastModified,
        etag: response.etag,
        bytes: response.buffer.length,
        sha256: sha256(response.buffer),
        fileType: /\.pdf(?:$|[?#])/iu.test(response.finalUrl) || response.contentType.toLowerCase().includes("pdf")
          ? "pdf"
          : /\.xlsx?(?:$|[?#])/iu.test(response.finalUrl) || /spreadsheet|excel/iu.test(response.contentType)
            ? "spreadsheet"
            : /\.csv(?:$|[?#])/iu.test(response.finalUrl) || response.contentType.toLowerCase().includes("csv")
              ? "csv"
              : "other",
      };
      documents.push(document);
    } catch (error) {
      failures.push({
        url: candidate.url,
        phase: "document",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const samples = [];
  const sampleCandidates = documents
    .filter((document) => document.fileType === "pdf" && document.status >= 200 && document.status < 300)
    .sort((a, b) => {
      const aYear = a.inferredYears.at(-1) ?? -1;
      const bYear = b.inferredYears.at(-1) ?? -1;
      return bYear - aYear || a.inferredKind.localeCompare(b.inferredKind) || a.url.localeCompare(b.url);
    })
    .filter((document, index, values) => {
      const key = `${document.inferredYears.at(-1) ?? "unknown"}-${document.inferredKind}`;
      return values.findIndex((value) => `${value.inferredYears.at(-1) ?? "unknown"}-${value.inferredKind}` === key) === index;
    })
    .slice(0, MAX_SAMPLE_DOCUMENTS);
  for (const document of sampleCandidates) {
    try {
      const response = await fetchResponse(document.finalUrl, { timeout: 35_000 });
      samples.push({
        url: document.finalUrl,
        inferredYears: document.inferredYears,
        inferredKind: document.inferredKind,
        ...(await pdfSummary(response.buffer)),
      });
    } catch (error) {
      failures.push({
        url: document.finalUrl,
        phase: "pdf-sample",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fiscalYears = [...new Set(documents.flatMap((document) => document.inferredYears))].sort((a, b) => a - b);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seedUrls: [...seedUrls].sort(),
    crawlPageCount: pages.length,
    candidateDocumentCount: candidateValues.length,
    fetchedDocumentCount: documents.length,
    pdfCount: documents.filter((document) => document.fileType === "pdf").length,
    spreadsheetCount: documents.filter((document) => document.fileType === "spreadsheet").length,
    csvCount: documents.filter((document) => document.fileType === "csv").length,
    fiscalYears,
    kinds: Object.fromEntries([...new Set(documents.map((document) => document.inferredKind))].sort().map((kind) => [
      kind,
      documents.filter((document) => document.inferredKind === kind).length,
    ])),
    pages,
    documents,
    samples,
    failures,
  };
  await mkdir(".audit", { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    seedUrls: output.seedUrls.length,
    crawlPages: output.crawlPageCount,
    documents: output.fetchedDocumentCount,
    pdfs: output.pdfCount,
    spreadsheets: output.spreadsheetCount,
    years: output.fiscalYears,
    failures: output.failures.length,
  }));

  if (!output.crawlPageCount) throw new Error("産総研公式入口を取得できませんでした");
  if (!output.fetchedDocumentCount) throw new Error("産総研の契約・落札資料候補を取得できませんでした");
  if (!output.fiscalYears.length) throw new Error("産総研資料候補の年度を特定できませんでした");
}

await main();
