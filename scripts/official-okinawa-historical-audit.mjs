import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const BASE = "https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/";
const INDEX = "https://www.ogb.go.jp/keisan/3842/saitaku/f_03/014671";
const OUTPUT = path.resolve(".audit/okinawa-historical");

// Exact hrefs observed by the official-source discovery run from the Economic
// Industry Department's grant-disclosure index. This audit does not publish
// records; it only pins retrievable source bytes and checks text-PDF viability.
const SOURCES = [
  [2010, "H22fy4_6.pdf"], [2010, "H22fy7_9.pdf"], [2010, "H22fy10_12.pdf"], [2010, "H22fy1_3.pdf"],
  [2011, "H23fy4_6.pdf"], [2011, "H23fy7_9.pdf"], [2011, "H23fy10_12.pdf"], [2011, "H23fy1_3.pdf"],
  [2012, "H24fy4_6.pdf"], [2012, "H24fy7_9.pdf"], [2012, "H24fy10_12.pdf"], [2012, "H24fy1_3.pdf"],
  [2013, "H25fy1.pdf"], [2013, "H25fy2.pdf"],
  [2014, "H26fy1.pdf"], [2014, "H26fy2.pdf"],
  [2015, "H27fy1.pdf"], [2015, "H27fy2.pdf"],
  [2016, "H28fy1.pdf"], [2016, "H28fy2.pdf"],
  [2017, "H29fy1.pdf"], [2017, "H29fy3.pdf"],
  [2018, "H30fyhojokamiki.pdf"], [2018, "H30fyhojoshimoki.pdf"],
  [2019, "31fyhojokamiki.pdf"], [2019, "31fyhojoshimoki.pdf"],
].map(([fiscalYear, filename]) => ({
  fiscalYear,
  filename,
  url: new URL(filename, BASE).href,
}));

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "meti-funding-watch/official-source-audit (+https://github.com/yagiharuka/meti-funding-watch)",
          accept: "application/pdf,*/*;q=0.8",
        },
        redirect: "follow",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) throw new Error(`HTTP ${response.status} (${bytes.length} bytes)`);
      return { bytes, finalUrl: response.url, contentType: response.headers.get("content-type") };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function inspectPdf(bytes) {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("PDF magic missing");
  const document = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false }).promise;
  const pages = [];
  let totalItems = 0;
  let totalNonWhitespaceChars = 0;
  let economicIndustryDepartmentMentions = 0;
  let grantDisclosureMentions = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => typeof item.str === "string" ? item.str : "");
    const text = strings.join(" ");
    const nonWhitespaceChars = text.replace(/\s/g, "").length;
    totalItems += content.items.length;
    totalNonWhitespaceChars += nonWhitespaceChars;
    if (text.includes("沖縄総合事務局") && text.includes("経済産業部")) economicIndustryDepartmentMentions += 1;
    if (text.includes("補助金") && (text.includes("交付") || text.includes("情報"))) grantDisclosureMentions += 1;
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      textItems: content.items.length,
      nonWhitespaceChars,
      sample: text.replace(/\s+/g, " ").slice(0, 240),
    });
    page.cleanup();
  }
  return {
    pageCount: pages.length,
    totalTextItems: totalItems,
    totalNonWhitespaceChars,
    economicIndustryDepartmentMentions,
    grantDisclosureMentions,
    textPdf: totalItems > 0 && totalNonWhitespaceChars > 0,
    pages,
  };
}

await mkdir(OUTPUT, { recursive: true });
const documents = [];
for (const source of SOURCES) {
  const startedAt = new Date().toISOString();
  try {
    const fetched = await fetchBuffer(source.url);
    const sha256 = createHash("sha256").update(fetched.bytes).digest("hex");
    const localName = `${source.fiscalYear}-${source.filename}`;
    await writeFile(path.join(OUTPUT, localName), fetched.bytes);
    const baseObservation = {
      ...source,
      sourcePageUrl: INDEX,
      startedAt,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      bytes: fetched.bytes.length,
      sha256,
      magicHex: fetched.bytes.subarray(0, 16).toString("hex"),
      localName,
    };
    try {
      const inspection = await inspectPdf(fetched.bytes);
      documents.push({ ...baseObservation, status: "retrieved", ...inspection });
      console.log(`OK ${source.filename}: ${fetched.bytes.length} bytes, ${inspection.pageCount} pages, ${inspection.totalTextItems} text items`);
    } catch (error) {
      documents.push({
        ...baseObservation,
        status: "retrieved_unparseable",
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`UNPARSEABLE ${source.filename}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    documents.push({
      ...source,
      sourcePageUrl: INDEX,
      status: "fetch_failed",
      startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FETCH FAIL ${source.filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const parsed = documents.filter((document) => document.status === "retrieved");
const fetched = documents.filter((document) => document.status === "retrieved" || document.status === "retrieved_unparseable");
const report = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  sourcePageUrl: INDEX,
  purpose: "Read-only audit of historical Okinawa Economic Industry Department grant-disclosure PDFs discovered as exact official-index hrefs. No production records are emitted.",
  sourceCount: SOURCES.length,
  fetchedCount: fetched.length,
  parsedCount: parsed.length,
  failedCount: documents.length - parsed.length,
  fetchFailedCount: documents.filter((document) => document.status === "fetch_failed").length,
  unparseableCount: documents.filter((document) => document.status === "retrieved_unparseable").length,
  textPdfCount: parsed.filter((document) => document.textPdf).length,
  totalFetchedBytes: fetched.reduce((sum, document) => sum + document.bytes, 0),
  totalParsedPages: parsed.reduce((sum, document) => sum + document.pageCount, 0),
  totalTextItems: parsed.reduce((sum, document) => sum + document.totalTextItems, 0),
  documents,
};
await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ sourceCount: report.sourceCount, fetchedCount: report.fetchedCount, parsedCount: report.parsedCount, fetchFailedCount: report.fetchFailedCount, unparseableCount: report.unparseableCount }));

if (report.failedCount > 0) process.exitCode = 2;
