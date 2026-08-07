"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";

type Stage = "contracted" | "subsidy_published";

type FundingRecord = {
  id: string;
  fiscalYear: number | null;
  date: string | null;
  dateRaw?: string;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  publisherCanonical?: string;
  program: string;
  amount: number | null;
  amountRaw?: string;
  stage: Stage;
  sourceName: string;
  sourceUrl: string;
  sourceRecordHash?: string;
  quality: "primary" | "aggregated";
  ingestSource: "gbiz-bulk-csv";
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

const bundledFundingData = fundingSummary as FundingDataset;
const dataBaseUrl = "data/";
const pageSize = 100;

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


export default function Home() {
  const defaultYear = "all";
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [manifest, setManifest] = useState<DataChunkManifest | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("all");
  const [stage, setStage] = useState("all");
  const [year, setYear] = useState(defaultYear);
  const [page, setPage] = useState(0);
  const chunkCache = useRef(new Map<string, FundingRecord[]>());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${dataBaseUrl}manifest.json`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Data manifest: ${response.status}`);
        return response.json() as Promise<DataChunkManifest>;
      })
      .then((candidate) => {
        if (
          typeof candidate.generatedAt !== "string"
          || !candidate.commitments
          || typeof candidate.commitments !== "object"
        ) {
          throw new Error("Data manifest: invalid schema");
        }
        setManifest(candidate);
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
    if (!manifest) return;
    const controller = new AbortController();
    let active = true;
    const filenames = year === "all"
      ? Object.values(manifest.commitments)
      : [manifest.commitments[year]].filter((filename): filename is string => Boolean(filename));

    Promise.all(filenames.map(async (filename) => {
      const cached = chunkCache.current.get(filename);
      if (cached) return cached;
      const response = await fetch(`${dataBaseUrl}${filename}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Data chunk: ${response.status}`);
      const rows = await response.json() as FundingRecord[];
      chunkCache.current.set(filename, rows);
      return rows;
    }))
      .then((groups) => {
        if (!active) return;
        setDataset((current) => ({
          ...current,
          generatedAt: manifest.generatedAt,
          records: groups.flat(),
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
  }, [manifest, year]);

  const commitments = useMemo(
    () => dataset.records.filter((row) => row.ingestSource === "gbiz-bulk-csv"),
    [dataset.records],
  );
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
      && (agency === "all" || row.sourceAgency === agency)
      && (stage === "all" || row.stage === stage)
      && (year === "all"
        || (year === "unclassified" ? row.fiscalYear === null : String(row.fiscalYear) === year))),
  [agency, normalizedQuery, sortedCommitments, stage, year]);

  const totalPages = Math.max(1, Math.ceil(filteredCommitments.length / pageSize));
  const visibleRows = filteredCommitments.slice(page * pageSize, (page + 1) * pageSize);
  const visibleStart = filteredCommitments.length ? page * pageSize + 1 : 0;
  const visibleEnd = Math.min((page + 1) * pageSize, filteredCommitments.length);
  const hasFilters = query || agency !== "all" || stage !== "all" || year !== defaultYear;
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
    setYear(nextYear);
    setPage(0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="経産省関係の調達・委託・補助金情報 トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達・委託・補助金情報</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">データ検索</a>
          <a href="#adoptions">採択者情報</a>
          <a href="#sources">データ更新</a>
        </nav>
        <span className={`update-chip ${dataMode}`} role="status" aria-live="polite"><i />{
          dataMode === "github" ? "明細準備完了" : dataMode === "loading" ? "明細読込中" : "明細取得要確認"
        }</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">G BIZ INFO SEARCH</p>
          <h1><em>経産省関係 調達・委託・補助金情報</em></h1>
          <p className="hero-scope-warning">
            このサイトは経済産業省の全支出・実支払を示すものではありません。
            GビズINFOに法人番号付きで掲載された調達（委託を含む）・補助金情報だけを表示します。
            所管法人については、NEDO・IPAのGビズINFO掲載分のみが対象で、その他の所管法人は含みません。
            NEDO・IPAの掲載分についても、経済産業省を原資とする支出かどうかはGビズINFOだけでは判別できません。
          </p>
          <div className="hero-note">
            <span>{gbizSource?.lastSuccessfulImportAt ? "明細データ最終取込" : "データ生成日時"}</span>
            <strong>{formatTimestamp(gbizSource?.lastSuccessfulImportAt ?? dataset.generatedAt)}</strong>
            <span className="source-count">データ出典：GビズINFO</span>
          </div>
          <div className="hero-actions">
            <a className="primary-action" href="#records">データを検索</a>
            <a className="secondary-action" href="#sources">更新状況を見る</a>
          </div>
        </div>
      </section>

      <section className="adoption-section" id="adoptions" aria-labelledby="adoptions-title">
        <div className="adoption-card">
          <div className="adoption-copy">
            <p className="eyebrow">SEPARATE ADOPTION RECORDS</p>
            <h2 id="adoptions-title">中小企業庁の補助金採択者情報</h2>
            <p className="adoption-lead">
              Go-Tech、IT導入、ものづくり、事業再構築、持続化などの採択者を、
              中小企業庁の公式検索で確認できます。
            </p>
            <p className="adoption-warning">
              採択は補助金交付の候補者として選定された段階です。交付決定額・確定額・実支払額ではなく、
              金額も掲載されていないため、GビズINFOの掲載情報とは合算しません。
              公開に同意した採択者のみが対象です。
            </p>
            <p className="adoption-detail">
              Go-Techでは、掲載事業者と国から直接補助金を受ける事業管理機関が異なる場合があり、
              掲載事業者名だけでは直接・間接の受領主体や受領額を判定できません。
            </p>
          </div>
          <div className="adoption-actions" aria-label="中小企業庁の公式採択者検索">
            <a
              className="primary-action"
              href="https://mirasapo-connect.go.jp/chusho-subsidies"
              target="_blank"
              rel="noreferrer"
            >
              補助金採択者検索を開く ↗
            </a>
            <a
              className="secondary-action"
              href="https://mirasapo-connect.go.jp/chusho-subsidies?subsidyCodes=GO_TECH"
              target="_blank"
              rel="noreferrer"
            >
              Go-Tech採択者を見る ↗
            </a>
            <span>外部サイト：中小企業庁 成長加速マッチングサービス</span>
          </div>
        </div>
      </section>

      <section className="records-section" id="records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ORGANIZATIONS & PUBLISHED ACTIVITIES</p>
            <h2>調達・委託・補助金の掲載情報</h2>
          </div>
          <p>法人等の名称と法人番号だけを全文検索します。条件を組み合わせて掲載行を確認できます。</p>
        </div>


        <div className="series-label" aria-label="表示中のデータ系列">
          <strong>法人等別の調達・委託・補助金掲載情報</strong>
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
            <select value={agency} onChange={(event) => { setAgency(event.target.value); setPage(0); }}>
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

        <div className="result-bar" role="status" aria-live="polite">
          {detailLoading ? (
            <span><strong>明細を読込中</strong></span>
          ) : (
            <span>
              <strong>{filteredCommitments.length.toLocaleString("ja-JP")}</strong>件
              {filteredCommitments.length > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}件を表示）`}
            </span>
          )}
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        <div className="records-table" role="region" aria-label="GビズINFO調達・委託・補助金掲載情報一覧" tabIndex={0}>
          <table>
            <thead><tr><th>法人等の名称</th><th>活動名称・件名</th><th>公表組織</th><th>GビズINFO掲載区分</th><th>GビズINFO掲載値</th><th>認定日・受注日</th><th>掲載ページ</th></tr></thead>
            <tbody>{visibleRows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.organization}</strong><small>{row.corporateNumber}</small></td>
                <td><span className="program-name">{row.program || "活動名称・件名の記載なし"}</span></td>
                <td>{row.sourceAgency || row.publisherCanonical || "公表組織の記載なし"}</td>
                <td><span className={`stage-badge ${row.stage}`}>{stageLabels[row.stage]}</span></td>
                <td className="amount">{formatPublishedValue(row)}</td>
                <td>{formatDate(row.date)}<small>{row.fiscalYear === null ? "年度不明" : `${row.fiscalYear}年度（日付基準）`}</small></td>
                <td><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${row.organization}のGビズINFO掲載ページを新しいタブで開く`}>GビズINFO ↗</a></td>
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
            <button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← 前へ</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page + 1 >= totalPages} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>次へ →</button>
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
                <div><dt>収録期間</dt><dd>{formatCoverageYears(coverageYears, dataset.coverage?.gbiz.unclassifiedDateCount)}</dd></div>
                <div><dt>{gbizSource.lastSuccessfulImportAt ? "明細データ最終取込" : "成功履歴"}</dt><dd>{gbizSource.lastSuccessfulImportAt ? formatTimestamp(gbizSource.lastSuccessfulImportAt) : "未記録"}</dd></div>
                <div><dt>公式画面の確認</dt><dd>{formatTimestamp(gbizSource.dashboardCheckedAt ?? gbizSource.lastChecked)}</dd></div>
                <div><dt>公式ダッシュボード</dt><dd>{displayCount(dashboardRecordCount)}<small>補助金 {displayCount(gbizSource.dashboardSubsidyCount)}／調達 {displayCount(gbizSource.dashboardProcurementCount)}</small></dd></div>
                <div><dt>取得CSVの対象行</dt><dd>{displayRows(csvEligibleRecordCount)}<small>補助金 {displayRows(gbizSource.csvEligibleSubsidyCount)}／調達 {displayRows(gbizSource.csvEligibleProcurementCount)}</small></dd></div>
                <div><dt>本サイト取込行</dt><dd>{displayRows(csvImportedRecordCount ?? gbizSource.recordCount)}<small>補助金 {displayRows(gbizSource.csvImportedSubsidyCount)}／調達 {displayRows(gbizSource.csvImportedProcurementCount)}</small></dd></div>
                <div><dt>CSV取込差（対象－取込）</dt><dd>{displayRows(csvImportGap)}</dd></div>
                <div><dt>公式画面－CSV対象</dt><dd>{displayDifference(dashboardCsvGap)}</dd></div>
                <div><dt>取込状態</dt><dd>{csvImportVerified ? "当サイトの抽出条件に合うCSV行を全件取込済み" : "要確認"}</dd></div>
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
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>経産省関係の調達・委託・補助金情報</span></div>
        <p>非公式サイトです。GビズINFOおよび本サイトの抽出・取込は、正確性・完全性・最新性を保証しません。</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
