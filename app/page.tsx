"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";
import ViewTabs from "@/app/ViewTabs";

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
};

type DataRelease = {
  schemaVersion: 1;
  commitSha: string;
  generatedAt: string;
  recordCount: number;
  manifestSha256: string;
  idSetSha256: string;
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
  sourceSnapshots: {
    gbiz: {
      csvRetrievedAt: string;
      subsidy: { sha256: string; bytes: number; filename: string };
      procurement: { sha256: string; bytes: number; filename: string };
    };
  };
};

const bundledFundingData = fundingSummary as FundingDataset;
const pageSize = 100;

function getPublicBaseUrl() {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".chatgpt.site")) {
    return "https://yagiharuka.github.io/meti-funding-watch/";
  }
  return "";
}

function getDataBaseUrl() {
  return `${getPublicBaseUrl()}data/`;
}

const stageLabels: Record<Stage, string> = {
  contracted: "調達CSV（委託を含む）",
  subsidy_published: "補助金CSV",
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

function includesQuery(values: Array<string | number | null>, query: string) {
  if (!query) return true;
  return values.join(" ").toLocaleLowerCase("ja-JP").includes(query);
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

async function idSetSha256(rows: FundingRecord[]) {
  const value = `${rows.map(({ id }) => id).sort().join("\n")}\n`;
  const bytes = new TextEncoder().encode(value);
  return sha256(bytes.buffer as ArrayBuffer);
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
    || !release.files || typeof release.files !== "object"
    || !release.sourceSnapshots || typeof release.sourceSnapshots !== "object"
  ) {
    throw new Error("公開releaseの形式が不正です");
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

function validateChunkRows(rows: unknown, yearKey: string, filename: string): FundingRecord[] {
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
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
      || (yearKey === "unclassified" ? row.fiscalYear !== null : String(row.fiscalYear) !== yearKey)
    ) {
      throw new Error(`${filename}の${index + 1}行目が公開スキーマと一致しません`);
    }
    if (ids.has(row.id)) throw new Error(`${filename}の明細IDが重複しています`);
    ids.add(row.id);
  }
  return rows as FundingRecord[];
}

async function delayWithSignal(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

async function fetchWithRetry(url: string, signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`Data chunk: ${response.status}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      lastError = error;
    }
    if (attempt < 2) await delayWithSignal(350 * (attempt + 1), signal);
  }
  throw lastError instanceof Error ? lastError : new Error("Data chunkを取得できません");
}

async function loadWithConcurrency<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
  concurrency = 3,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

function initialSearchParam(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}


export default function Home() {
  const defaultYear = "all";
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [manifest, setManifest] = useState<DataChunkManifest | null>(null);
  const [release, setRelease] = useState<DataRelease | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [query, setQuery] = useState(() => initialSearchParam("q", ""));
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
  const [page, setPage] = useState(() => {
    const requested = Number(initialSearchParam("page", "1"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested - 1 : 0;
  });
  const chunkCache = useRef(new Map<string, FundingRecord[]>());

  useEffect(() => {
    const controller = new AbortController();
    const publicBaseUrl = getPublicBaseUrl();
    Promise.all([
      fetch(`${publicBaseUrl}data/manifest.json`, { cache: "no-store", signal: controller.signal }),
      fetch(`${publicBaseUrl}release.json`, { cache: "no-store", signal: controller.signal }),
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
        return { candidate, candidateRelease };
      })
      .then(({ candidate, candidateRelease }) => {
        chunkCache.current.clear();
        setManifest(candidate);
        setRelease(candidateRelease);
        setDataset((current) => ({ ...current, generatedAt: candidate.generatedAt }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("unavailable");
        setDetailLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!manifest || !release) return;
    const controller = new AbortController();
    const dataBaseUrl = getDataBaseUrl();
    let active = true;
    const filenames = year === "all"
      ? Object.values(manifest.commitments)
      : [manifest.commitments[year]].filter((filename): filename is string => Boolean(filename));

    const chunkRequest = filenames.length ? loadWithConcurrency(filenames, async (filename) => {
      const cacheKey = `${release.commitSha}:${filename}`;
      const cached = chunkCache.current.get(cacheKey);
      if (cached) return cached;
      const metadata = release.files[filename];
      if (!metadata) throw new Error(`Data releaseに${filename}がありません`);
      const response = await fetchWithRetry(`${dataBaseUrl}${filename}`, controller.signal);
      if (!response.ok) throw new Error(`Data chunk: ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== metadata.bytes) throw new Error(`${filename}のバイト数が一致しません`);
      if (await sha256(bytes) !== metadata.sha256) throw new Error(`${filename}のSHA-256が一致しません`);
      const yearKey = Object.entries(manifest.commitments).find(([, value]) => value === filename)?.[0];
      if (!yearKey) throw new Error(`${filename}の年度を確認できません`);
      const rows = validateChunkRows(parseJsonBytes<unknown>(bytes, filename), yearKey, filename);
      if (rows.length !== metadata.rows) throw new Error(`${filename}の行数が一致しません`);
      chunkCache.current.set(cacheKey, rows);
      return rows;
    }) : Promise.reject(new Error("指定された期間の公開明細がありません"));

    chunkRequest
      .then(async (groups) => {
        if (!active) return;
        const records = groups.flat();
        if (new Set(records.map(({ id }) => id)).size !== records.length) {
          throw new Error("公開明細のIDが重複しています");
        }
        if (year === "all") {
          if (records.length !== release.recordCount) throw new Error("公開明細の総行数が一致しません");
          if (await idSetSha256(records) !== release.idSetSha256) {
            throw new Error("公開明細のID集合SHA-256が一致しません");
          }
        }
        if (!active) return;
        setDataset((current) => ({
          ...current,
          generatedAt: manifest.generatedAt,
          records,
        }));
        setDataMode("github");
        setDetailLoading(false);
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setDataMode("unavailable");
        setDetailLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [manifest, release, year]);

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
  const agencies = useMemo(
    () => Array.from(new Set(commitments.map((row) => row.sourceAgency).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "ja")),
    [commitments],
  );
  const effectiveAgency = agency === "all" || detailLoading || agencies.includes(agency) ? agency : "all";

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("ja-JP");
  const sortedCommitments = useMemo(() => [...commitments]
    .sort((a, b) =>
      (b.fiscalYear ?? Number.NEGATIVE_INFINITY) - (a.fiscalYear ?? Number.NEGATIVE_INFINITY)
      || (b.date ?? "").localeCompare(a.date ?? "")
      || a.organization.localeCompare(b.organization, "ja")),
  [commitments]);
  const filteredCommitments = useMemo(() => sortedCommitments
    .filter((row) =>
      includesQuery([row.organization, row.corporateNumber], normalizedQuery)
      && (effectiveAgency === "all" || row.sourceAgency === effectiveAgency)
      && (stage === "all" || row.stage === stage)
      && (year === "all"
        || (year === "unclassified" ? row.fiscalYear === null : String(row.fiscalYear) === year))),
  [effectiveAgency, normalizedQuery, sortedCommitments, stage, year]);

  const totalPages = Math.max(1, Math.ceil(filteredCommitments.length / pageSize));
  const effectivePage = Math.min(page, totalPages - 1);
  const visibleRows = filteredCommitments.slice(effectivePage * pageSize, (effectivePage + 1) * pageSize);
  const visibleStart = filteredCommitments.length ? effectivePage * pageSize + 1 : 0;
  const visibleEnd = Math.min((effectivePage + 1) * pageSize, filteredCommitments.length);
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

  function clearFilters() {
    if (year !== defaultYear) {
      setDataset((current) => ({ ...current, records: [] }));
      setDetailLoading(true);
      setDataMode("loading");
    }
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(defaultYear);
    setPage(0);
  }

  function changeYear(nextYear: string) {
    setDataset((current) => ({ ...current, records: [] }));
    setDetailLoading(true);
    setDataMode("loading");
    setAgency("all");
    setYear(nextYear);
    setPage(0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="経産省関係の調達（委託を含む）・補助金情報 トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達（委託を含む）・補助金情報</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">データ検索</a>
          <a href="#sources">データ更新</a>
        </nav>
        <span className={`update-chip ${dataMode}`} role="status" aria-live="polite"><i />{
          dataMode === "github" ? "掲載データ読込済み" : dataMode === "loading" ? "掲載データ読込中" : "掲載データ取得要確認"
        }</span>
      </header>

      <ViewTabs active="gbiz" />

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">G BIZ INFO SEARCH</p>
          <h1><em>経産省関係 調達（委託を含む）・補助金情報</em></h1>
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
          <div className="hero-actions">
            <a className="primary-action" href="#records">データを検索</a>
            <a className="secondary-action" href="#sources">更新状況を見る</a>
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
              placeholder="法人等の名称・法人番号で検索"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <label>
            <span className="sr-only">公表組織</span>
            <select value={effectiveAgency} onChange={(event) => { setAgency(event.target.value); setPage(0); }}>
              <option value="all">すべての公表組織</option>
              {agencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">GビズINFO掲載区分</span>
            <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(0); }}>
              <option value="all">すべての掲載区分</option>
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

        <div className="result-bar">
          <span role="status" aria-live="polite">
            {detailLoading ? (
              <strong>明細を読込中</strong>
            ) : (
              <>
                <strong>{filteredCommitments.length.toLocaleString("ja-JP")}</strong>掲載行
                {filteredCommitments.length > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}行を表示）`}
              </>
            )}
          </span>
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        <div className="records-table" role="region" aria-label="GビズINFO調達（委託を含む）・補助金掲載情報一覧" tabIndex={0}>
          <table>
            <caption className="sr-only">GビズINFOに掲載された調達（委託を含む）・補助金情報</caption>
            <thead><tr><th scope="col">法人等の名称</th><th scope="col">活動名称・件名</th><th scope="col">公表組織</th><th scope="col">GビズINFO掲載区分</th><th scope="col">GビズINFO掲載値</th><th scope="col">認定日・受注日</th><th scope="col">掲載ページ</th></tr></thead>
            <tbody>{visibleRows.map((row) => (
              <tr key={row.id}>
                <td data-label="法人等の名称"><strong>{row.organization}</strong><small>{row.corporateNumber}</small></td>
                <td data-label="活動名称・件名"><span className="program-name">{row.program || "活動名称・件名の記載なし"}</span></td>
                <td data-label="公表組織">{row.sourceAgency || "公表組織の記載なし"}</td>
                <td data-label="掲載区分"><span className={`stage-badge ${row.stage}`}>{stageLabels[row.stage]}</span></td>
                <td className="amount" data-label="掲載値">{formatPublishedValue(row)}</td>
                <td data-label="認定日・受注日">{formatDate(row.date)}<small>{row.fiscalYear === null ? "年度不明" : `${row.fiscalYear}年度（日付基準）`}</small></td>
                <td data-label="掲載ページ">
                  <a className="source-link" href={`https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${row.corporateNumber}`} target="_blank" rel="noreferrer" aria-label={`${row.organization}のGビズINFO掲載ページを新しいタブで開く`}>GビズINFO ↗</a>
                  <small title="取得した全件CSV内の一意識別子">出典キー：{row.sourceKey}</small>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!filteredCommitments.length && (
            <div className="empty-state">
              <strong>{detailLoading ? "明細データを読み込んでいます" : dataMode === "unavailable" ? "明細データを取得できません" : "該当するレコードがありません"}</strong>
              <span>{detailLoading ? "少しお待ちください。" : dataMode === "unavailable" ? "時間をおいて再読み込みしてください。" : "検索語や条件を変えてください。"}</span>
            </div>
          )}
        </div>

        {filteredCommitments.length > pageSize && (
          <nav className="pagination" aria-label="検索結果のページ送り">
            <button disabled={effectivePage === 0} onClick={() => setPage(Math.max(0, effectivePage - 1))}>← 前へ</button>
            <span>{effectivePage + 1} / {totalPages}</span>
            <button disabled={effectivePage + 1 >= totalPages} onClick={() => setPage(Math.min(totalPages - 1, effectivePage + 1))}>次へ →</button>
          </nav>
        )}
      </section>

      <section className="source-section" id="sources">
        <div className="section-heading light">
          <div><p className="eyebrow">DATA UPDATES</p><h2>データ更新状況</h2></div>
          <p>当サイトは毎日、GビズINFO全件CSVの再取得を試みます。GビズINFO側の原データ更新時期は出典ごとに異なります。</p>
        </div>
        {gbizSource && (
          <div className="source-grid">
            <article>
              <div><span className={`health ${gbizSource.status}`} />GビズINFO</div>
              <strong>{gbizSource.recordCount.toLocaleString("ja-JP")}行を収録</strong>
              <dl>
                <div><dt>取得方式</dt><dd>全件CSVの再取得を毎日試行</dd></div>
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
              <a className="source-link" href="https://info.gbiz.go.jp/hojin/dashboard" target="_blank" rel="noreferrer">GビズINFO公式画面 ↗</a>
            </article>
          </div>
        )}
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>経産省関係の調達（委託を含む）・補助金情報</span></div>
        <p>「GビズINFO」（経済産業省）のデータを当サイトで抽出・整形して作成した非公式サイトです。原データと本サイトの抽出・取込は、正確性・完全性・最新性を保証しません。</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
