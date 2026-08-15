import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";

const SOURCE = {
  indexUrl: "https://rssystem.go.jp/download-csv",
  fiscalYearsUrl: "https://rssystem.go.jp/api/projects/fiscal-years/",
  filesBaseUrl: "https://rssystem.go.jp/files/",
};
const outputPath = new URL("../data/review-cache/", import.meta.url);
const temporaryPath = new URL("../data/.review-cache-next/", import.meta.url);

const candidates = await discoverReviewSheetYears();
const yearly = [];
const unavailable = [];
for (const reviewSheetYear of candidates) {
  try {
    yearly.push(await loadReviewSheetYear(reviewSheetYear));
  } catch (error) {
    unavailable.push({ reviewSheetYear, reason: error instanceof Error ? error.message : String(error) });
  }
}
if (!yearly.length) throw new Error("行政事業レビューの完全な公式CSVセットを1年度も取得できませんでした");

const programs = yearly.flatMap((item) => item.programs).sort((a, b) => b.reviewSheetYear - a.reviewSheetYear || a.projectNumber.localeCompare(b.projectNumber, "ja"));
const payments = yearly.flatMap((item) => item.payments).sort((a, b) => b.reviewSheetYear - a.reviewSheetYear || b.amount - a.amount || a.organization.localeCompare(b.organization, "ja"));
const sourceReceipts = yearly.flatMap((item) => item.receipts);
validate(programs, payments, sourceReceipts);

await rm(temporaryPath, { recursive: true, force: true });
await mkdir(temporaryPath, { recursive: true });
const paymentGroups = new Map();
for (const payment of payments) {
  const bucket = payment.id.at(-1) || "0";
  if (!paymentGroups.has(bucket)) paymentGroups.set(bucket, []);
  paymentGroups.get(bucket).push(payment);
}
const paymentFiles = [...paymentGroups.keys()].sort().map((bucket) => `payments-${bucket}.json`);
await Promise.all([
  writeFile(new URL("programs.json", temporaryPath), `${JSON.stringify(programs)}\n`),
  ...paymentFiles.map((filename) => {
    const bucket = filename.slice("payments-".length, -5);
    return writeFile(new URL(filename, temporaryPath), `${JSON.stringify(paymentGroups.get(bucket))}\n`);
  }),
]);
const manifest = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  sourceUrl: SOURCE.indexUrl,
  reviewSheetYears: yearly.map((item) => item.reviewSheetYear).sort((a, b) => a - b),
  unavailableReviewSheetYears: unavailable,
  programsFile: "programs.json",
  paymentFiles,
  programCount: programs.length,
  paymentCount: payments.length,
  sourceReceipts,
  semantics: {
    paymentAmount: "行政事業レビュー公式CSV『支出先の合計支出額』掲載値",
    aggregationWarning: "上流・中間・終端の支出先を相互に合算しない。契約額・交付決定額・GビズINFO掲載値とも合算しない。",
    negativeSearchWarning: "未掲載・未収録・移行年度の詳細欠落があるため、0件を受給なしとは解釈しない。",
  },
};
await writeFile(new URL("manifest.json", temporaryPath), `${JSON.stringify(manifest, null, 2)}\n`);
await rm(outputPath, { recursive: true, force: true });
await rename(temporaryPath, outputPath);
console.log(`Administrative review: ${manifest.reviewSheetYears.join("・")} sheets / ${programs.length} programs / ${payments.length} payment rows / ${sourceReceipts.length} source receipts`);
if (unavailable.length) console.log(`Unavailable candidate years: ${JSON.stringify(unavailable)}`);

async function discoverReviewSheetYears() {
  try {
    const response = await fetchChecked(SOURCE.fiscalYearsUrl, { accept: "application/json" });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      const years = [...new Set(collectFiscalYears(await response.json()))].filter((year) => year >= 2024).sort((a, b) => a - b);
      if (years.length) return years;
    }
  } catch {}
  const current = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date()));
  return Array.from({ length: Math.max(1, current - 2024 + 1) }, (_, index) => 2024 + index);
}

async function loadReviewSheetYear(reviewSheetYear) {
  const specs = [
    ["organizations", `1-1_RS_${reviewSheetYear}_基本情報_組織情報.zip`],
    ["budgets", `2-1_RS_${reviewSheetYear}_予算・執行_サマリ.zip`],
    ["payments", `5-1_RS_${reviewSheetYear}_支出先_支出情報.zip`],
    ["flows", `5-2_RS_${reviewSheetYear}_支出先_支出ブロックのつながり.zip`],
  ];
  const downloaded = await Promise.all(specs.map(async ([kind, filename]) => {
    const url = new URL(`${reviewSheetYear}/rs/${filename}`, SOURCE.filesBaseUrl).href;
    const response = await fetchChecked(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") throw new Error(`${reviewSheetYear} ${filename}: ZIPシグネチャがありません`);
    const archive = unzipSync(new Uint8Array(buffer));
    const csvName = Object.keys(archive).find((name) => name.endsWith(".csv"));
    if (!csvName) throw new Error(`${reviewSheetYear} ${filename}: ZIP内にCSVがありません`);
    const csv = new TextDecoder("utf-8").decode(archive[csvName]).replace(/^\uFEFF/, "");
    return { kind, filename, csv, receipt: { reviewSheetYear, filename, url, bytes: buffer.length, sha256: sha256(buffer) } };
  }));
  const byKind = Object.fromEntries(downloaded.map((item) => [item.kind, item.csv]));
  const programById = new Map();
  for (const row of csvObjectRows(byKind.organizations)) {
    if (!isMetiReviewRow(row)) continue;
    const projectNumber = cleanCell(row["予算事業ID"]);
    if (!projectNumber || programById.has(projectNumber)) continue;
    const organization = [row["局・庁"], row["部"], row["課"], row["室"]].map(cleanCell).filter(Boolean).join(" / ");
    programById.set(projectNumber, { id: `rs-${reviewSheetYear}-${projectNumber}`, reviewSheetYear, projectNumber, name: cleanCell(row["事業名"]), organization: organization || "経済産業省", budgetFiscalYear: reviewSheetYear, initialBudget: null, availableBudget: null, executionFiscalYear: null, execution: null, executionRate: null, sourceUrl: SOURCE.indexUrl });
  }
  for (const row of csvObjectRows(byKind.budgets)) {
    if (!isMetiReviewRow(row)) continue;
    const project = programById.get(cleanCell(row["予算事業ID"])); if (!project) continue;
    const budgetYear = Number(cleanCell(row["予算年度"]));
    const initialBudget = parseNullableInteger(row["当初予算（合計）"]), availableBudget = parseNullableInteger(row["計（歳出予算現額合計）"]), execution = parseNullableInteger(row["執行額（合計）"]), executionRate = parseNullableNumber(row["執行率"]);
    if (budgetYear === reviewSheetYear) { project.initialBudget = initialBudget; project.availableBudget = availableBudget; }
    if (budgetYear < reviewSheetYear && execution !== null && (project.executionFiscalYear === null || budgetYear > project.executionFiscalYear)) { project.executionFiscalYear = budgetYear; project.execution = execution; project.executionRate = executionRate; }
  }
  const graphByProject = buildReviewGraphs(csvObjectRows(byKind.flows));
  const paymentById = new Map();
  for (const row of csvObjectRows(byKind.payments)) {
    if (!isMetiReviewRow(row)) continue;
    const projectNumber = cleanCell(row["予算事業ID"]), project = programById.get(projectNumber), organization = cleanCell(row["支出先名"]), amount = parseNullableInteger(row["支出先の合計支出額"]), block = cleanCell(row["支出先ブロック番号"]);
    if (!project || !organization || !block || amount === null || amount <= 0) continue;
    const corporateNumberCandidate = cleanCell(row["法人番号"]).replace(/\D/g, ""), corporateNumber = /^\d{13}$/.test(corporateNumberCandidate) ? corporateNumberCandidate : "";
    const graph = graphByProject.get(projectNumber), route = graph ? routeForReviewBlock(graph, block) : ["経済産業省", organization]; route[route.length - 1] = organization;
    const flowDepth = graph?.depth.get(block) ?? null, isIntermediary = isKnownImplementingBody(organization, corporateNumber) || Boolean(graph?.outgoing.has(block));
    const flowLevel = isIntermediary ? "intermediary" : !graph || flowDepth === null ? "unclassified" : "recipient";
    const id = `rs-payment-${stableId([reviewSheetYear, projectNumber, block, corporateNumber || organization, amount])}`;
    paymentById.set(id, { id, fiscalYear: reviewSheetYear - 1, reviewSheetYear, reviewProjectId: project.id, organization, corporateNumber, organizationType: cleanCell(row["法人種別"]), sourceAgency: route.at(-2) || "経済産業省", program: project.name, amount, flowLevel, flowDepth, block, route, sourceName: `行政事業レビュー ${reviewSheetYear}年度シート（支出先）`, sourceUrl: SOURCE.indexUrl, quality: "primary" });
  }
  return { reviewSheetYear, programs: [...programById.values()], payments: [...paymentById.values()], receipts: downloaded.map((item) => item.receipt) };
}

function* csvObjectRows(csvText) { const iterator = parseCsvRows(csvText), first = iterator.next(); if (first.done) return; const headers = first.value.map(cleanCell); for (const row of iterator) yield Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])); }
function* parseCsvRows(text) { let row = [], field = "", quoted = false; for (let index = 0; index < text.length; index += 1) { const ch = text[index]; if (quoted) { if (ch === '"' && text[index + 1] === '"') { field += '"'; index += 1; } else if (ch === '"') quoted = false; else field += ch; } else if (ch === '"') quoted = true; else if (ch === ",") { row.push(field); field = ""; } else if (ch === "\n") { row.push(field); yield row; row = []; field = ""; } else if (ch !== "\r") field += ch; } if (field || row.length) { row.push(field); yield row; } }
function isMetiReviewRow(row) { return cleanCell(row["所管府省庁"] || row["府省庁"]) === "経済産業省"; }
function buildReviewGraphs(rows) { const graphByProject = new Map(); for (const row of rows) { if (!isMetiReviewRow(row)) continue; const projectNumber = cleanCell(row["予算事業ID"]), target = cleanCell(row["支出先の支出先ブロック"]); if (!projectNumber || !target) continue; const graph = graphByProject.get(projectNumber) || { edges: [], depth: new Map(), parent: new Map(), names: new Map(), outgoing: new Set() }; const from = cleanCell(row["支出元の支出先ブロック"]), fromName = cleanCell(row["支出元の支出先ブロック名"]), targetName = cleanCell(row["支出先の支出先ブロック名"]), government = cleanCell(row["担当組織からの支出"]).toUpperCase() === "TRUE"; graph.edges.push({ from, target, government }); if (from) { graph.outgoing.add(from); if (fromName) graph.names.set(from, fromName); } if (targetName) graph.names.set(target, targetName); graphByProject.set(projectNumber, graph); } for (const graph of graphByProject.values()) { for (const edge of graph.edges) if (edge.government) { graph.depth.set(edge.target, 1); graph.parent.set(edge.target, null); } for (let pass = 0; pass < graph.edges.length; pass += 1) { let changed = false; for (const edge of graph.edges) { if (edge.government || !edge.from || !graph.depth.has(edge.from)) continue; const depth = graph.depth.get(edge.from) + 1; if (!graph.depth.has(edge.target) || depth < graph.depth.get(edge.target)) { graph.depth.set(edge.target, depth); graph.parent.set(edge.target, edge.from); changed = true; } } if (!changed) break; } } return graphByProject; }
function routeForReviewBlock(graph, block) { const route = [], visited = new Set(); let current = block; while (current && !visited.has(current)) { visited.add(current); route.unshift(graph.names.get(current) || current); current = graph.parent.get(current) || null; } route.unshift("経済産業省"); return route; }
function isKnownImplementingBody(organization, corporateNumber = "") { return corporateNumber === "2020005008480" || /新エネルギー・産業技術総合開発機構|\bNEDO\b|情報処理推進機構|\bIPA\b|中小企業基盤整備機構|中小機構|石油天然ガス・金属鉱物資源機構|エネルギー・金属鉱物資源機構|\bJOGMEC\b|日本貿易振興機構|\bJETRO\b/.test(organization); }
function parseNullableInteger(value) { if (value === null || value === undefined || cleanCell(String(value)) === "") return null; const n = Number(cleanCell(String(value)).replaceAll(",", "").replace(/[円￥]/g, "")); return Number.isSafeInteger(n) && n >= 0 ? n : null; }
function parseNullableNumber(value) { if (value === null || value === undefined || cleanCell(String(value)) === "") return null; const n = Number(cleanCell(String(value)).replaceAll(",", "")); return Number.isFinite(n) ? n : null; }
function cleanCell(value = "") { return String(value).replace(/^\uFEFF/, "").replace(/[\u3000\s]+/g, " ").trim(); }
function stableId(parts) { return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function collectFiscalYears(value) { if (Array.isArray(value)) return value.flatMap(collectFiscalYears); if (value && typeof value === "object") return Object.values(value).flatMap(collectFiscalYears); const year = Number(value); return Number.isInteger(year) ? [year] : []; }
async function fetchChecked(url, extraHeaders = {}) { const response = await fetch(url, { headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)", ...extraHeaders }, signal: AbortSignal.timeout(3 * 60_000) }); if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`); return response; }
function validate(programs, payments, receipts) { if (!programs.length || !payments.length || receipts.length < 4) throw new Error("行政事業レビューの出力が空です"); if (new Set(programs.map((row) => row.id)).size !== programs.length) throw new Error("行政事業レビュー事業IDが重複しています"); if (new Set(payments.map((row) => row.id)).size !== payments.length) throw new Error("行政事業レビュー支出先IDが重複しています"); for (const row of payments) { if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || !["recipient", "intermediary", "unclassified"].includes(row.flowLevel) || !row.sourceUrl.startsWith("https://")) throw new Error(`行政事業レビュー支出先明細が不正です: ${row.id}`); if (row.corporateNumber && !/^\d{13}$/.test(row.corporateNumber)) throw new Error(`行政事業レビュー法人番号が不正です: ${row.id}`); } for (const receipt of receipts) if (!/^[0-9a-f]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes <= 0) throw new Error(`行政事業レビュー原資料receiptが不正です: ${receipt.filename}`); }
