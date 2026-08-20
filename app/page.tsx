"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";
import ViewTabs from "@/app/ViewTabs";
import CombinedCompanyResults from "@/app/CombinedCompanyResults";
import { filterCompanyRecords } from "@/scripts/company-search.mjs";
import {
  FUNDING_QUERY_MAX_LENGTH,
  sanitizeFundingSearchPage,
  sanitizeFundingSearchQuery,
} from "@/scripts/funding-search.mjs";
import {
  evaluatePublicUpdateHealth,
  validatePublicUpdateStatus,
} from "@/scripts/pages-update-status.mjs";

type Stage = "contracted" | "subsidy_published";

type FundingRecord = {
  id: string;
  fiscalYear: number | null;
  date: string | null;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  program: string;
  amount: number | null;
  amountRaw?: string;
  stage: Stage;
  sourceKey: string;
  sourceRowNumber: number;
  sourceSystem: string;
};

type FundingSource = {
  id: string;
  name: string;
  recordCount: number;
  csvEligibleRecordCount?: number;
  csvImportedRecordCount?: number;
  csvImportGap?: number;
  csvEligibleSubsidyCount?: number;
  csvImportedSubsidyCount?: number;
  csvEligibleProcurementCount?: number;
  csvImportedProcurementCount?: number;
  dashboardRecordCount?: number | null;
  dashboardSubsidyCount?: number | null;
  dashboardProcurementCount?: number | null;
  dashboardMinusCsvEligibleCount?: number | null;
  dashboardMinusCsvEligibleSubsidyCount?: number | null;
  dashboardMinusCsvEligibleProcurementCount?: number | null;
  dashboardComparisonStatus?: "matched" | "different" | "unavailable";
  csvRetrievedAt?: string;
  // 旧スナップショットを安全に表示するための後方互換フィールド
  officialRecordCount?: number;
  recordCountGap?: number | null;
  officialSubsidyCount?: number;
  officialProcurementCount?: number;
  method: string;
  frequency: string;
  lastChecked: string;
  dashboardCheckedAt?: string;
  lastSuccessfulImportAt?: string;
  status: "healthy" | "watch";
};

type CoverageSeries = {
  fiscalYears: number[];
  unclassifiedDateCount?: number;
  completeness: string;
  note: string;
};

type FundingDataset = {
  generatedAt: string;
  sources: FundingSource[];
  records: FundingRecord[];
  coverage?: {
    gbiz: CoverageSeries;
  };
};

type DataChunkManifest = {
  generatedAt: string;
  commitments: Record<string, string>;
  preview: string;
};

type DataRelease = {
  schemaVersion: 1;
  commitSha: string;
  generatedAt: string;
  recordCount: number;
  manifestSha256: string;
  idSetSha256: string;
  preview: { filename: string; sha256: string; bytes: number; rows: number };
  appShell: Record<string, { sha256: string; bytes: number }>;
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
  sourceSnapshots: {
    gbiz: {
      csvRetrievedAt: string;
      subsidy: { sha256: string; bytes: number; filename: string };
      procurement: { sha256: string; bytes: number; filename: string };
    };
  };
};

type FundingSearchSummary = {
  amountKnownTotal: number;
  amountKnownCount: number;
  amountUnknownCount: number;
  organizationCount: number;
  organizations: Array<{ name: string; corporateNumber: string; records: number; amount: number }>;
  byStage: Array<{ stage: Stage; records: number; amount: number; amountKnownCount: number }>;
  byYear: Array<{ fiscalYear: number | null; records: number; amount: number; amountKnownCount: number }>;
  topPrograms: Array<{ program: string; records: number; amount: number; amountKnownCount: number }>;
};

type FundingSearchResult = {
  totalRecords: number;
  totalPages: number;
  page: number;
  pageSize: number;
  records: FundingRecord[];
  summary: FundingSearchSummary;
  releaseCommit: string;
  generatedAt: string;
};

type FundingWorkerResponse =
  | { type: "ready"; agencies: string[]; releaseCommit: string; generatedAt: string }
  | { type: "result"; requestId: number; result: FundingSearchResult }
  | { type: "error"; requestId?: number; message: string };

type PublicUpdateStatus = {
  schemaVersion: 1;
  attempt: {
    runId: string | null;
    runAttempt: number | null;
    attemptedAt: string;
    outcome: "succeeded" | "failed" | "unknown";
    runUrl: string | null;
  };
  publishedRelease: {
    commitSha: string;
    generatedAt: string;
    lastSuccessfulImportAt: string | null;
  };
};

type UpdateHealth = "loading" | "healthy" | "failed" | "stale" | "unknown";

const bundledFundingData = fundingSummary as FundingDataset;
const pageSize = 100;

function getPublicBaseUrl() {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".chatgpt.site")) {
    return "https://yagiharuka.github.io/meti-funding-watch/";
  }
  return typeof window === "undefined" ? "" : new URL("./", window.location.href).href;
}

const stageLabels: Record<Stage, string> = {
  contracted: "調達（委託を含む）",
  subsidy_published: "補助金",
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function formatTimestamp(value?: string) {
  if (!value) return "未取得";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDate(value: string | null) {
  if (!value) return "日付の記載なし";
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatCoverageYears(years: number[], unclassifiedDateCount = 0) {
  if (!years.length) return unclassifiedDateCount ? "日付の記載なしのみ" : "収録なし";
  const range = years.length === 1
    ? `${years[0]}年度`
    : `${years[0]}–${years.at(-1)}年度（認定日・受注日基準）`;
  return unclassifiedDateCount ? `${range}、日付の記載なしあり` : range;
}

function displayCount(value?: number | null) {
  return Number.isSafeInteger(value) ? `${value.toLocaleString("ja-JP")}件` : "未照合";
}

function displayRows(value?: number | null) {
  return Number.isSafeInteger(value) ? `${value.toLocaleString("ja-JP")}行` : "未照合";
}

function displayDifference(value?: number | null) {
  return Number.isSafeInteger(value) ? `${value.toLocaleString("ja-JP")}件` : "未照合";
}

function formatPublishedValue(row: FundingRecord) {
  if (row.amount !== null) return yen.format(row.amount);
  const raw = row.amountRaw?.trim();
  return raw ? `原文：${raw}` : "空欄";
}

function parseJsonBytes<T>(bytes: ArrayBuffer, label: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error(`${label}のJSONが不正です`);
  }
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function validateRelease(value: unknown): asserts value is DataRelease {
  if (!value || typeof value !== "object") throw new Error("公開releaseの形式が不正です");
  const release = value as Partial<DataRelease>;
  if (
    release.schemaVersion !== 1
    || typeof release.commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(release.commitSha)
    || typeof release.generatedAt !== "string"
    || !Number.isSafeInteger(release.recordCount) || (release.recordCount ?? -1) < 0
    || !isSha256(release.manifestSha256)
    || !isSha256(release.idSetSha256)
    || release.preview?.filename !== "commitments-preview.json"
    || !isSha256(release.preview?.sha256)
    || !Number.isSafeInteger(release.preview?.bytes) || (release.preview?.bytes ?? -1) < 0
    || !Number.isSafeInteger(release.preview?.rows) || (release.preview?.rows ?? -1) < 1 || (release.preview?.rows ?? 101) > pageSize
    || !release.appShell || typeof release.appShell !== "object"
    || !release.files || typeof release.files !== "object"
    || !release.sourceSnapshots || typeof release.sourceSnapshots !== "object"
  ) {
    throw new Error("公開releaseの形式が不正です");
  }
  if (!("index.html" in release.appShell)) throw new Error("公開releaseの画面情報が不正です");
  for (const [filename, metadata] of Object.entries(release.appShell)) {
    if (
      !/^(?:index\.html|adoptions\/index\.html|official\/index\.html|review\/index\.html|corrections\/index\.html|assets\/[A-Za-z0-9._-]+|[A-Za-z0-9._-]+\.(?:svg|txt))$/.test(filename)
      || !metadata || typeof metadata !== "object"
      || !isSha256(metadata.sha256)
      || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0
    ) throw new Error("公開releaseの画面情報が不正です");
  }
  for (const [filename, metadata] of Object.entries(release.files)) {
    if (
      !/^commitments-(?:\d{4}|unclassified)\.json$/.test(filename)
      || !metadata || typeof metadata !== "object"
      || !isSha256(metadata.sha256)
      || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 0
      || !Number.isSafeInteger(metadata.rows) || metadata.rows < 0
    ) {
      throw new Error("公開releaseのファイル情報が不正です");
    }
  }
  const gbiz = release.sourceSnapshots.gbiz;
  if (
    !gbiz || typeof gbiz !== "object"
    || typeof gbiz.csvRetrievedAt !== "string"
    || !isSha256(gbiz.subsidy?.sha256) || !Number.isSafeInteger(gbiz.subsidy?.bytes)
    || typeof gbiz.subsidy?.filename !== "string"
    || !isSha256(gbiz.procurement?.sha256) || !Number.isSafeInteger(gbiz.procurement?.bytes)
    || typeof gbiz.procurement?.filename !== "string"
  ) {
    throw new Error("公開releaseの取得元情報が不正です");
  }
}

function validateSearchRows(rows: unknown): FundingRecord[] {
  if (!Array.isArray(rows)) throw new Error("検索結果が配列ではありません");
  const ids = new Set<string>();
  for (const [index, raw] of rows.entries()) {
    const row = raw as Partial<FundingRecord>;
    if (
      !raw || typeof raw !== "object"
      || typeof row.id !== "string" || !row.id
      || (row.fiscalYear !== null && !Number.isInteger(row.fiscalYear))
      || (row.date !== null && typeof row.date !== "string")
      || typeof row.organization !== "string" || !row.organization
      || typeof row.corporateNumber !== "string" || !/^\d{13}$/.test(row.corporateNumber)
      || typeof row.sourceAgency !== "string" || !row.sourceAgency
      || typeof row.program !== "string"
      || (row.amount !== null && (typeof row.amount !== "number" || !Number.isFinite(row.amount)))
      || (row.amountRaw !== undefined && typeof row.amountRaw !== "string")
      || (row.stage !== "contracted" && row.stage !== "subsidy_published")
      || typeof row.sourceKey !== "string" || !row.sourceKey
      || !Number.isSafeInteger(row.sourceRowNumber) || (row.sourceRowNumber ?? 0) < 1
      || typeof row.sourceSystem !== "string" || !row.sourceSystem
    ) {
      throw new Error(`検索結果の${index + 1}行目が公開スキーマと一致しません`);
    }
    if (ids.has(row.id)) throw new Error("検索結果の明細IDが重複しています");
    ids.add(row.id);
  }
  return rows as FundingRecord[];
}

function sortFundingRecords(rows: FundingRecord[]) {
  return rows.sort((left, right) =>
    (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)
    || (right.date ?? "").localeCompare(left.date ?? "")
    || left.organization.localeCompare(right.organization, "ja"));
}

async function loadVerifiedFundingRecords(
  publicBaseUrl: string,
  manifest: DataChunkManifest,
  release: DataRelease,
  signal: AbortSignal,
) {
  const records: FundingRecord[] = [];
  const ids = new Set<string>();
  const entries = Object.entries(manifest.commitments)
    .sort(([left], [right]) => left.localeCompare(right));
  const loaded = new Array<{ yearKey: string; filename: string; rows: FundingRecord[] }>(entries.length);
  let nextIndex = 0;
  const loadNext = async () => {
    while (nextIndex < entries.length) {
      const index = nextIndex++;
      const [yearKey, filename] = entries[index];
      const metadata = release.files[filename];
      if (!metadata) throw new Error(`${filename}のrelease情報がありません`);
      const dataUrl = new URL(`data/${filename}`, publicBaseUrl);
      dataUrl.searchParams.set("release", release.commitSha);
      const response = await fetch(dataUrl, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`${filename}を取得できません（HTTP ${response.status}）`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== metadata.bytes) throw new Error(`${filename}のバイト数が一致しません`);
      if (await sha256(bytes) !== metadata.sha256) throw new Error(`${filename}のSHA-256が一致しません`);
      const rows = validateSearchRows(parseJsonBytes<unknown>(bytes, filename));
      loaded[index] = { yearKey, filename, rows };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, loadNext));

  for (const { yearKey, filename, rows } of loaded) {
    const metadata = release.files[filename];
    if (rows.length !== metadata.rows) throw new Error(`${filename}の行数が一致しません`);
    for (const row of rows) {
      if (yearKey === "unclassified" ? row.fiscalYear !== null : String(row.fiscalYear) !== yearKey) {
        throw new Error(`${filename}の年度がmanifestと一致しません`);
      }
      if (ids.has(row.id)) throw new Error("公開明細IDが重複しています");
      ids.add(row.id);
      records.push(row);
    }
  }

  if (records.length !== release.recordCount) throw new Error("公開明細の総行数がreleaseと一致しません");
  const idSetBytes = new TextEncoder().encode(`${[...ids].sort().join("\n")}\n`);
  if (await sha256(idSetBytes.buffer) !== release.idSetSha256) {
    throw new Error("公開明細のID集合がreleaseと一致しません");
  }
  return sortFundingRecords(records);
}

function initialSearchParam(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function summarizeFundingRecords(rows: FundingRecord[]): FundingSearchSummary {
  let amountKnownTotal = 0;
  let amountKnownCount = 0;
  const organizations = new Map<string, { name: string; corporateNumber: string; records: number; amount: number }>();
  const stages = new Map<Stage, { stage: Stage; records: number; amount: number; amountKnownCount: number }>();
  const years = new Map<string, { fiscalYear: number | null; records: number; amount: number; amountKnownCount: number }>();
  const programs = new Map<string, { program: string; records: number; amount: number; amountKnownCount: number }>();

  for (const row of rows) {
    const amount = row.amount ?? 0;
    if (row.amount !== null) {
      amountKnownTotal += row.amount;
      amountKnownCount += 1;
    }
    const organization = organizations.get(row.corporateNumber) ?? { name: row.organization, corporateNumber: row.corporateNumber, records: 0, amount: 0 };
    organization.records += 1;
    organization.amount += amount;
    organizations.set(row.corporateNumber, organization);
    const stageItem = stages.get(row.stage) ?? { stage: row.stage, records: 0, amount: 0, amountKnownCount: 0 };
    stageItem.records += 1;
    stageItem.amount += amount;
    if (row.amount !== null) stageItem.amountKnownCount += 1;
    stages.set(row.stage, stageItem);
    const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear);
    const yearItem = years.get(yearKey) ?? { fiscalYear: row.fiscalYear, records: 0, amount: 0, amountKnownCount: 0 };
    yearItem.records += 1;
    yearItem.amount += amount;
    if (row.amount !== null) yearItem.amountKnownCount += 1;
    years.set(yearKey, yearItem);
    const programName = row.program.trim() || "活動名称・件名の記載なし";
    const programItem = programs.get(programName) ?? { program: programName, records: 0, amount: 0, amountKnownCount: 0 };
    programItem.records += 1;
    programItem.amount += amount;
    if (row.amount !== null) programItem.amountKnownCount += 1;
    programs.set(programName, programItem);
  }

  return {
    amountKnownTotal,
    amountKnownCount,
    amountUnknownCount: rows.length - amountKnownCount,
    organizationCount: organizations.size,
    organizations: [...organizations.values()].sort((left, right) => right.amount - left.amount || right.records - left.records || left.name.localeCompare(right.name, "ja")).slice(0, 10),
    byStage: [...stages.values()].sort((left, right) => left.stage.localeCompare(right.stage)),
    byYear: [...years.values()].sort((left, right) => (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)).slice(0, 5),
    topPrograms: [...programs.values()].sort((left, right) => right.amount - left.amount || right.records - left.records || left.program.localeCompare(right.program, "ja")).slice(0, 5),
  };
}

export default function Home() {
  const defaultYear = "all";
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [manifest, setManifest] = useState<DataChunkManifest | null>(null);
  const [release, setRelease] = useState<DataRelease | null>(null);
  const [publicUpdateStatus, setPublicUpdateStatus] = useState<PublicUpdateStatus | null>(null);
  const [updateStatusLoaded, setUpdateStatusLoaded] = useState(false);
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [detailLoading, setDetailLoading] = useState(true);
  const [searchReady, setSearchReady] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchSummary, setSearchSummary] = useState<FundingSearchSummary | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [agencies, setAgencies] = useState<string[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const fallbackRecordsRef = useRef<FundingRecord[] | null>(null);
  const [searchBackend, setSearchBackend] = useState<"worker" | "main" | null>(null);
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState(() => sanitizeFundingSearchQuery(initialSearchParam("q", "")));
  const deferredQuery = useDeferredValue(query);
  const [agency, setAgency] = useState(() => initialSearchParam("agency", "all"));
  const [stage, setStage] = useState(() => {
    const requested = initialSearchParam("stage", "all");
    return requested === "contracted" || requested === "subsidy_published" ? requested : "all";
  });
  const [year, setYear] = useState(() => {
    const requested = initialSearchParam("year", defaultYear);
    return requested === "all" || requested === "unclassified" || /^\d{4}$/.test(requested)
      ? requested
      : defaultYear;
  });
  const [page, setPage] = useState(() => sanitizeFundingSearchPage(initialSearchParam("page", "1")) - 1);

  useEffect(() => {
    const controller = new AbortController();
    const publicBaseUrl = getPublicBaseUrl();
    const cacheKey = `${Date.now()}-${loadAttempt}`;
    Promise.all([
      fetch(`${publicBaseUrl}data/manifest.json?load=${cacheKey}`, { cache: "no-store", signal: controller.signal }),
      fetch(`${publicBaseUrl}release.json?load=${cacheKey}`, { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([manifestResponse, releaseResponse]) => {
        if (!manifestResponse.ok) throw new Error(`Data manifest: ${manifestResponse.status}`);
        if (!releaseResponse.ok) throw new Error(`Data release: ${releaseResponse.status}`);
        const [manifestBytes, releaseBytes] = await Promise.all([
          manifestResponse.arrayBuffer(),
          releaseResponse.arrayBuffer(),
        ]);
        const candidate = parseJsonBytes<DataChunkManifest>(manifestBytes, "Data manifest");
        const candidateRelease = parseJsonBytes<unknown>(releaseBytes, "Data release");
        if (
          typeof candidate.generatedAt !== "string"
          || !candidate.commitments
          || typeof candidate.commitments !== "object"
        ) {
          throw new Error("Data manifest: invalid schema");
        }
        const manifestEntries = Object.entries(candidate.commitments);
        if (
          !manifestEntries.length
          || manifestEntries.some(([yearKey, filename]) =>
            !/^(?:\d{4}|unclassified)$/.test(yearKey)
            || !/^commitments-(?:\d{4}|unclassified)\.json$/.test(filename))
          || new Set(manifestEntries.map(([, filename]) => filename)).size !== manifestEntries.length
        ) {
          throw new Error("Data manifest: invalid file map");
        }
        validateRelease(candidateRelease);
        if (candidateRelease.generatedAt !== candidate.generatedAt) {
          throw new Error("Data manifestとreleaseの生成日時が一致しません");
        }
        if (await sha256(manifestBytes) !== candidateRelease.manifestSha256) {
          throw new Error("Data manifestのSHA-256が一致しません");
        }
        const manifestFiles = Object.values(candidate.commitments).sort();
        const releaseFiles = Object.keys(candidateRelease.files).sort();
        if (JSON.stringify(manifestFiles) !== JSON.stringify(releaseFiles)) {
          throw new Error("Data manifestとreleaseのファイル一覧が一致しません");
        }
        if (candidate.preview !== candidateRelease.preview.filename) {
          throw new Error("Data manifestとreleaseの初期表示ファイルが一致しません");
        }
        const previewResponse = await fetch(
          `${publicBaseUrl}data/${candidate.preview}?load=${cacheKey}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!previewResponse.ok) throw new Error(`Data preview: ${previewResponse.status}`);
        const previewBytes = await previewResponse.arrayBuffer();
        if (previewBytes.byteLength !== candidateRelease.preview.bytes) {
          throw new Error("Data previewのバイト数が一致しません");
        }
        if (await sha256(previewBytes) !== candidateRelease.preview.sha256) {
          throw new Error("Data previewのSHA-256が一致しません");
        }
        const previewRows = validateSearchRows(parseJsonBytes<unknown>(previewBytes, "Data preview"));
        if (previewRows.length !== candidateRelease.preview.rows) {
          throw new Error("Data previewの行数が一致しません");
        }
        return { candidate, candidateRelease, previewRows };
      })
      .then(({ candidate, candidateRelease, previewRows }) => {
        setManifest(candidate);
        setRelease(candidateRelease);
        setDataset((current) => ({ ...current, generatedAt: candidate.generatedAt, records: previewRows }));
        setSearchTotal(candidateRelease.recordCount);
        setSearchTotalPages(Math.max(1, Math.ceil(candidateRelease.recordCount / pageSize)));
        setSearchSummary(null);
        setDataMode("github");
        setDetailLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("unavailable");
        setDetailLoading(false);
      });
    return () => controller.abort();
  }, [loadAttempt]);

  useEffect(() => {
    if (!release) return;
    const controller = new AbortController();
    const publicBaseUrl = getPublicBaseUrl();
    fetch(`${publicBaseUrl}update-status.json`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Update status: ${response.status}`);
        return validatePublicUpdateStatus(await response.json()) as PublicUpdateStatus;
      })
      .then((status) => setPublicUpdateStatus(status))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPublicUpdateStatus(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setUpdateStatusLoaded(true);
      });
    return () => controller.abort();
  }, [release]);

  useEffect(() => {
    const timer = window.setInterval(() => setStatusClock(Date.now()), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!manifest || !release) return;
    let active = true;
    let fallbackStarted = false;
    const fallbackController = new AbortController();
    const worker = new Worker(new URL("./funding-search.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const startMainThreadFallback = () => {
      if (!active || fallbackStarted || fallbackRecordsRef.current) return;
      fallbackStarted = true;
      workerRef.current?.terminate();
      workerRef.current = null;
      setSearchReady(false);
      setSearchBackend(null);
      setDetailLoading(true);
      loadVerifiedFundingRecords(getPublicBaseUrl(), manifest, release, fallbackController.signal)
        .then((records) => {
          if (!active) return;
          fallbackRecordsRef.current = records;
          setAgencies([...new Set(records.map((row) => row.sourceAgency))]
            .sort((left, right) => left.localeCompare(right, "ja")));
          setSearchBackend("main");
          setSearchReady(true);
        })
        .catch((error: unknown) => {
          if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
          setDataset((current) => ({ ...current, records: [] }));
          setSearchTotal(0);
          setSearchTotalPages(1);
          setSearchSummary(null);
          setDataMode("unavailable");
          setDetailLoading(false);
        });
    };

    worker.onmessage = (event: MessageEvent<FundingWorkerResponse>) => {
      if (!active) return;
      const message = event.data;
      if (message.type === "ready") {
        if (message.releaseCommit !== release.commitSha || message.generatedAt !== release.generatedAt) {
          setDataMode("unavailable");
          setDetailLoading(false);
          return;
        }
        setAgencies(message.agencies);
        setSearchBackend("worker");
        setSearchReady(true);
        return;
      }
      if (message.type === "error") {
        if (message.requestId !== undefined) {
          if (message.requestId !== requestIdRef.current) return;
          setDataset((current) => ({ ...current, records: [] }));
          setSearchTotal(0);
          setSearchTotalPages(1);
          setSearchSummary(null);
          setSearchError("検索条件を処理できませんでした。条件を変えてもう一度お試しください。");
          setDataMode("github");
          setDetailLoading(false);
          return;
        }
        startMainThreadFallback();
        return;
      }
      if (message.requestId !== requestIdRef.current) return;
      const candidate = message.result;
      const records = validateSearchRows(candidate.records);
      if (
        candidate.releaseCommit !== release.commitSha
        || candidate.generatedAt !== release.generatedAt
        || candidate.pageSize !== pageSize
        || !Number.isSafeInteger(candidate.totalRecords) || candidate.totalRecords < 0
        || !Number.isSafeInteger(candidate.totalPages) || candidate.totalPages < 1
        || !Number.isSafeInteger(candidate.page) || candidate.page < 1 || candidate.page > candidate.totalPages
        || records.length > pageSize
        || !candidate.summary
        || !Number.isSafeInteger(candidate.summary.organizationCount) || candidate.summary.organizationCount < 0
        || !Number.isFinite(candidate.summary.amountKnownTotal)
      ) {
        setDataset((current) => ({ ...current, records: [] }));
        setSearchSummary(null);
        setDataMode("unavailable");
        setDetailLoading(false);
        return;
      }
      setDataset((current) => ({
        ...current,
        generatedAt: manifest.generatedAt,
        records,
      }));
      setSearchTotal(candidate.totalRecords);
      setSearchTotalPages(candidate.totalPages);
      setSearchSummary(candidate.summary);
      setSearchError(null);
      setDataMode("github");
      setDetailLoading(false);
    };
    worker.onerror = startMainThreadFallback;
    worker.postMessage({
      type: "initialize",
      publicBaseUrl: getPublicBaseUrl(),
      manifest,
      release,
    });

    return () => {
      active = false;
      fallbackController.abort();
      workerRef.current = null;
      worker.terminate();
    };
  }, [manifest, release]);

  useEffect(() => {
    if (!searchReady || !release || query !== deferredQuery) return;
    const requestId = ++requestIdRef.current;
    const requestedAgency = agency === "all" || agencies.includes(agency) ? agency : "all";
    const parameters = new URLSearchParams({
      q: deferredQuery.trim(),
      agency: requestedAgency,
      stage,
      year,
      page: String(page + 1),
    });
    if (searchBackend === "worker" && workerRef.current) {
      workerRef.current.postMessage({
        type: "search",
        requestId,
        parameters: parameters.toString(),
      });
      return;
    }
    if (searchBackend !== "main" || !fallbackRecordsRef.current) return;
    const matching = filterCompanyRecords(fallbackRecordsRef.current, {
      query: deferredQuery,
      agency: requestedAgency,
      stage,
      year,
    }) as FundingRecord[];
    const totalRecords = matching.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const effectivePage = Math.min(page + 1, totalPages);
    const offset = (effectivePage - 1) * pageSize;
    setDataset((current) => ({
      ...current,
      generatedAt: manifest?.generatedAt ?? current.generatedAt,
      records: matching.slice(offset, offset + pageSize),
    }));
    setSearchTotal(totalRecords);
    setSearchTotalPages(totalPages);
    setSearchSummary(summarizeFundingRecords(matching));
    setSearchError(null);
    setDataMode("github");
    setDetailLoading(false);
  }, [agencies, agency, deferredQuery, manifest?.generatedAt, page, query, release, searchBackend, searchReady, stage, year]);

  const commitments = dataset.records;
  const gbizSource = dataset.sources.find((source) => source.id === "gbiz");
  const coverageYears = dataset.coverage?.gbiz.fiscalYears
    ?? Object.keys(manifest?.commitments ?? {})
      .map(Number)
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  const fiscalYears = [...coverageYears].sort((a, b) => b - a);
  const hasUndatedRecords = Boolean(
    dataset.coverage?.gbiz.unclassifiedDateCount
    || manifest?.commitments.unclassified,
  );
  const unclassifiedDateCount = dataset.coverage?.gbiz.unclassifiedDateCount ?? 0;
  const effectiveAgency = agency === "all" || detailLoading || agencies.includes(agency) ? agency : "all";
  const filteredCommitments = commitments;
  const totalPages = searchTotalPages;
  const effectivePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredCommitments;
  const visibleStart = searchTotal ? effectivePage * pageSize + 1 : 0;
  const visibleEnd = Math.min((effectivePage + 1) * pageSize, searchTotal);
  const hasFilters = query || effectiveAgency !== "all" || stage !== "all" || year !== defaultYear;

  useEffect(() => {
    const url = new URL(window.location.href);
    const values: Record<string, string> = {
      q: query.trim(),
      agency: effectiveAgency === "all" ? "" : effectiveAgency,
      stage: stage === "all" ? "" : stage,
      year: year === defaultYear ? "" : year,
      page: effectivePage > 0 ? String(effectivePage + 1) : "",
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [effectiveAgency, effectivePage, query, stage, year]);

  const dashboardRecordCount = gbizSource?.dashboardRecordCount ?? gbizSource?.officialRecordCount;
  const csvEligibleRecordCount = gbizSource?.csvEligibleRecordCount;
  const csvImportedRecordCount = gbizSource?.csvImportedRecordCount;
  const csvImportGap = gbizSource?.csvImportGap
    ?? (Number.isSafeInteger(csvEligibleRecordCount) && Number.isSafeInteger(csvImportedRecordCount)
      ? (csvEligibleRecordCount ?? 0) - (csvImportedRecordCount ?? 0)
      : null);
  const dashboardCsvGap = gbizSource?.dashboardMinusCsvEligibleCount
    ?? (Number.isSafeInteger(dashboardRecordCount) && Number.isSafeInteger(csvEligibleRecordCount)
      ? (dashboardRecordCount ?? 0) - (csvEligibleRecordCount ?? 0)
      : null);
  const csvImportVerified = Boolean(
    gbizSource?.lastSuccessfulImportAt
    && gbizSource.status === "healthy"
    && Number.isSafeInteger(csvEligibleRecordCount)
    && Number.isSafeInteger(csvImportedRecordCount)
    && csvImportGap === 0,
  );
  const updateHealth = (
    !release || !updateStatusLoaded
      ? "loading"
      : evaluatePublicUpdateHealth(publicUpdateStatus, release, statusClock)
  ) as UpdateHealth;
  const updateChipClass = dataMode !== "github"
    ? dataMode
    : updateHealth === "healthy" ? "github" : updateHealth === "loading" ? "loading" : "watch";
  const updateChipText = dataMode === "loading"
    ? "掲載データ読込中"
    : dataMode === "unavailable"
      ? "掲載データ取得要確認"
      : updateHealth === "failed"
        ? "自動更新失敗"
        : updateHealth === "stale"
          ? "自動更新遅延"
          : updateHealth === "unknown"
            ? "更新状況未確認"
            : updateHealth === "loading" ? "更新状況確認中" : "掲載データ読込済み";
  const updateWarning = updateHealth === "failed"
    ? "直近の自動更新に失敗しました。現在は前回検証済みのデータを表示しています。"
    : updateHealth === "stale"
      ? "最終取込成功から8日以上経過しています。週次自動更新が遅延している可能性があります。"
      : null;
  const displayedLastSuccess = publicUpdateStatus?.publishedRelease.lastSuccessfulImportAt
    ?? gbizSource?.lastSuccessfulImportAt
    ?? dataset.generatedAt;

  function markSearchPending() {
    requestIdRef.current += 1;
    setDataset((current) => ({ ...current, records: [] }));
    setSearchSummary(null);
    setSearchError(null);
    setDetailLoading(true);
    setDataMode("loading");
  }

  function clearFilters() {
    markSearchPending();
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(defaultYear);
    setPage(0);
  }

  function retryDetails() {
    requestIdRef.current += 1;
    fallbackRecordsRef.current = null;
    setSearchBackend(null);
    setManifest(null);
    setRelease(null);
    setSearchReady(false);
    setSearchError(null);
    setDataset((current) => ({ ...current, records: [] }));
    setSearchTotal(0);
    setSearchTotalPages(1);
    setSearchSummary(null);
    setDetailLoading(true);
    setDataMode("loading");
    setLoadAttempt((value) => value + 1);
  }

  function changeYear(nextYear: string) {
    markSearchPending();
    setAgency("all");
    setYear(nextYear);
    setPage(0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="経産省関連の事業費額（非公式） トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関連の事業費額（非公式）</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">GビズINFO検索</a>
          <a href="#sources">更新状況</a>
        </nav>
        <span className={`update-chip ${updateChipClass}`} role="status" aria-live="polite"><i />{updateChipText}</span>
      </header>

      <ViewTabs active="gbiz" />

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">TWO MAIN SERIES & CHECK RECORDS</p>
          <h1>経産省関連の事業費額<em>（非公式）</em></h1>
          <p className="hero-lead">
            GビズINFOと行政事業レビューを主系列として自動更新します。
            機関公表資料はGビズINFO掲載値を確認した照合記録として、対象を限定して示します。
          </p>
          <p className="hero-scope-warning">
            このサイトは経済産業省の全支出・実支払を示すものではありません。
            GビズINFOに法人番号付きで掲載された調達（委託を含む）・補助金情報だけを表示します。
            所管法人については、NEDO・IPAのGビズINFO掲載分のみが対象で、その他の所管法人は含みません。
            NEDO・IPAの掲載分についても、経済産業省を原資とする支出かどうかはGビズINFOだけでは判別できません。
          </p>
          <div className="hero-note">
            <span>{gbizSource?.lastSuccessfulImportAt ? "取得時CSVの最終取込成功" : "データ生成日時"}</span>
            <strong>{formatTimestamp(gbizSource?.lastSuccessfulImportAt ?? dataset.generatedAt)}</strong>
            <span className="source-count">データ出典：GビズINFO</span>
          </div>
          {updateWarning && (
            <p className="update-alert" role="alert">
              <strong>{updateWarning}</strong>
              <span>表示中データの最終取込成功：{formatTimestamp(displayedLastSuccess)}</span>
              {publicUpdateStatus?.attempt.runUrl && (
                <a href={publicUpdateStatus.attempt.runUrl} target="_blank" rel="noreferrer">実行状況を確認 ↗</a>
              )}
            </p>
          )}
          <div className="hero-actions">
            <a className="primary-action" href="official/#reconciliation-records">照合の記録を見る</a>
            <a className="secondary-action" href="#records">GビズINFOを検索</a>
          </div>
        </div>
      </section>

      <section className="records-section" id="records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ORGANIZATIONS & PUBLISHED ACTIVITIES</p>
            <h2>調達（委託を含む）・補助金の掲載情報</h2>
          </div>
          <p>法人等の名称と法人番号だけを全文検索します。条件を組み合わせて掲載行を確認できます。</p>
        </div>

        <div className="series-label" aria-label="表示中のデータ系列">
          <strong>法人等別の調達（委託を含む）・補助金掲載情報</strong>
          <span>GビズINFO</span>
        </div>
        <div className="filters" aria-label="検索条件">
          <label className="search-field">
            <span className="sr-only">法人等の名称または法人番号で検索</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input
              type="search"
              maxLength={FUNDING_QUERY_MAX_LENGTH}
              placeholder="法人等の名称・法人番号で検索"
              value={query}
              onChange={(event) => { markSearchPending(); setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <label>
            <span className="sr-only">公表組織</span>
            <select value={effectiveAgency} onChange={(event) => { markSearchPending(); setAgency(event.target.value); setPage(0); }}>
              <option value="all">すべての公表組織</option>
              {agencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">GビズINFO情報種別</span>
            <select value={stage} onChange={(event) => { markSearchPending(); setStage(event.target.value); setPage(0); }}>
              <option value="all">すべての情報種別</option>
              {Object.entries(stageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">認定日・受注日基準年度</span>
            <select value={year} onChange={(event) => changeYear(event.target.value)}>
              <option value="all">全期間</option>
              {fiscalYears.map((item) => <option key={item} value={item}>{item}年度（日付基準）</option>)}
              {hasUndatedRecords && <option value="unclassified">年度不明（日付の記載なし）</option>}
            </select>
          </label>
        </div>
        {unclassifiedDateCount > 0 && (
          <p className="filter-note">
            年度を指定すると、認定日・受注日の記載がない{unclassifiedDateCount.toLocaleString("ja-JP")}行は検索対象から外れます。
          </p>
        )}

        <div id="company-search-mount" />

        {query.trim() && searchSummary && !detailLoading && searchTotal > 0 && (
          <div className="records-table" role="region" aria-label="企業検索結果サマリー" tabIndex={0} style={{ marginBottom: "1rem" }}>
            <table>
              <caption style={{ textAlign: "left", padding: "1rem", fontWeight: 700 }}>検索結果サマリー（現在の検索条件）</caption>
              <thead><tr><th>対象法人</th><th>掲載行</th><th>金額記載あり</th><th>金額の記載なし</th></tr></thead>
              <tbody><tr><td><strong>{searchSummary.organizationCount.toLocaleString("ja-JP")}法人</strong><small>法人番号単位</small></td><td>{searchTotal.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountKnownCount.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountUnknownCount.toLocaleString("ja-JP")}行</td></tr></tbody>
            </table>
            <table>
              <thead><tr><th>情報種別</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.byStage.map((item) => <tr key={item.stage}><td><span className={`stage-badge ${item.stage}`}>{stageLabels[item.stage]}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
            </table>
            <table>
              <thead><tr><th>直近5年度</th><th>掲載行</th><th>金額記載あり</th></tr></thead>
              <tbody>{searchSummary.byYear.map((item) => <tr key={item.fiscalYear ?? "unclassified"}><td>{item.fiscalYear === null ? "年度不明" : `${item.fiscalYear}年度`}</td><td>{item.records.toLocaleString("ja-JP")}行</td><td>{item.amountKnownCount.toLocaleString("ja-JP")}行</td></tr>)}</tbody>
            </table>
            <table>
              <thead><tr><th>掲載行の多い活動名称・件名</th><th>掲載行</th><th>金額記載あり</th></tr></thead>
              <tbody>{searchSummary.topPrograms.map((item) => <tr key={item.program}><td><span className="program-name">{item.program}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td>{item.amountKnownCount.toLocaleString("ja-JP")}行</td></tr>)}</tbody>
            </table>
          </div>
        )}

        <CombinedCompanyResults query={query} />
        <div className="result-bar">
          <span role="status" aria-live="polite">
            {searchError ? (
              <strong>検索条件エラー</strong>
            ) : detailLoading ? (
              <strong>明細を読込中</strong>
            ) : (
              <>
                <strong>{searchTotal.toLocaleString("ja-JP")}</strong>掲載行
                {searchTotal > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}行を表示）`}
              </>
            )}
          </span>
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        <div className="records-table" role="region" aria-label="GビズINFO調達（委託を含む）・補助金掲載情報一覧" tabIndex={0}>
          <table>
            <caption className="sr-only">GビズINFOに掲載された調達（委託を含む）・補助金情報</caption>
            <thead><tr><th scope="col">法人等の名称</th><th scope="col">活動名称・件名</th><th scope="col">公表組織</th><th scope="col">情報種別</th><th scope="col">GビズINFO掲載値</th><th scope="col">認定日・受注日</th><th scope="col">掲載ページ</th></tr></thead>
            <tbody>{visibleRows.map((row) => (
              <tr key={row.id} id={row.id}>
                <td data-label="法人等の名称"><strong>{row.organization}</strong><small>{row.corporateNumber}</small></td>
                <td data-label="活動名称・件名"><span className="program-name">{row.program || "活動名称・件名の記載なし"}</span></td>
                <td data-label="公表組織">{row.sourceAgency || "公表組織の記載なし"}</td>
                <td data-label="情報種別"><span className={`stage-badge ${row.stage}`}>{stageLabels[row.stage]}</span></td>
                <td className="amount" data-label="掲載値">{formatPublishedValue(row)}</td>
                <td data-label="認定日・受注日">{formatDate(row.date)}<small>{row.fiscalYear === null ? "年度不明" : `${row.fiscalYear}年度（日付基準）`}</small></td>
                <td data-label="掲載ページ">
                  <a className="source-link" href={`https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${row.corporateNumber}${row.stage === "subsidy_published" ? "#subsidy" : "#procurement"}`} target="_blank" rel="noreferrer" aria-label={`${row.organization}のGビズINFO掲載ページを新しいタブで開く`}>GビズINFO ↗</a>
                  <small title="取得した全件CSV内の一意識別子">出典キー：{row.sourceKey}</small>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!filteredCommitments.length && (
            <div className="empty-state">
              <strong>{searchError ? "検索条件を処理できませんでした" : detailLoading ? "明細データを読み込んでいます" : dataMode === "unavailable" ? "明細データを取得できません" : "収録済みのGビズINFO掲載行では確認できませんでした"}</strong>
              <span>{searchError ?? (detailLoading ? "少しお待ちください。" : dataMode === "unavailable" ? "時間をおいて再読み込みしてください。" : "これは経産省関係の資金を受けていないという意味ではありません。GビズINFOに法人番号付きで掲載された収録行の範囲で確認できなかった結果です。")}</span>
              {dataMode === "unavailable" && <button className="retry-button" type="button" onClick={retryDetails}>明細をもう一度読み込む</button>}
            </div>
          )}
        </div>

        {searchTotal > pageSize && (
          <nav className="pagination" aria-label="検索結果のページ送り">
            <button disabled={effectivePage === 0} onClick={() => { markSearchPending(); setPage(Math.max(0, effectivePage - 1)); }}>← 前へ</button>
            <span>{effectivePage + 1} / {totalPages}</span>
            <button disabled={effectivePage + 1 >= totalPages} onClick={() => { markSearchPending(); setPage(Math.min(totalPages - 1, effectivePage + 1)); }}>次へ →</button>
          </nav>
        )}
      </section>

      <section className="source-section" id="sources">
        <div className="section-heading light">
          <div><p className="eyebrow">DATA UPDATES</p><h2>データ更新状況</h2></div>
          <p>当サイトは週1回、GビズINFO全件CSVの再取得を試みます。GビズINFO側の原データ更新時期は出典ごとに異なります。</p>
        </div>
        {gbizSource && (
          <div className="source-grid">
            <article>
              <div><span className={`health ${updateHealth === "healthy" ? "healthy" : "watch"}`} />GビズINFO</div>
              <strong>{gbizSource.recordCount.toLocaleString("ja-JP")}行を収録</strong>
              <dl>
                <div><dt>取得方式</dt><dd>全件CSVの再取得を週1回試行</dd></div>
                <div><dt>掲載行の日付範囲</dt><dd>{formatCoverageYears(coverageYears, dataset.coverage?.gbiz.unclassifiedDateCount)}</dd></div>
                <div><dt>{gbizSource.lastSuccessfulImportAt ? "取得時CSVの最終取込成功" : "成功履歴"}</dt><dd>{gbizSource.lastSuccessfulImportAt ? formatTimestamp(gbizSource.lastSuccessfulImportAt) : "未記録"}</dd></div>
                <div><dt>公式ダッシュボード確認日時</dt><dd>{formatTimestamp(gbizSource.dashboardCheckedAt ?? gbizSource.lastChecked)}</dd></div>
                <div><dt>公式ダッシュボード</dt><dd>{displayCount(dashboardRecordCount)}<small>補助金 {displayCount(gbizSource.dashboardSubsidyCount)}／調達 {displayCount(gbizSource.dashboardProcurementCount)}</small></dd></div>
                <div><dt>取得CSVの対象行</dt><dd>{displayRows(csvEligibleRecordCount)}<small>補助金 {displayRows(gbizSource.csvEligibleSubsidyCount)}／調達 {displayRows(gbizSource.csvEligibleProcurementCount)}</small></dd></div>
                <div><dt>本サイト取込行</dt><dd>{displayRows(csvImportedRecordCount ?? gbizSource.recordCount)}<small>補助金 {displayRows(gbizSource.csvImportedSubsidyCount)}／調達 {displayRows(gbizSource.csvImportedProcurementCount)}</small></dd></div>
                <div><dt>CSV取込差（対象－取込）</dt><dd>{displayRows(csvImportGap)}</dd></div>
                <div><dt>確認時点の公式画面－取得時CSV対象</dt><dd>{displayDifference(dashboardCsvGap)}</dd></div>
                <div><dt>取込確認</dt><dd>{csvImportVerified ? "取得時CSVの抽出対象行を取込確認" : "要確認"}</dd></div>
              </dl>
              <p className="source-disclaimer">
                公式ダッシュボードと全件CSVは別のスナップショットです。両者の差は取込漏れとはみなさず、参考照合として表示します。
                公開条件は、取得CSVの対象行と本サイト取込行が区分別にも一致することです。
              </p>
              <a className="workflow-status-link" href="https://github.com/yagiharuka/meti-funding-watch/actions/workflows/refresh-gbiz-data.yml?query=event%3Aschedule" target="_blank" rel="noreferrer">
                {/* The badge is generated by GitHub Actions and is not an optimizable site asset. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://github.com/yagiharuka/meti-funding-watch/actions/workflows/refresh-gbiz-data.yml/badge.svg?branch=main&event=schedule" alt="週次自動更新ワークフローの最新状態" />
                <span>週次自動更新の実行履歴 ↗</span>
              </a>
              <a className="source-link" href="https://info.gbiz.go.jp/hojin/dashboard" target="_blank" rel="noreferrer">GビズINFO公式画面 ↗</a>
            </article>
          </div>
        )}
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>経産省関連の事業費額（非公式）</span></div>
        <p>「GビズINFO」（経済産業省）のデータを当サイトで抽出・整形して作成した非公式サイトです。原データと本サイトの抽出・取込は、正確性・完全性・最新性を保証しません。</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
