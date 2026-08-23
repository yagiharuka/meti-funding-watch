import { filterCompanyEntities, filterCompanyRecords, INTERNAL_PARTIAL_SEARCH_PREFIX, matchCompanyEntities } from "../scripts/company-search.mjs";

type Stage = "contracted" | "subsidy_published";
type FundingRecord = { id: string; fiscalYear: number | null; date: string | null; organization: string; corporateNumber: string; sourceAgency: string; program: string; amount: number | null; amountRaw?: string; stage: Stage; sourceKey: string; sourceRowNumber: number; sourceSystem: string };
type CompanyEntity = { organization: string; corporateNumber: string; aliases: string[]; bucket: string; records: number };
type CompanySearchIndex = { schemaVersion: 1; generatedAt: string; entityCount: number; recordCount: number; bucketCount: number; agencies: string[]; entities: CompanyEntity[] };
type FileMetadata = { sha256: string; bytes: number; rows: number };
type DataChunkManifest = { generatedAt: string; commitments: Record<string, string> };
type DataRelease = {
  schemaVersion: 1; commitSha: string; generatedAt: string; recordCount: number; idSetSha256: string;
  files: Record<string, FileMetadata>;
  companySearch: { schemaVersion: 1; index: { filename: string; sha256: string; bytes: number; entities: number; records: number; bucketCount: number }; files: Record<string, FileMetadata> };
};
type InitializeMessage = { type: "initialize"; publicBaseUrl: string; manifest: DataChunkManifest; release: DataRelease };
type SearchMessage = { type: "search"; requestId: number | string; parameters: string };

const pageSize = 100;
const detailRowsPerOrganization = 100;
const maxOrganizationSummaries = 50;
let activeMessage: InitializeMessage | null = null;
let companyEntities: CompanyEntity[] = [];
let agencies: string[] = [];
let legacyRecords: FundingRecord[] | null = null;
const bucketRequests = new Map<string, Promise<FundingRecord[]>>();

self.addEventListener("message", (event: MessageEvent<InitializeMessage | SearchMessage>) => {
  if (event.data.type === "initialize") {
    initialize(event.data).catch((error: unknown) => postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  const request = event.data;
  search(request).catch((error: unknown) => postMessage({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) }));
});

async function initialize(message: InitializeMessage) {
  const metadata = message.release.companySearch?.index;
  if (!metadata || metadata.filename !== "gbiz-company-search-index.json") throw new Error("企業検索索引のrelease情報がありません");
  const value = parseJson<unknown>(await loadVerifiedBytes(message, metadata.filename, metadata), metadata.filename);
  validateCompanySearchIndex(value, message);
  activeMessage = message;
  companyEntities = value.entities;
  agencies = value.agencies;
  legacyRecords = null;
  bucketRequests.clear();
  postMessage({ type: "ready", agencies, releaseCommit: message.release.commitSha, generatedAt: message.release.generatedAt });
}

function validateCompanySearchIndex(value: unknown, message: InitializeMessage): asserts value is CompanySearchIndex {
  if (!value || typeof value !== "object") throw new Error("企業検索索引の形式が不正です");
  const index = value as Partial<CompanySearchIndex>;
  const metadata = message.release.companySearch.index;
  if (index.schemaVersion !== 1 || index.generatedAt !== message.release.generatedAt || index.entityCount !== metadata.entities
    || index.recordCount !== message.release.recordCount || index.recordCount !== metadata.records || index.bucketCount !== metadata.bucketCount
    || !Array.isArray(index.agencies) || index.agencies.some((agency) => typeof agency !== "string" || !agency)
    || !Array.isArray(index.entities) || index.entities.length !== index.entityCount) throw new Error("企業検索索引がreleaseと一致しません");
  for (const entity of index.entities) {
    if (typeof entity?.organization !== "string" || !entity.organization || !/^\d{13}$/.test(entity.corporateNumber)
      || !Array.isArray(entity.aliases) || entity.aliases.some((alias) => typeof alias !== "string") || !/^[0-9a-f]{2}$/.test(entity.bucket)) {
      throw new Error("企業検索索引の法人情報が不正です");
    }
    if (!Number.isSafeInteger(entity.records) || entity.records < 1) throw new Error("企業検索索引の掲載件数が不正です");
  }
}

async function search(message: SearchMessage) {
  if (!activeMessage) throw new Error("検索データの検証が完了していません");
  const parameters = new URLSearchParams(message.parameters);
  const query = (parameters.get("q") ?? "").trim();
  const agency = parameters.get("agency") ?? "all";
  const stage = parameters.get("stage") ?? "all";
  const year = parameters.get("year") ?? "all";
  const page = Number(parameters.get("page") ?? "1");
  validateParameters({ query, agency, stage, year, page });

  if (query.startsWith(INTERNAL_PARTIAL_SEARCH_PREFIX) && agency === "all" && stage === "all" && year === "all") {
    postIndexOnlyAlternatives(message, query);
    return;
  }

  let matching: FundingRecord[];
  let alternativeOrganizations: Array<{ name: string; corporateNumber: string; records: number }> = [];
  let alternativeOrganizationCount = 0;
  if (query) {
    const entityMatches = matchCompanyEntities(companyEntities, query) as {
      exact: CompanyEntity[];
      contains: CompanyEntity[];
      primary: CompanyEntity[];
    };
    const matchedEntities = entityMatches.primary;
    if (entityMatches.exact.length) {
      const primaryNumbers = new Set(matchedEntities.map((entity) => entity.corporateNumber));
      const alternatives = entityMatches.contains
        .filter((entity) => !primaryNumbers.has(entity.corporateNumber))
        .sort((left, right) => right.records - left.records || left.organization.localeCompare(right.organization, "ja"));
      alternativeOrganizationCount = alternatives.length;
      alternativeOrganizations = alternatives.slice(0, maxOrganizationSummaries)
        .map((entity) => ({ name: entity.organization, corporateNumber: entity.corporateNumber, records: entity.records }));
    }
    const numbers = new Set(matchedEntities.map((entity) => entity.corporateNumber));
    const buckets = [...new Set(matchedEntities.map((entity) => entity.bucket))];
    const rows = (await Promise.all(buckets.map(loadCompanyBucket))).flat();
    matching = rows.filter((row) => numbers.has(row.corporateNumber)
      && (agency === "all" || row.sourceAgency === agency) && (stage === "all" || row.stage === stage)
      && (year !== "unclassified" || row.fiscalYear === null) && (!/^\d{4}$/.test(year) || String(row.fiscalYear) === year));
  } else {
    matching = filterCompanyRecords(await loadAllLegacyRecords(), { query, agency, stage, year }) as FundingRecord[];
  }
  matching = sortFundingRecords(matching);
  const totalRecords = matching.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const offset = (effectivePage - 1) * pageSize;
  const summary = summarizeFundingRecords(matching);
  const organizationSummaries = query ? summarizeOrganizations(matching).slice(0, maxOrganizationSummaries) : [];
  postMessage({ type: "result", requestId: message.requestId, result: {
    totalRecords, totalPages, page: effectivePage, pageSize, records: matching.slice(offset, offset + pageSize), summary,
    organizationSummaries, organizationSummariesTruncated: Boolean(query && summary.organizationCount > maxOrganizationSummaries),
    alternativeOrganizations, alternativeOrganizationCount,
    releaseCommit: activeMessage.release.commitSha, generatedAt: activeMessage.release.generatedAt,
  } });
}

function postIndexOnlyAlternatives(message: SearchMessage, query: string) {
  if (!activeMessage) throw new Error("検索データの検証が完了していません");
  const matched = filterCompanyEntities(companyEntities, query) as CompanyEntity[];
  const organizations = matched
    .map((entity) => ({ name: entity.organization, corporateNumber: entity.corporateNumber, records: entity.records }))
    .sort((left, right) => right.records - left.records || left.name.localeCompare(right.name, "ja"));
  const totalRecords = organizations.reduce((sum, organization) => sum + organization.records, 0);
  postMessage({ type: "result", requestId: message.requestId, result: {
    totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)), page: 1, pageSize, records: [],
    summary: { amountKnownTotal: 0, amountKnownCount: 0, amountUnknownCount: 0, organizationCount: organizations.length, organizations: [], byStage: [], byYear: [], topPrograms: [] },
    organizationSummaries: organizations.slice(0, maxOrganizationSummaries),
    organizationSummariesTruncated: organizations.length > maxOrganizationSummaries,
    releaseCommit: activeMessage.release.commitSha, generatedAt: activeMessage.release.generatedAt,
  } });
}

function validateParameters({ query, agency, stage, year, page }: { query: string; agency: string; stage: string; year: string; page: number }) {
  if (query.length > 100) throw new Error("検索語は100文字以内です");
  if (agency !== "all" && !agencies.includes(agency)) throw new Error("公表組織が検索対象にありません");
  if (stage !== "all" && stage !== "contracted" && stage !== "subsidy_published") throw new Error("掲載区分が不正です");
  if (year !== "all" && year !== "unclassified" && !/^\d{4}$/.test(year)) throw new Error("年度が不正です");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new Error("ページが不正です");
}

async function loadCompanyBucket(bucket: string) {
  if (!activeMessage) throw new Error("検索データの検証が完了していません");
  const filename = `gbiz-company-records-${bucket}.json`;
  const existing = bucketRequests.get(filename);
  if (existing) return existing;
  const metadata = activeMessage.release.companySearch.files[filename];
  if (!metadata) throw new Error(`${filename}のrelease情報がありません`);
  const request = loadVerifiedBytes(activeMessage, filename, metadata).then((bytes) => parseRows(bytes, filename)).then((rows) => {
    if (rows.length !== metadata.rows) throw new Error(`${filename}の行数が一致しません`);
    return rows;
  }).catch((error) => { bucketRequests.delete(filename); throw error; });
  bucketRequests.set(filename, request);
  return request;
}

async function loadAllLegacyRecords() {
  if (legacyRecords) return legacyRecords;
  if (!activeMessage) throw new Error("検索データの検証が完了していません");
  const message = activeMessage;
  const entries = Object.entries(message.manifest.commitments).sort(([left], [right]) => left.localeCompare(right));
  const loaded = await Promise.all(entries.map(async ([yearKey, filename]) => ({ yearKey, filename, rows: parseRows(await loadVerifiedBytes(message, filename, message.release.files[filename]), filename) })));
  const ids = new Set<string>();
  const rows: FundingRecord[] = [];
  for (const item of loaded) {
    const metadata = message.release.files[item.filename];
    if (!metadata || item.rows.length !== metadata.rows) throw new Error(`${item.filename}の行数が一致しません`);
    for (const row of item.rows) {
      if (item.yearKey === "unclassified" ? row.fiscalYear !== null : String(row.fiscalYear) !== item.yearKey) throw new Error(`${item.filename}の年度がmanifestと一致しません`);
      if (ids.has(row.id)) throw new Error("公開明細IDが重複しています");
      ids.add(row.id); rows.push(row);
    }
  }
  if (rows.length !== message.release.recordCount) throw new Error("公開明細の総行数がreleaseと一致しません");
  const idSetBytes = new TextEncoder().encode(`${[...ids].sort().join("\n")}\n`);
  if (await sha256(idSetBytes.buffer) !== message.release.idSetSha256) throw new Error("公開明細のID集合がreleaseと一致しません");
  legacyRecords = sortFundingRecords(rows);
  return legacyRecords;
}

async function loadVerifiedBytes(message: InitializeMessage, filename: string, metadata?: FileMetadata) {
  if (!metadata) throw new Error(`${filename}のrelease情報がありません`);
  const dataUrl = new URL(`data/${filename}`, message.publicBaseUrl);
  dataUrl.searchParams.set("release", message.release.commitSha);
  const response = await fetch(dataUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`${filename}を取得できません（HTTP ${response.status}）`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== metadata.bytes) throw new Error(`${filename}のバイト数が一致しません`);
  if (await sha256(bytes) !== metadata.sha256) throw new Error(`${filename}のSHA-256が一致しません`);
  return bytes;
}

function summarizeOrganizations(rows: FundingRecord[]) {
  const groups = new Map<string, FundingRecord[]>();
  for (const row of rows) { const current = groups.get(row.corporateNumber); if (current) current.push(row); else groups.set(row.corporateNumber, [row]); }
  return [...groups.values()].map(summarizeOrganization).sort((left, right) => right.records - left.records || left.name.localeCompare(right.name, "ja"));
}
function emptyYearStage() { return { records: 0, amount: 0, amountKnownCount: 0 }; }
function summarizeOrganization(rows: FundingRecord[]) {
  const first = rows[0];
  const stages = new Map<Stage, { stage: Stage; records: number; amount: number; amountKnownCount: number }>();
  const years = new Map<string, { fiscalYear: number | null; contracted: ReturnType<typeof emptyYearStage>; subsidy_published: ReturnType<typeof emptyYearStage>; amountUnknownCount: number }>();
  const programs = new Map<string, { stage: Stage; program: string; records: number; amount: number; amountKnownCount: number }>();
  let amountUnknownCount = 0;
  for (const row of rows) {
    if (row.amount === null) amountUnknownCount += 1;
    const amount = row.amount ?? 0;
    const stageItem = stages.get(row.stage) ?? { stage: row.stage, records: 0, amount: 0, amountKnownCount: 0 };
    stageItem.records += 1; stageItem.amount += amount; if (row.amount !== null) stageItem.amountKnownCount += 1; stages.set(row.stage, stageItem);
    const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear);
    const yearItem = years.get(yearKey) ?? { fiscalYear: row.fiscalYear, contracted: emptyYearStage(), subsidy_published: emptyYearStage(), amountUnknownCount: 0 };
    const yearStage = yearItem[row.stage]; yearStage.records += 1; yearStage.amount += amount; if (row.amount !== null) yearStage.amountKnownCount += 1; else yearItem.amountUnknownCount += 1; years.set(yearKey, yearItem);
    const program = row.program.trim() || "活動名称・件名の記載なし"; const key = `${row.stage}\u0000${program}`;
    const programItem = programs.get(key) ?? { stage: row.stage, program, records: 0, amount: 0, amountKnownCount: 0 };
    programItem.records += 1; programItem.amount += amount; if (row.amount !== null) programItem.amountKnownCount += 1; programs.set(key, programItem);
  }
  return { name: first.organization, corporateNumber: first.corporateNumber, records: rows.length, amountUnknownCount,
    byStage: [...stages.values()].sort((a, b) => a.stage.localeCompare(b.stage)),
    byYear: [...years.values()].sort((a, b) => (b.fiscalYear ?? -Infinity) - (a.fiscalYear ?? -Infinity)),
    topPrograms: [...programs.values()].sort((a, b) => b.amount - a.amount || b.records - a.records || a.program.localeCompare(b.program, "ja")).slice(0, 10),
    detailRows: rows.slice(0, detailRowsPerOrganization), detailTruncated: rows.length > detailRowsPerOrganization };
}

function summarizeFundingRecords(rows: FundingRecord[]) {
  let amountKnownTotal = 0; let amountKnownCount = 0;
  const organizations = new Map<string, { name: string; corporateNumber: string; records: number; amount: number }>();
  const stages = new Map<Stage, { stage: Stage; records: number; amount: number; amountKnownCount: number }>();
  const years = new Map<string, { fiscalYear: number | null; records: number; amount: number; amountKnownCount: number }>();
  const programs = new Map<string, { program: string; records: number; amount: number; amountKnownCount: number }>();
  for (const row of rows) {
    const amount = row.amount ?? 0; if (row.amount !== null) { amountKnownTotal += row.amount; amountKnownCount += 1; }
    const organization = organizations.get(row.corporateNumber) ?? { name: row.organization, corporateNumber: row.corporateNumber, records: 0, amount: 0 };
    organization.records += 1; organization.amount += amount; organizations.set(row.corporateNumber, organization);
    const stageItem = stages.get(row.stage) ?? { stage: row.stage, records: 0, amount: 0, amountKnownCount: 0 };
    stageItem.records += 1; stageItem.amount += amount; if (row.amount !== null) stageItem.amountKnownCount += 1; stages.set(row.stage, stageItem);
    const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear); const yearItem = years.get(yearKey) ?? { fiscalYear: row.fiscalYear, records: 0, amount: 0, amountKnownCount: 0 };
    yearItem.records += 1; yearItem.amount += amount; if (row.amount !== null) yearItem.amountKnownCount += 1; years.set(yearKey, yearItem);
    const program = row.program.trim() || "活動名称・件名の記載なし"; const programItem = programs.get(program) ?? { program, records: 0, amount: 0, amountKnownCount: 0 };
    programItem.records += 1; programItem.amount += amount; if (row.amount !== null) programItem.amountKnownCount += 1; programs.set(program, programItem);
  }
  return { amountKnownTotal, amountKnownCount, amountUnknownCount: rows.length - amountKnownCount, organizationCount: organizations.size,
    organizations: [...organizations.values()].sort((a, b) => b.amount - a.amount || b.records - a.records || a.name.localeCompare(b.name, "ja")).slice(0, 10),
    byStage: [...stages.values()].sort((a, b) => a.stage.localeCompare(b.stage)),
    byYear: [...years.values()].sort((a, b) => (b.fiscalYear ?? -Infinity) - (a.fiscalYear ?? -Infinity)).slice(0, 5),
    topPrograms: [...programs.values()].sort((a, b) => b.amount - a.amount || b.records - a.records || a.program.localeCompare(b.program, "ja")).slice(0, 5) };
}

function parseJson<T>(bytes: ArrayBuffer, filename: string): T { try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } catch { throw new Error(`${filename}のJSONが不正です`); } }
function parseRows(bytes: ArrayBuffer, filename: string) {
  const value = parseJson<unknown>(bytes, filename); if (!Array.isArray(value)) throw new Error(`${filename}が配列ではありません`);
  for (const [index, raw] of value.entries()) validateRow(raw, `${filename} ${index + 1}行目`); return value as FundingRecord[];
}
function validateRow(raw: unknown, label: string): asserts raw is FundingRecord {
  if (!raw || typeof raw !== "object") throw new Error(`${label}の形式が不正です`); const row = raw as Partial<FundingRecord>;
  if (typeof row.id !== "string" || !row.id || (row.fiscalYear !== null && !Number.isInteger(row.fiscalYear)) || (row.date !== null && typeof row.date !== "string")
    || typeof row.organization !== "string" || !row.organization || typeof row.corporateNumber !== "string" || !/^\d{13}$/.test(row.corporateNumber)
    || typeof row.sourceAgency !== "string" || !row.sourceAgency || typeof row.program !== "string" || (row.amount !== null && (typeof row.amount !== "number" || !Number.isFinite(row.amount)))
    || (row.amountRaw !== undefined && typeof row.amountRaw !== "string") || (row.stage !== "contracted" && row.stage !== "subsidy_published")
    || typeof row.sourceKey !== "string" || !row.sourceKey || !Number.isSafeInteger(row.sourceRowNumber) || (row.sourceRowNumber ?? 0) < 1
    || typeof row.sourceSystem !== "string" || !row.sourceSystem) throw new Error(`${label}が公開スキーマと一致しません`);
}
function sortFundingRecords(rows: FundingRecord[]) { return rows.sort((a, b) => (b.fiscalYear ?? -Infinity) - (a.fiscalYear ?? -Infinity) || (b.date ?? "").localeCompare(a.date ?? "") || a.organization.localeCompare(b.organization, "ja")); }
async function sha256(bytes: ArrayBuffer) { const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""); }
