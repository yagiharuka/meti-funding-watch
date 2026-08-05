import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";

const dataPath = new URL("../data/funding-data.json", import.meta.url);
const summaryPath = new URL("../data/funding-summary.json", import.meta.url);
const registryPath = new URL("../data/source-registry.json", import.meta.url);
const reviewCachePath = new URL("../data/review-cache/", import.meta.url);

const [current, registry] = await Promise.all([
  readJson(dataPath),
  readJson(registryPath),
]);

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const next = structuredClone(current);
const configured = new Map(
  registry.sources.filter((source) => source.enabled).map((source) => [source.id, source]),
);
const results = [];

next.reviewPrograms ??= [];
next.reviewPayments ??= [];
for (const source of configured.values()) {
  if (!next.sources.some((candidate) => candidate.id === source.id)) {
    next.sources.push({
      id: source.id,
      name: source.name,
      recordCount: 0,
      method: source.method || "公式公開データ",
      frequency: source.frequency || "日次確認",
      lastChecked: "未取得",
      status: "watch",
    });
  }
}

await refreshReviewSheets();
await refreshGbiz();
await refreshNedo();
await refreshGbizBulk();

for (const record of next.records) {
  record.flowLevel = classifyCommitmentFlow(record);
}

next.generatedAt = new Date().toISOString();
next.records.sort((a, b) => {
  return (b.amount ?? -1) - (a.amount ?? -1) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
});

validate(next);
await Promise.all([
  writeFile(dataPath, `${JSON.stringify(next)}\n`),
  writeFile(summaryPath, `${JSON.stringify({
    ...next,
    records: [],
    reviewPrograms: [],
    reviewPayments: [],
  }, null, 2)}\n`),
]);

for (const result of results) {
  console.log(`${result.ok ? "OK" : "STALE"} ${result.name}: ${result.message}`);
}
console.log(`Wrote ${next.records.length.toLocaleString("en-US")} records to ${dataPath.pathname}`);

async function refreshReviewSheets() {
  const source = configured.get("review-sheets");
  if (!source) return;

  try {
    const reviewSheetYear = await discoverLatestReviewSheetYear(source);

    const specifications = {
      organizations: `1-1_RS_${reviewSheetYear}_基本情報_組織情報.zip`,
      budgets: `2-1_RS_${reviewSheetYear}_予算・執行_サマリ.zip`,
      payments: `5-1_RS_${reviewSheetYear}_支出先_支出情報.zip`,
      flows: `5-2_RS_${reviewSheetYear}_支出先_支出ブロックのつながり.zip`,
    };

    const programById = new Map();
    for (const row of csvObjectRows(await downloadReviewCsv(source, reviewSheetYear, specifications.organizations))) {
      if (!isMetiReviewRow(row)) continue;
      const projectNumber = cleanCell(row["予算事業ID"]);
      if (!projectNumber || programById.has(projectNumber)) continue;
      const organization = [row["局・庁"], row["部"], row["課"], row["室"]]
        .map(cleanCell)
        .filter(Boolean)
        .join(" / ");
      programById.set(projectNumber, {
        id: `rs-${reviewSheetYear}-${projectNumber}`,
        reviewSheetYear,
        projectNumber,
        name: cleanCell(row["事業名"]),
        organization: organization || "経済産業省",
        budgetFiscalYear: reviewSheetYear,
        initialBudget: null,
        availableBudget: null,
        executionFiscalYear: null,
        execution: null,
        executionRate: null,
        sourceUrl: source.indexUrl,
      });
    }

    for (const row of csvObjectRows(await downloadReviewCsv(source, reviewSheetYear, specifications.budgets))) {
      if (!isMetiReviewRow(row)) continue;
      const project = programById.get(cleanCell(row["予算事業ID"]));
      if (!project) continue;
      const budgetYear = Number(cleanCell(row["予算年度"]));
      const initialBudget = parseNullableInteger(row["当初予算（合計）"]);
      const availableBudget = parseNullableInteger(row["計（歳出予算現額合計）"]);
      const execution = parseNullableInteger(row["執行額（合計）"]);
      const executionRate = parseNullableNumber(row["執行率"]);
      const isSummaryRow = initialBudget !== null || availableBudget !== null || execution !== null;
      if (!isSummaryRow) continue;

      if (budgetYear === reviewSheetYear) {
        project.initialBudget = initialBudget;
        project.availableBudget = availableBudget;
      }
      if (
        budgetYear < reviewSheetYear &&
        execution !== null &&
        (project.executionFiscalYear === null || budgetYear > project.executionFiscalYear)
      ) {
        project.executionFiscalYear = budgetYear;
        project.execution = execution;
        project.executionRate = executionRate;
      }
    }

    const graphByProject = buildReviewGraphs(
      csvObjectRows(await downloadReviewCsv(source, reviewSheetYear, specifications.flows)),
    );
    const paymentById = new Map();
    for (const row of csvObjectRows(await downloadReviewCsv(source, reviewSheetYear, specifications.payments))) {
      if (!isMetiReviewRow(row)) continue;
      const projectNumber = cleanCell(row["予算事業ID"]);
      const project = programById.get(projectNumber);
      const organization = cleanCell(row["支出先名"]);
      const amount = parseNullableInteger(row["支出先の合計支出額"]);
      const block = cleanCell(row["支出先ブロック番号"]);
      if (!project || !organization || !block || amount === null || amount <= 0) continue;

      const corporateNumberCandidate = cleanCell(row["法人番号"]).replace(/\D/g, "");
      const corporateNumber = /^\d{13}$/.test(corporateNumberCandidate)
        ? corporateNumberCandidate
        : "";
      const graph = graphByProject.get(projectNumber);
      const route = graph ? routeForReviewBlock(graph, block) : ["経済産業省", organization];
      route[route.length - 1] = organization;
      const flowDepth = graph?.depth.get(block) ?? null;
      const isIntermediary = isKnownImplementingBody(organization, corporateNumber)
        || Boolean(graph?.outgoing.has(block));
      const flowLevel = isIntermediary
        ? "intermediary"
        : !graph || flowDepth === null
          ? "unclassified"
          : "recipient";
      const id = `rs-payment-${stableId([
        reviewSheetYear,
        projectNumber,
        block,
        corporateNumber || organization,
        amount,
      ])}`;
      paymentById.set(id, {
        id,
        fiscalYear: reviewSheetYear - 1,
        reviewSheetYear,
        reviewProjectId: project.id,
        organization,
        corporateNumber,
        organizationType: cleanCell(row["法人種別"]),
        sourceAgency: route.at(-2) || "経済産業省",
        program: project.name,
        amount,
        flowLevel,
        flowDepth,
        block,
        route,
        sourceName: `行政事業レビュー ${reviewSheetYear}年度シート（支出先）`,
        sourceUrl: source.indexUrl,
        quality: "primary",
      });
    }

    next.reviewPrograms = [...programById.values()].sort((a, b) => a.projectNumber.localeCompare(b.projectNumber, "ja"));
    next.reviewPayments = [...paymentById.values()].sort((a, b) => {
      return b.amount - a.amount || a.organization.localeCompare(b.organization, "ja");
    });
    await writeReviewCache(reviewSheetYear, next.reviewPrograms, next.reviewPayments);
    updateSource("review-sheets", {
      recordCount: next.reviewPayments.length,
      method: "公式CSV（事業・予算執行・支出先・支出経路）",
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `${reviewSheetYear}年度の経産省 ${next.reviewPrograms.length.toLocaleString("ja-JP")}事業・支出先 ${next.reviewPayments.length.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    try {
      const cached = await loadReviewCache();
      next.reviewPrograms = cached.programs;
      next.reviewPayments = cached.payments;
      updateSource("review-sheets", {
        recordCount: next.reviewPayments.length,
        method: "公式CSV（前回取得キャッシュ）",
        lastChecked: today,
        status: "watch",
      });
      results.push({
        ok: false,
        name: source.name,
        message: `${error instanceof Error ? error.message : String(error)}（${cached.reviewSheetYear}年度の前回取得キャッシュを保持）`,
      });
    } catch {
      markStale("review-sheets", source, error);
    }
  }
}

async function writeReviewCache(reviewSheetYear, programs, payments) {
  await mkdir(reviewCachePath, { recursive: true });
  const paymentGroups = new Map();
  for (const payment of payments) {
    const bucket = payment.id.at(-1) || "0";
    if (!paymentGroups.has(bucket)) paymentGroups.set(bucket, []);
    paymentGroups.get(bucket).push(payment);
  }
  const paymentFiles = [...paymentGroups.keys()]
    .sort()
    .map((bucket) => `payments-${bucket}.json`);
  await Promise.all([
    writeFile(new URL("programs.json", reviewCachePath), `${JSON.stringify(programs)}\n`),
    ...paymentFiles.map((filename) => {
      const bucket = filename.slice("payments-".length, -".json".length);
      return writeFile(new URL(filename, reviewCachePath), `${JSON.stringify(paymentGroups.get(bucket))}\n`);
    }),
  ]);
  await writeFile(new URL("manifest.json", reviewCachePath), `${JSON.stringify({
    reviewSheetYear,
    programsFile: "programs.json",
    paymentFiles,
  }, null, 2)}\n`);
}

async function loadReviewCache() {
  const manifest = await readJson(new URL("manifest.json", reviewCachePath));
  const [programs, ...paymentGroups] = await Promise.all([
    readJson(new URL(manifest.programsFile, reviewCachePath)),
    ...manifest.paymentFiles.map((filename) => readJson(new URL(filename, reviewCachePath))),
  ]);
  const payments = paymentGroups.flat();
  if (!Array.isArray(programs) || !payments.length) throw new Error("レビューシートキャッシュが空です");
  return { reviewSheetYear: manifest.reviewSheetYear, programs, payments };
}

async function discoverLatestReviewSheetYear(source) {
  try {
    const response = await fetchWithTimeout(source.fiscalYearsUrl, { accept: "application/json" });
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      const fiscalYears = collectFiscalYears(await response.json()).filter((year) => year >= 2024);
      const latest = Math.max(...fiscalYears);
      if (Number.isInteger(latest)) return latest;
    }
  } catch {
    // The public frontend API is convenient but not guaranteed; static official files are authoritative.
  }

  const currentYear = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date()));
  for (let candidate = currentYear; candidate >= 2024; candidate -= 1) {
    const filename = `1-1_RS_${candidate}_基本情報_組織情報.zip`;
    const url = new URL(`${candidate}/rs/${filename}`, source.filesBaseUrl).href;
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)" },
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && !contentType.includes("text/html")) return candidate;
  }
  if (Number.isInteger(source.fallbackReviewSheetYear)) {
    return source.fallbackReviewSheetYear;
  }
  throw new Error("公開中のレビューシート年度を判定できません");
}

function collectFiscalYears(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectFiscalYears);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectFiscalYears);
  }
  const year = Number(value);
  return Number.isInteger(year) ? [year] : [];
}

async function downloadReviewCsv(source, reviewSheetYear, filename) {
  const url = new URL(`${reviewSheetYear}/rs/${filename}`, source.filesBaseUrl).href;
  const response = await fetch(url, {
    headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)" },
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!response.ok) throw new Error(`行政事業レビューCSV: ${response.status} ${filename}`);
  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const csvName = Object.keys(archive).find((name) => name.endsWith(".csv"));
  if (!csvName) throw new Error(`行政事業レビューCSV: ZIP内にCSVがありません（${filename}）`);
  return new TextDecoder("utf-8").decode(archive[csvName]).replace(/^\uFEFF/, "");
}

function* csvObjectRows(csvText) {
  const iterator = parseCsvRows(csvText);
  const first = iterator.next();
  if (first.done) return;
  const headers = first.value.map(cleanCell);
  for (const row of iterator) {
    yield Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
  }
}

function isMetiReviewRow(row) {
  return cleanCell(row["所管府省庁"] || row["府省庁"]) === "経済産業省";
}

function buildReviewGraphs(rows) {
  const graphByProject = new Map();
  for (const row of rows) {
    if (!isMetiReviewRow(row)) continue;
    const projectNumber = cleanCell(row["予算事業ID"]);
    const target = cleanCell(row["支出先の支出先ブロック"]);
    if (!projectNumber || !target) continue;
    const graph = graphByProject.get(projectNumber) || {
      edges: [],
      depth: new Map(),
      parent: new Map(),
      names: new Map(),
      outgoing: new Set(),
    };
    const from = cleanCell(row["支出元の支出先ブロック"]);
    const fromName = cleanCell(row["支出元の支出先ブロック名"]);
    const targetName = cleanCell(row["支出先の支出先ブロック名"]);
    const government = cleanCell(row["担当組織からの支出"]).toUpperCase() === "TRUE";
    graph.edges.push({ from, target, government });
    if (from) {
      graph.outgoing.add(from);
      if (fromName) graph.names.set(from, fromName);
    }
    if (targetName) graph.names.set(target, targetName);
    graphByProject.set(projectNumber, graph);
  }

  for (const graph of graphByProject.values()) {
    for (const edge of graph.edges) {
      if (edge.government) {
        graph.depth.set(edge.target, 1);
        graph.parent.set(edge.target, null);
      }
    }
    for (let pass = 0; pass < graph.edges.length; pass += 1) {
      let changed = false;
      for (const edge of graph.edges) {
        if (edge.government || !edge.from || !graph.depth.has(edge.from)) continue;
        const depth = graph.depth.get(edge.from) + 1;
        if (!graph.depth.has(edge.target) || depth < graph.depth.get(edge.target)) {
          graph.depth.set(edge.target, depth);
          graph.parent.set(edge.target, edge.from);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return graphByProject;
}

function routeForReviewBlock(graph, block) {
  const route = [];
  const visited = new Set();
  let current = block;
  while (current && !visited.has(current)) {
    visited.add(current);
    route.unshift(graph.names.get(current) || current);
    current = graph.parent.get(current) || null;
  }
  route.unshift("経済産業省");
  return route;
}

async function refreshGbiz() {
  const source = configured.get("gbiz");
  if (!source) return;

  try {
    const html = await fetchText(source.indexUrl);
    const rowStart = html.indexOf("経済産業省 (小計)");
    if (rowStart < 0) throw new Error("経産省小計行が見つかりません");

    const rowText = stripHtml(html.slice(rowStart, rowStart + 2_000));
    const numbers = [...rowText.matchAll(/\b[\d,]+\b/g)]
      .slice(0, 4)
      .map((match) => Number(match[0].replaceAll(",", "")));

    if (numbers.length < 4 || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error("経産省小計の件数を解析できません");
    }

    const [, subsidies, procurements] = numbers;
    updateSource("gbiz", {
      recordCount: subsidies + procurements,
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `補助金 ${subsidies.toLocaleString("ja-JP")}件、調達 ${procurements.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    markStale("gbiz", source, error);
  }
}

async function refreshGbizBulk() {
  const source = configured.get("gbiz");
  if (!source?.downloadUrl) return;

  const tokenName = source.apiTokenEnv || "GBIZINFO_API_TOKEN";
  const token = process.env[tokenName]?.trim();
  if (!token) {
    results.push({
      ok: true,
      name: "GビズINFO 全件CSV",
      message: `${tokenName}未設定のため全件取得をスキップ`,
    });
    return;
  }

  try {
    const subsidyResult = toGbizBulkRecords(
      await downloadGbizCsv(source.downloadUrl, "Hojokinjoho", token),
      "subsidy",
    );
    const procurementResult = toGbizBulkRecords(
      await downloadGbizCsv(source.downloadUrl, "Chotatsujoho", token),
      "procurement",
    );
    logGbizScan("補助金", subsidyResult.stats);
    logGbizScan("調達", procurementResult.stats);
    const loadedRecords = deduplicate([...subsidyResult.records, ...procurementResult.records]);
    const retainedRecords = next.records.filter((record) => {
      const isGbizImport = record.ingestSource === "gbiz-api" || record.ingestSource === "gbiz-bulk-csv";
      const isLegacyPrototype = !record.ingestSource && /GビズINFO|ものづくり補助金/.test(record.sourceName);
      return !isGbizImport && !isLegacyPrototype;
    });
    const occupiedKeys = new Set(retainedRecords.map(fundingIdentity));
    const newRecords = loadedRecords.filter((record) => !occupiedKeys.has(fundingIdentity(record)));

    next.records = [...retainedRecords, ...newRecords];
    updateSource("gbiz", {
      recordCount: newRecords.length,
      method: "全件CSV / dashboard",
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: "GビズINFO 全件CSV",
      message: `経産省系の全受取先への補助金・調達 ${newRecords.length.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    updateSource("gbiz", { status: "watch" });
    results.push({
      ok: false,
      name: "GビズINFO 全件CSV",
      message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
    });
  }
}

async function downloadGbizCsv(downloadPageUrl, downfile, token) {
  const pageResponse = await fetch(downloadPageUrl, {
    headers: { "user-agent": "meti-funding-watch/0.1 (+public-data-research)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!pageResponse.ok) throw new Error(`GビズINFOダウンロード画面: ${pageResponse.status}`);
  const html = await pageResponse.text();
  const action = html.match(/<form[^>]+action=["']([^"']*\/Download(?:;jsessionid=[^"']+)?)['"][^>]+id=["']down["']/i)?.[1]
    || html.match(/<form[^>]+id=["']down["'][^>]+action=["']([^"']*\/Download(?:;jsessionid=[^"']+)?)['"]/i)?.[1];
  if (!action) throw new Error("GビズINFOの全件ダウンロード先が見つかりません");

  const cookies = typeof pageResponse.headers.getSetCookie === "function"
    ? pageResponse.headers.getSetCookie()
    : [pageResponse.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  const body = new URLSearchParams({
    downfile,
    meta: "META",
    downenc: "UTF-8",
    apiToken: token,
    downtype: "csv",
  });
  const response = await fetch(new URL(action.replaceAll("&amp;", "&"), downloadPageUrl), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader,
      referer: downloadPageUrl,
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
    },
    body,
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!response.ok) throw new Error(`GビズINFO ${downfile}: ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(text)) {
    const error = text.match(/class=["']alert-title-txt["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    throw new Error(`GビズINFO ${downfile}: ${error ? stripHtml(error) : "CSVを取得できませんでした"}`);
  }
  return text.replace(/^\uFEFF/, "");
}

function toGbizBulkRecords(csvText, kind) {
  const iterator = parseCsvRows(csvText);
  const first = iterator.next();
  if (first.done) throw new Error(`GビズINFO ${kind}: CSVが空です`);
  const headers = first.value.map(cleanCell);
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const fields = kind === "procurement"
    ? { date: "受注日", program: "件名", amount: "落札価格", agency: "組織名" }
    : { date: "証明日", program: "名称", amount: "金額", agency: "発行元" };
  for (const header of ["法人番号", "商号または名称", ...Object.values(fields)]) {
    if (!(header in column)) throw new Error(`GビズINFO ${kind}: ${header}列がありません`);
  }

  const records = [];
  const unmatchedAgencies = new Map();
  let totalRows = 0;
  let recipientRows = 0;
  let metiRecipientRows = 0;
  for (const row of iterator) {
    totalRows += 1;
    const corporateNumber = cleanCell(row[column["法人番号"]]).replace(/\D/g, "");
    const organization = cleanCell(row[column["商号または名称"]]);
    const date = parseJapaneseDate(cleanCell(row[column[fields.date]]));
    const program = cleanCell(row[column[fields.program]]);
    const amount = parseAmount(row[column[fields.amount]]);
    const rawAgency = cleanCell(row[column[fields.agency]]);
    const agency = normalizeGbizAgency(rawAgency);
    const sourceKey = "キー情報" in column ? cleanCell(row[column["キー情報"]]) : "";
    const isRecipient = /^\d{13}$/.test(corporateNumber) && Boolean(organization);
    if (isRecipient) recipientRows += 1;
    if (isRecipient && !agency) {
      unmatchedAgencies.set(rawAgency || "（発行元なし）", (unmatchedAgencies.get(rawAgency || "（発行元なし）") || 0) + 1);
    }
    if (!isRecipient || !date || !program || !agency) {
      continue;
    }
    metiRecipientRows += 1;

    const stage = kind === "procurement" ? "contracted" : "subsidy_published";
    records.push({
      id: `gbiz-${stableId([kind, sourceKey || [date, corporateNumber, amount ?? "unknown", program, agency].join("|")])}`,
      fiscalYear: fiscalYear(date),
      date,
      organization,
      corporateNumber,
      sourceAgency: agency,
      program,
      amount,
      stage,
      route: agency === "経済産業省"
        ? ["経済産業省", organization]
        : ["経済産業省", agency, organization],
      sourceName: `GビズINFO 全件CSV（${kind === "procurement" ? "調達" : "補助金"}）`,
      sourceUrl: `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${corporateNumber}`,
      quality: "aggregated",
      ingestSource: "gbiz-bulk-csv",
    });
  }
  return {
    records,
    stats: {
      totalRows,
      recipientRows,
      metiRecipientRows,
      importedRows: records.length,
      unmatchedAgencies: [...unmatchedAgencies.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
    },
  };
}

function logGbizScan(kind, stats) {
  console.log(`SCAN GビズINFO ${kind}: ${JSON.stringify(stats)}`);
}

function normalizeGbizAgency(value) {
  const agencies = [
    ["新エネルギー・産業技術総合開発機構", "NEDO"],
    ["産業技術総合研究所", "AIST"],
    ["経済産業研究所", "RIETI"],
    ["日本原子力研究開発機構", "JAEA"],
    ["情報処理推進機構", "IPA"],
    ["製品評価技術基盤機構", "NITE"],
    ["工業所有権情報・研修館", "INPIT"],
    ["中小企業基盤整備機構", "中小機構"],
    ["石油天然ガス・金属鉱物資源機構", "JOGMEC"],
    ["エネルギー・金属鉱物資源機構", "JOGMEC"],
    ["日本貿易振興機構", "JETRO"],
    ["原子力損害賠償・廃炉等支援機構", "NDF"],
    ["電力広域的運営推進機関", "OCCTO"],
    ["使用済燃料再処理機構", "NuRO"],
    ["原子力発電環境整備機構", "NUMO"],
    ["日本貿易保険", "NEXI"],
    ["日本アルコール産業", "日本アルコール産業"],
    ["商工組合中央金庫", "商工中金"],
    ["産業革新投資機構", "JIC"],
    ["海外需要開拓支援機構", "クールジャパン機構"],
    ["ＧＸ推進機構", "GX推進機構"],
    ["GX推進機構", "GX推進機構"],
    ["高圧ガス保安協会", "KHK"],
    ["日本電気計器検定所", "JEMIC"],
    ["日本商品先物取引協会", "日本商品先物取引協会"],
    ["日本商工会議所", "日本商工会議所"],
    ["全国商工会連合会", "全国商工会連合会"],
    ["全国中小企業団体中央会", "全国中小企業団体中央会"],
    ["全国商店街振興組合連合会", "全国商店街振興組合連合会"],
    ["全国石油商業組合連合会", "全国石油商業組合連合会"],
    ["日本弁理士会", "日本弁理士会"],
    ["東京中小企業投資育成", "東京中小企業投資育成"],
    ["名古屋中小企業投資育成", "名古屋中小企業投資育成"],
    ["大阪中小企業投資育成", "大阪中小企業投資育成"],
    ["北海道経済産業局", "北海道経済産業局"],
    ["東北経済産業局", "東北経済産業局"],
    ["関東経済産業局", "関東経済産業局"],
    ["中部経済産業局", "中部経済産業局"],
    ["近畿経済産業局", "近畿経済産業局"],
    ["中国経済産業局", "中国経済産業局"],
    ["四国経済産業局", "四国経済産業局"],
    ["九州経済産業局", "九州経済産業局"],
    ["資源エネルギー庁", "資源エネルギー庁"],
    ["中小企業庁", "中小企業庁"],
    ["特許庁", "特許庁"],
    ["経済産業省", "経済産業省"],
  ];
  return agencies.find(([needle]) => value.includes(needle))?.[1] || null;
}

async function refreshNedo() {
  const source = configured.get("nedo");
  if (!source) return;

  try {
    const indexHtml = await fetchText(source.indexUrl);
    const csvLinks = discoverCsvLinks(indexHtml, source.indexUrl);
    if (!csvLinks.length) throw new Error("月別CSVが見つかりません");

    const batches = await Promise.all(csvLinks.map(loadNedoCsv));
    const loadedRecords = deduplicate(batches.flat());

    if (!loadedRecords.length) throw new Error("有効な受取先契約を抽出できません");

    next.records = [
      ...next.records.filter((record) => {
        const isMonthlyNedoRecord =
          record.ingestSource === "nedo-monthly-csv" ||
          (record.sourceAgency === "NEDO" && /nedo\.go\.jp\/content\/.*\.csv/.test(record.sourceUrl));
        return !isMonthlyNedoRecord;
      }),
      ...loadedRecords,
    ];
    updateSource("nedo", {
      recordCount: loadedRecords.length,
      lastChecked: today,
      status: "healthy",
    });
    results.push({
      ok: true,
      name: source.name,
      message: `${csvLinks.length}か月分から受取先契約 ${loadedRecords.length.toLocaleString("ja-JP")}件`,
    });
  } catch (error) {
    markStale("nedo", source, error);
  }
}

async function loadNedoCsv(link) {
  const response = await fetchWithTimeout(link.url);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("shift_jis").decode(bytes);
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.includes("契約件名及び品名"));
  if (headerIndex < 0) throw new Error(`${link.label}: ヘッダーが見つかりません`);

  const headers = rows[headerIndex].map(cleanCell);
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = [
    "契約件名及び品名",
    "契約締結日",
    "契約の相手先の名称",
    "法人番号",
    "契約金額（円）",
  ];
  for (const header of required) {
    if (!(header in column)) throw new Error(`${link.label}: ${header}列がありません`);
  }

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const organization = cleanCell(row[column["契約の相手先の名称"]]);
    const corporateNumber = cleanCell(row[column["法人番号"]]).replace(/\D/g, "");
    const amount = Number(cleanCell(row[column["契約金額（円）"]]).replace(/\D/g, ""));
    const date = parseJapaneseDate(cleanCell(row[column["契約締結日"]]));
    const program = cleanCell(row[column["契約件名及び品名"]]);

    if (
      !organization ||
      !/^\d{13}$/.test(corporateNumber) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !date ||
      !program
    ) {
      return [];
    }

    return [{
      id: `nedo-${stableId([date, corporateNumber, amount, program])}`,
      fiscalYear: fiscalYear(date),
      date,
      organization,
      corporateNumber,
      sourceAgency: "NEDO",
      program,
      amount,
      stage: "contracted",
      route: ["経済産業省", "NEDO", organization],
      sourceName: `NEDO ${link.label}契約CSV`,
      sourceUrl: link.url,
      quality: "primary",
      ingestSource: "nedo-monthly-csv",
    }];
  });
}

function discoverCsvLinks(html, indexUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+\.csv(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    links.push({
      url: new URL(match[1], indexUrl).href,
      label: stripHtml(match[2]).replace(/\s+/g, "").trim() || "月別",
    });
  }
  return [...new Map(links.map((link) => [link.url, link])).values()];
}

function parseCsv(text) {
  return [...parseCsvRows(text)];
}

function* parseCsvRows(text) {
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}

function cleanCell(value = "") {
  return value.replace(/^\uFEFF/, "").replace(/[\u3000\s]+/g, " ").trim();
}

function stripHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJapaneseDate(value) {
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const match = value.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function stableId(parts) {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
}

function parseAmount(value) {
  const amount = parseNullableInteger(value);
  return amount !== null && amount > 0 ? amount : null;
}

function parseNullableInteger(value) {
  if (value === null || value === undefined || cleanCell(String(value)) === "") return null;
  const normalized = cleanCell(String(value))
    .replaceAll(",", "")
    .replace(/[円￥]/g, "");
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || cleanCell(String(value)) === "") return null;
  const amount = Number(cleanCell(String(value)).replaceAll(",", ""));
  return Number.isFinite(amount) ? amount : null;
}

function classifyCommitmentFlow(record) {
  if (["recipient", "intermediary", "unclassified"].includes(record.flowLevel)) {
    return record.flowLevel;
  }
  const centralMetiPayers = /経済産業省|経済産業局|資源エネルギー庁|中小企業庁|特許庁/;
  if (centralMetiPayers.test(record.sourceAgency) && isKnownImplementingBody(record.organization, record.corporateNumber)) {
    return "intermediary";
  }
  return "recipient";
}

function isKnownImplementingBody(organization, corporateNumber = "") {
  const corporateNumbers = new Set([
    "2020005008480", // NEDO
  ]);
  const names = /新エネルギー・産業技術総合開発機構|\bNEDO\b|情報処理推進機構|\bIPA\b|中小企業基盤整備機構|中小機構|石油天然ガス・金属鉱物資源機構|エネルギー・金属鉱物資源機構|\bJOGMEC\b|日本貿易振興機構|\bJETRO\b/;
  return corporateNumbers.has(corporateNumber) || names.test(organization);
}

function fundingIdentity(record) {
  const program = record.program.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase("ja-JP");
  return [record.corporateNumber, record.date, record.amount ?? "unknown", program].join("\u001f");
}

function deduplicate(records) {
  const unique = new Map();
  for (const record of records) unique.set(record.id, record);
  return [...unique.values()];
}

function updateSource(id, patch) {
  const source = next.sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`データソース ${id} が funding-data.json にありません`);
  Object.assign(source, patch);
}

function markStale(id, source, error) {
  updateSource(id, { status: "watch" });
  results.push({
    ok: false,
    name: source.name,
    message: `${error instanceof Error ? error.message : String(error)}（前回データを保持）`,
  });
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  return response.text();
}

async function fetchWithTimeout(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "meti-funding-watch/0.1 (+public-data-research)",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

function validate(data) {
  if (
    !Array.isArray(data.records) ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.reviewPrograms) ||
    !Array.isArray(data.reviewPayments)
  ) {
    throw new Error("funding-data.json の構造が不正です");
  }
  const ids = new Set();
  for (const record of data.records) {
    if (ids.has(record.id)) throw new Error(`重複ID: ${record.id}`);
    ids.add(record.id);
    if (!/^\d{13}$/.test(record.corporateNumber)) {
      throw new Error(`法人番号が不正です: ${record.id}`);
    }
    if (record.amount !== null && (!Number.isSafeInteger(record.amount) || record.amount <= 0)) {
      throw new Error(`金額が不正です: ${record.id}`);
    }
    if (!/^https:\/\//.test(record.sourceUrl)) {
      throw new Error(`原典URLが不正です: ${record.id}`);
    }
    if (!["recipient", "intermediary", "unclassified"].includes(record.flowLevel)) {
      throw new Error(`資金レイヤーが不正です: ${record.id}`);
    }
  }
  const reviewPaymentIds = new Set();
  for (const payment of data.reviewPayments) {
    if (reviewPaymentIds.has(payment.id)) throw new Error(`レビュー支出先の重複ID: ${payment.id}`);
    reviewPaymentIds.add(payment.id);
    if (payment.corporateNumber && !/^\d{13}$/.test(payment.corporateNumber)) {
      throw new Error(`レビュー支出先の法人番号が不正です: ${payment.id}`);
    }
    if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      throw new Error(`レビュー支出先の金額が不正です: ${payment.id}`);
    }
    if (!["recipient", "intermediary", "unclassified"].includes(payment.flowLevel)) {
      throw new Error(`レビュー支出先の資金レイヤーが不正です: ${payment.id}`);
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
