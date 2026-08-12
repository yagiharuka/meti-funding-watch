import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import registry from "../data/official-source-registry.json" with { type: "json" };
import { JPO_HISTORICAL_DOCUMENTS } from "./official-jpo-history.mjs";
import { METI_ANRE_CANDIDATE_DOCUMENTS } from "./official-meti-anre-history.mjs";
import { REGIONAL_DOCUMENTS } from "./official-regional-history.mjs";
import { REGIONAL_PDF_DOCUMENTS } from "./official-regional-pdf-sources.mjs";
import { documents as SMEA_DOCUMENTS } from "./official-smea-history.mjs";
import { OFFICIAL_DOCUMENTS } from "./update-official-data.mjs";

const DEFAULT_OUTPUT = new URL("../.audit/official-discovery/report.json", import.meta.url);
const DOCUMENT_EXTENSION = /\.(?:csv|pdf|xls|xlsx|zip)$/i;
const ALLOWED_HOST = /(?:^|\.)(?:go\.jp|ndl\.go\.jp)$/i;

export function knownOfficialUrls() {
  const values = new Set();
  const documents = [
    ...OFFICIAL_DOCUMENTS,
    ...JPO_HISTORICAL_DOCUMENTS,
    ...SMEA_DOCUMENTS,
    ...METI_ANRE_CANDIDATE_DOCUMENTS,
    ...REGIONAL_DOCUMENTS,
    ...REGIONAL_PDF_DOCUMENTS,
  ];
  for (const executor of registry.executors) {
    addUrl(values, executor.contracts);
    addUrl(values, executor.grantDecisions);
  }
  for (const document of documents) {
    for (const key of ["url", "originalUrl", "sourcePageUrl"]) addUrl(values, document?.[key]);
    addUrl(values, document?.verifiedFallback?.url);
  }
  return values;
}

export function extractOfficialLinks(html, sourceUrl) {
  const links = new Set();
  const source = new URL(sourceUrl);
  const pattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(?:javascript|mailto|tel|data):/i.test(raw)) continue;
    try {
      const resolved = canonicalUrl(new URL(raw, sourceUrl));
      if (resolved && isAllowedOfficialUrl(resolved) && new URL(resolved).hostname === source.hostname) links.add(resolved);
    } catch {
      // Broken links are not source candidates. The source page itself remains audited.
    }
  }
  return [...links].sort();
}

export function isDiscoveryCandidate(value) {
  const url = value instanceof URL ? value : new URL(value);
  return DOCUMENT_EXTENSION.test(url.pathname) || isYearPage(url);
}

export function classifyDiscoveredLinks({ links, knownUrls = knownOfficialUrls() }) {
  const candidates = [...new Set(links.map((value) => canonicalUrl(new URL(value))).filter(Boolean))]
    .filter(isDiscoveryCandidate)
    .filter((value) => !knownUrls.has(value))
    .sort();
  return {
    unknownDocuments: candidates.filter((value) => DOCUMENT_EXTENSION.test(new URL(value).pathname)),
    unknownYearPages: candidates.filter((value) => isYearPage(value)),
  };
}

export async function discoverOfficialSources({
  fetchImpl = fetch,
  now = new Date(),
  maxSecondaryPages = 80,
} = {}) {
  const seeds = [...new Set(registry.executors.flatMap((executor) => [executor.contracts, executor.grantDecisions]))]
    .map((value) => canonicalUrl(new URL(value)))
    .filter(Boolean)
    .sort();
  const knownUrls = knownOfficialUrls();
  const fetchedPages = [];
  const failures = [];
  const allLinks = new Set();
  const secondary = new Set();

  const seedResults = await mapLimit(seeds, 4, (sourceUrl) => fetchOfficialIndex(sourceUrl, fetchImpl));
  for (const [index, result] of seedResults.entries()) {
    const sourceUrl = seeds[index];
    if (!result.ok) {
      failures.push(result.failure);
      continue;
    }
    fetchedPages.push(result.receipt);
    for (const link of extractOfficialLinks(result.html, sourceUrl)) {
      allLinks.add(link);
      if (isYearPage(link) && secondary.size < maxSecondaryPages) secondary.add(link);
    }
  }

  const secondaryUrls = [...secondary].sort().filter((sourceUrl) => !seeds.includes(sourceUrl));
  const secondaryResults = await mapLimit(secondaryUrls, 4, (sourceUrl) => fetchOfficialIndex(sourceUrl, fetchImpl));
  for (const [index, result] of secondaryResults.entries()) {
    const sourceUrl = secondaryUrls[index];
    if (!result.ok) {
      failures.push(result.failure);
      continue;
    }
    fetchedPages.push(result.receipt);
    for (const link of extractOfficialLinks(result.html, sourceUrl)) allLinks.add(link);
  }

  const classified = classifyDiscoveredLinks({ links: [...allLinks], knownUrls });
  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    registeredEntrances: seeds.length,
    fetchedPages: fetchedPages.sort((left, right) => left.url.localeCompare(right.url)),
    failures: failures.sort((left, right) => left.url.localeCompare(right.url)),
    ...classified,
  };
}

async function fetchOfficialIndex(sourceUrl, fetchImpl) {
  try {
    const response = await fetchImpl(sourceUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "meti-funding-watch-source-discovery/1.0" },
    });
    if (response.status !== 200) return failure(sourceUrl, `http_${response.status}`);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (type && !type.includes("text/html") && !type.includes("application/xhtml+xml")) return failure(sourceUrl, "unexpected_content_type");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return failure(sourceUrl, "empty_response");
    if (bytes.length > 5_000_000) return failure(sourceUrl, "response_too_large");
    const html = decodeOfficialIndex(bytes, type.match(/\bcharset\s*=\s*([A-Za-z0-9._-]+)/i)?.[1]);
    return { ok: true, html, receipt: { url: sourceUrl, bytes: bytes.length } };
  } catch (error) {
    return failure(sourceUrl, error?.name === "TimeoutError" ? "timeout" : "fetch_failed");
  }
}

function decodeOfficialIndex(bytes, responseCharset = null) {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const declared = header.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([A-Za-z0-9._-]+)/i)?.[1]?.toLowerCase()
    ?? header.match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9._-]+)/i)?.[1]?.toLowerCase();
  const charset = (declared ?? responseCharset ?? "utf-8").toLowerCase();
  const encoding = /^(?:utf-?8)$/.test(charset)
    ? "utf-8"
    : /^(?:shift[_-]?jis|sjis|windows-31j|cp932|ms932)$/.test(charset) ? "shift_jis"
      : /^(?:euc[_-]?jp)$/.test(charset) ? "euc-jp" : null;
  if (!encoding) throw new Error("unsupported_charset");
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function failure(url, reasonCode) {
  return { ok: false, failure: { url, reasonCode } };
}

function isAllowedOfficialUrl(value) {
  const url = new URL(value);
  return url.protocol === "https:" && ALLOWED_HOST.test(url.hostname);
}

function isYearPage(value) {
  const url = value instanceof URL ? value : new URL(value);
  const path = decodeURIComponent(url.pathname);
  const hasYear = /(?:^|[/_.-])(?:19|20)\d{2}(?:[/_.-]|$)/.test(path)
    || /(?:^|[/_.-])r[_-]?0?\d{1,2}(?:[/_.-]|$)/i.test(path);
  return hasYear && (path.endsWith("/") || /\.html?$/i.test(path));
}

function canonicalUrl(url) {
  if (!isAllowedOfficialUrl(url)) return null;
  url.hash = "";
  return url.href;
}

function addUrl(set, value) {
  if (!value) return;
  try {
    const canonical = canonicalUrl(new URL(value));
    if (canonical) set.add(canonical);
  } catch {
    // Definitions are separately schema-tested; discovery ignores an unusable optional URL.
  }
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

async function main() {
  const report = await discoverOfficialSources();
  await mkdir(new URL("../.audit/official-discovery/", import.meta.url), { recursive: true });
  await writeFile(DEFAULT_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`公式入口${report.registeredEntrances}件を確認: 新規資料候補${report.unknownDocuments.length}件、年度ページ候補${report.unknownYearPages.length}件、取得失敗${report.failures.length}件`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
