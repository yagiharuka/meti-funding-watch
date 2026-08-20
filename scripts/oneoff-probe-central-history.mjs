import { createHash } from "node:crypto";
import { parseOfficialWorkbook } from "./update-official-data.mjs";
import { METI_CANDIDATE_DOCUMENTS, ANRE_CANDIDATE_DOCUMENTS } from "./official-meti-anre-history.mjs";
import { JPO_HISTORICAL_DOCUMENTS } from "./official-jpo-history.mjs";

const CAPTURE = "20260602/20260601000000";
const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html;q=0.9,*/*;q=0.1",
};

const candidates = [];
const add = (agency, year, kind, originalUrl, template = null) => candidates.push({ agency, year, kind, originalUrl, template });
const warp = (url) => `https://warp.ndl.go.jp/${CAPTURE}/${url}`;

const metiSeries = [
  ["competitive-goods", "buppin_bid"],
  ["competitive-commission", "itaku_bid"],
  ["competitive-public-works", "kouji_bid"],
  ["discretionary-goods", "buppin_zuikei"],
  ["discretionary-commission", "itaku_zuikei"],
  ["discretionary-public-works", "kouji_zuikei"],
];
for (const year of [2017, 2018, 2019, 2020]) {
  const era = year === 2017 ? "H29" : year === 2018 ? "H30" : year === 2019 ? "R1" : "R2";
  for (const [id, slug] of metiSeries) {
    const template = METI_CANDIDATE_DOCUMENTS.find((row) => row.id.endsWith(`-${id}`));
    add("meti", year, id, `https://www.meti.go.jp/information_2/downloadfiles/${slug}_${era}.xlsx`, template);
  }
}
for (const year of [2017, 2018, 2019, 2020, 2021]) {
  const y = String(year).slice(-2);
  const n = String(year + 1).slice(-2);
  for (const half of ["h1", "h2"]) {
    const first = half === "h1";
    const suffix = first ? `${y}04_${y}09` : `${y}10_${n}03`;
    const template = METI_CANDIDATE_DOCUMENTS.find((row) => row.id.includes(`grant-decisions-${half}`));
    add("meti", year, `grant-${half}`, `https://www.meti.go.jp/information_2/downloadfiles/subs${suffix}.xlsx`, template);
  }
}

const jpoClasses = [
  ["competitive", "kyosonyusatu"],
  ["discretionary", "zuikeyaku"],
];
const jpoSubjects = [
  ["goods", "ukeoi"],
  ["commission", "itaku"],
  ["public-works", "kokyokoji"],
];
for (const year of [2017, 2018, 2019]) {
  for (const [contractClass, directory] of jpoClasses) {
    for (const [subject, slug] of jpoSubjects) {
      const template = JPO_HISTORICAL_DOCUMENTS.find((row) => row.id.includes(`-${contractClass}-${subject}`));
      add("jpo", year, `${contractClass}-${subject}`, `https://www.jpo.go.jp/news/chotatsu/rakusatu/${directory}/document/${year}/${year}_${slug}.xlsx`, template);
    }
  }
  for (const half of ["h1", "h2"]) {
    const suffix = half === "h1" ? "04_09" : "10_03";
    const template = JPO_HISTORICAL_DOCUMENTS.find((row) => row.id.includes(`grant-decisions-${half}`));
    add("jpo", year, `grant-${half}`, `https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/${year}/${year}_${suffix}.xlsx`, template);
  }
}

const smeaSeries = [
  ["competitive-goods", (y) => `nyuusatu_chouhi_${y}.html`],
  ["competitive-commission", (y) => `koukyounyuusatuitaku${y}.html`],
  ["discretionary-goods", (y) => `zuikei_chouhi_${y}.html`],
  ["discretionary-commission", (y) => `zuikei_itaku_${y}.html`],
];
for (const year of [2017, 2018, 2019]) {
  for (const [kind, filename] of smeaSeries) add("smea", year, kind, `https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/${filename(year)}`);
  const era = year === 2017 ? "h29" : year === 2018 ? "h30" : "r1";
  add("smea", year, "grant", `https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/zuikei_hojo_${era}fy04_3.html`);
}

for (const year of [2017, 2018, 2019, 2020, 2021, 2022]) {
  for (const half of ["4-9", "10-3", "4_9", "10_3", "04_09", "10_03"]) {
    const h = half.startsWith("4") || half.startsWith("04") ? "h1" : "h2";
    const template = ANRE_CANDIDATE_DOCUMENTS.find((row) => row.id.includes(`grant-decisions-${h}`));
    add("anre", year, `grant-${half}`, `https://www.enecho.meti.go.jp/appli/conclusion/hojokinkoufu/${year}/${year}_${half}.xlsx`, template);
  }
  for (const dir of ["ippankyousou_chouhi", "ippankyousou_itaku", "zuiikeiyaku_chouhi", "zuiikeiyaku_itaku"]) {
    add("anre", year, `index-${dir}`, `https://www.enecho.meti.go.jp/appli/conclusion/${dir}/${year}/`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function plausibleOfficialHtml(buffer, agency) {
  if (buffer.length < 5000) return false;
  const text = buffer.toString("utf8");
  if (!/<html|<!doctype/i.test(text)) return false;
  if (agency === "smea") return /契約|補助金|交付決定/.test(text) && /<table/i.test(text);
  if (agency === "anre") return /契約|補助金|交付決定|一般競争|随意契約/.test(text);
  return false;
}

async function fetchWarp(originalUrl) {
  const url = warp(originalUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer, url };
  } catch (error) {
    return { response: null, buffer: Buffer.alloc(0), url, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function strictParse(candidate, buffer) {
  if (!candidate.template) return { parsed: false, reason: "no-template" };
  const document = {
    ...candidate.template,
    id: `probe-${candidate.agency}-${candidate.year}-${candidate.kind}`,
    fiscalYear: candidate.year,
    url: candidate.originalUrl,
    originalUrl: undefined,
    sourcePageUrl: candidate.originalUrl,
    expectedSheetCount: undefined,
    expectedNonRecordRows: undefined,
    archiveProvider: undefined,
    archiveExpectedBytes: undefined,
    archiveExpectedSha256: undefined,
    archiveExpectedRecordCount: undefined,
    evidenceExpectedMagic: undefined,
    evidenceExpectedBytes: undefined,
    evidenceExpectedSha256: undefined,
    evidenceExpectedRecordCount: undefined,
  };
  try {
    const rows = await parseOfficialWorkbook(buffer, document);
    return { parsed: true, records: rows.length };
  } catch (error) {
    return { parsed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

const results = [];
for (let i = 0; i < candidates.length; i += 6) {
  const batch = candidates.slice(i, i + 6);
  results.push(...await Promise.all(batch.map(async (candidate) => {
    const fetched = await fetchWarp(candidate.originalUrl);
    const status = fetched.response?.status ?? null;
    const xlsx = fetched.buffer.subarray(0, 4).toString("hex") === "504b0304";
    const html = plausibleOfficialHtml(fetched.buffer, candidate.agency);
    const parsed = xlsx ? await strictParse(candidate, fetched.buffer) : { parsed: false, reason: html ? "html-source" : "not-source" };
    return {
      agency: candidate.agency,
      year: candidate.year,
      kind: candidate.kind,
      originalUrl: candidate.originalUrl,
      warpUrl: fetched.url,
      status,
      bytes: fetched.buffer.length,
      sha256: fetched.buffer.length ? sha256(fetched.buffer) : null,
      xlsx,
      html,
      ...parsed,
      error: fetched.error ?? null,
    };
  })));
}

// Discover archived ANRE monthly workbooks from valid archived year-index pages.
const discovered = [];
for (const row of results.filter((item) => item.agency === "anre" && item.kind.startsWith("index-") && item.html)) {
  const fetched = await fetchWarp(row.originalUrl);
  const html = fetched.buffer.toString("utf8");
  const hrefs = [...html.matchAll(/href=["']([^"']+\.xlsx(?:\?[^"']*)?)["']/gi)].map((match) => match[1]);
  for (const href of hrefs) {
    const originalUrl = new URL(href, row.originalUrl).href;
    if (!originalUrl.startsWith("https://www.enecho.meti.go.jp/")) continue;
    const file = await fetchWarp(originalUrl);
    const xlsx = file.buffer.subarray(0, 4).toString("hex") === "504b0304";
    if (!xlsx) continue;
    discovered.push({
      agency: "anre",
      year: row.year,
      kind: row.kind.replace("index-", "contract-"),
      originalUrl,
      warpUrl: file.url,
      status: file.response?.status ?? null,
      bytes: file.buffer.length,
      sha256: sha256(file.buffer),
      xlsx: true,
    });
  }
}

const actual = results.filter((row) => (row.xlsx && row.parsed) || row.html);
console.log(`CENTRAL_WARP_SUMMARY=${JSON.stringify({ candidates: results.length, actual: actual.length, strictXlsx: results.filter((r) => r.xlsx && r.parsed).length, html: results.filter((r) => r.html).length, anreDiscoveredXlsx: discovered.length })}`);
for (const row of actual) console.log(`CENTRAL_WARP_ACTUAL=${JSON.stringify(row)}`);
for (const row of discovered) console.log(`CENTRAL_WARP_DISCOVERED=${JSON.stringify(row)}`);
for (const row of results.filter((r) => r.xlsx && !r.parsed)) console.log(`CENTRAL_WARP_PARSE_REJECTED=${JSON.stringify(row)}`);
