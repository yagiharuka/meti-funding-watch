import { createHash } from "node:crypto";
import { parseOfficialWorkbook } from "./update-official-data.mjs";
import { METI_CANDIDATE_DOCUMENTS } from "./official-meti-anre-history.mjs";

const CAPTURE = "20260602/20260601000000";
const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.1",
};
const contractSeries = [
  ["competitive-goods", "buppin_bid"],
  ["competitive-commission", "itaku_bid"],
  ["competitive-public-works", "kouji_bid"],
  ["discretionary-goods", "buppin_zuikei"],
  ["discretionary-commission", "itaku_zuikei"],
  ["discretionary-public-works", "kouji_zuikei"],
];
const candidates = [];
for (const year of [2017, 2018, 2019, 2020]) {
  const era = year === 2017 ? "H29" : year === 2018 ? "H30" : year === 2019 ? "R1" : "R2";
  for (const [seriesId, slug] of contractSeries) {
    const template = METI_CANDIDATE_DOCUMENTS.find((row) => row.id.endsWith(`-${seriesId}`));
    candidates.push({ year, type: "contract", seriesId, originalUrl: `https://www.meti.go.jp/information_2/downloadfiles/${slug}_${era}.xlsx`, template });
  }
}
for (const year of [2017, 2018, 2019, 2020, 2021]) {
  const y = String(year).slice(-2);
  const next = String(year + 1).slice(-2);
  for (const half of ["h1", "h2"]) {
    const suffix = half === "h1" ? `${y}04_${y}09` : `${y}10_${next}03`;
    const template = METI_CANDIDATE_DOCUMENTS.find((row) => row.id.includes(`grant-decisions-${half}`));
    candidates.push({ year, type: "grant", seriesId: `grant-decisions-${half}`, originalUrl: `https://www.meti.go.jp/information_2/downloadfiles/subs${suffix}.xlsx`, template });
  }
}
function warp(url) { return `https://warp.ndl.go.jp/${CAPTURE}/${url}`; }
function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

async function probe(candidate) {
  const warpUrl = warp(candidate.originalUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(warpUrl, { headers, redirect: "follow", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
      return { ...candidate, template: undefined, warpUrl, status: response.status, bytes: buffer.length, sha256: sha256(buffer), parsed: false, reason: "not-xlsx" };
    }
    const document = {
      ...candidate.template,
      id: `probe-meti-${candidate.year}-${candidate.seriesId}`,
      fiscalYear: candidate.year,
      url: candidate.originalUrl,
      sourcePageUrl: candidate.originalUrl,
      expectedSheetCount: undefined,
      expectedNonRecordRows: undefined,
      evidenceReceipt: undefined,
      archiveProvider: undefined,
      archiveExpectedBytes: undefined,
      archiveExpectedSha256: undefined,
      archiveExpectedRecordCount: undefined,
      verifiedFallback: undefined,
    };
    try {
      const rows = await parseOfficialWorkbook(buffer, document);
      return { year: candidate.year, type: candidate.type, seriesId: candidate.seriesId, originalUrl: candidate.originalUrl, warpUrl, status: response.status, bytes: buffer.length, sha256: sha256(buffer), parsed: true, records: rows.length };
    } catch (error) {
      return { year: candidate.year, type: candidate.type, seriesId: candidate.seriesId, originalUrl: candidate.originalUrl, warpUrl, status: response.status, bytes: buffer.length, sha256: sha256(buffer), parsed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  } catch (error) {
    return { year: candidate.year, type: candidate.type, seriesId: candidate.seriesId, originalUrl: candidate.originalUrl, warpUrl, status: null, bytes: 0, parsed: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let i = 0; i < candidates.length; i += 6) results.push(...await Promise.all(candidates.slice(i, i + 6).map(probe)));
console.log(`METI_HISTORY_STRICT_SUMMARY=${JSON.stringify({ total: results.length, parsed: results.filter((r) => r.parsed).length, rejected: results.filter((r) => !r.parsed).length, rows: results.filter((r) => r.parsed).reduce((sum, r) => sum + r.records, 0) })}`);
for (const row of results) console.log(`${row.parsed ? "METI_HISTORY_VERIFIED" : "METI_HISTORY_REJECTED"}=${JSON.stringify(row)}`);
