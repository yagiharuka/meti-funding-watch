import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { parseOfficialWorkbook } from "./update-official-data.mjs";

const CAPTURE = "20260602/20260601000000";
const VERIFIED_AT = "2026-08-21";
const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.1",
};

const series = [
  { id: "competitive-goods", slug: "buppin_bid", kind: "競争入札（物品・役務等）" },
  { id: "competitive-commission", slug: "itaku_bid", kind: "競争入札（委託契約）" },
  { id: "competitive-public-works", slug: "kouji_bid", kind: "競争入札（公共工事）", publicWorks: true },
  { id: "discretionary-goods", slug: "buppin_zuikei", kind: "随意契約（物品・役務等）" },
  { id: "discretionary-commission", slug: "itaku_zuikei", kind: "随意契約（委託契約）" },
  { id: "discretionary-public-works", slug: "kouji_zuikei", kind: "随意契約（公共工事）", publicWorks: true },
];

function eraSlug(year) {
  if (year === 2017) return "H29";
  if (year === 2018) return "H30";
  if (year === 2019) return "R1";
  if (year === 2020) return "R2";
  throw new Error(`unsupported legacy year: ${year}`);
}
function contractPage(year) {
  return `https://www.meti.go.jp/information_2/data/${eraSlug(year)}Contract.html`;
}
function warp(url) { return `https://warp.ndl.go.jp/${CAPTURE}/${url}`; }
function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

const candidates = [];
for (const year of [2017, 2018, 2019, 2020]) {
  for (const item of series) {
    const originalUrl = `https://www.meti.go.jp/information_2/downloadfiles/${item.slug}_${eraSlug(year)}.xlsx`;
    candidates.push({
      id: `meti-${year}-${item.id}`,
      fiscalYear: year,
      category: "contract_result",
      kind: item.kind,
      amountStage: "契約金額欄の掲載値",
      originalUrl,
      sourcePageUrl: contractPage(year),
      publicWorks: Boolean(item.publicWorks),
    });
  }
}
for (const year of [2017, 2018, 2019, 2020, 2021]) {
  const y = String(year).slice(-2);
  const n = String(year + 1).slice(-2);
  for (const half of ["h1", "h2"]) {
    const first = half === "h1";
    const suffix = first ? `${y}04_${y}09` : `${y}10_${n}03`;
    candidates.push({
      id: `meti-${year}-grant-decisions-${half}`,
      fiscalYear: year,
      category: "grant_decision",
      kind: `補助金等の交付決定（${first ? "4月～9月" : "10月～3月"}）`,
      amountStage: "交付決定額欄の掲載値",
      originalUrl: `https://www.meti.go.jp/information_2/downloadfiles/subs${suffix}.xlsx`,
      sourcePageUrl: "https://www.meti.go.jp/information_2/publicoffer/index_result_info.html",
      publicWorks: false,
    });
  }
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
}

const receipts = [];
const rejected = [];
for (const candidate of candidates) {
  const url = warp(candidate.originalUrl);
  try {
    const { response, buffer } = await fetchBuffer(url);
    if (!response.ok || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
      rejected.push({ id: candidate.id, reason: `not-xlsx:${response.status}`, bytes: buffer.length });
      continue;
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const expectedSheetCount = workbook.worksheets.length;
    const document = {
      ...candidate,
      executorId: "meti",
      executorName: "経済産業省（本省）",
      url,
      format: "xlsx",
      expectedSheetCount,
      multiplePartyPolicy: "one_official_row",
      ...(candidate.publicWorks ? { headerAliases: { "契約の相手方の商号又は名称": ["契約の相手方の商号または名称"] } } : {}),
    };
    const records = await parseOfficialWorkbook(buffer, document);
    if (!records.length) throw new Error("parsed zero records");
    receipts.push({
      id: candidate.id,
      fiscalYear: candidate.fiscalYear,
      category: candidate.category,
      kind: candidate.kind,
      amountStage: candidate.amountStage,
      originalUrl: candidate.originalUrl,
      sourcePageUrl: candidate.sourcePageUrl,
      url,
      publicWorks: candidate.publicWorks,
      expectedSheetCount,
      expectedBytes: buffer.length,
      expectedSha256: sha256(buffer),
      expectedRecordCount: records.length,
    });
    console.log(`LEGACY_METI_VERIFIED ${candidate.id}: ${records.length} rows`);
  } catch (error) {
    rejected.push({ id: candidate.id, reason: error instanceof Error ? error.message : String(error) });
    console.error(`LEGACY_METI_REJECTED ${candidate.id}: ${rejected.at(-1).reason}`);
  }
}

const recordCount = receipts.reduce((sum, row) => sum + row.expectedRecordCount, 0);
if (!receipts.some((row) => row.fiscalYear === 2017 && row.category === "contract_result")) throw new Error("no FY2017 contract source verified");
if (!receipts.some((row) => row.fiscalYear === 2017 && row.category === "grant_decision")) throw new Error("no FY2017 grant source verified");
if (receipts.length < 20 || recordCount < 3_000) throw new Error(`legacy verification unexpectedly small: ${receipts.length} docs / ${recordCount} rows`);

const output = {
  schemaVersion: 1,
  verifiedAt: VERIFIED_AT,
  verification: "Exact WARP URL Full GET; XLSX ZIP signature; byte length and SHA-256 pinned; observed worksheet count pinned; production strict parser passed and parsed record count pinned.",
  capture: CAPTURE,
  minFiscalYear: 2017,
  maxFiscalYear: 2021,
  documentCount: receipts.length,
  recordCount,
  records: receipts,
};
await writeFile("data/official-meti-legacy-evidence.json", `${JSON.stringify(output, null, 2)}\n`);
await writeFile("meti-legacy-rejected.json", `${JSON.stringify(rejected, null, 2)}\n`);
console.log(`LEGACY_METI_SUMMARY ${receipts.length} documents / ${recordCount} rows / ${rejected.length} rejected`);
