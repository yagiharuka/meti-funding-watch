"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";

type Stage = "contracted" | "award_decision" | "subsidy_published" | "finalized" | "paid";

type FundingRecord = {
  id: string;
  fiscalYear: number;
  date: string;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  program: string;
  amount: number | null;
  stage: Stage;
  route: string[];
  sourceName: string;
  sourceUrl: string;
  quality: "primary" | "aggregated";
  ingestSource?: "gbiz-api" | "gbiz-bulk-csv" | "nedo-monthly-csv";
};

type FundingSource = {
  id: string;
  name: string;
  recordCount: number;
  method: string;
  frequency: string;
  lastChecked: string;
  status: "healthy" | "watch";
};

type CoverageSeries = {
  fiscalYears: number[];
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
  contracted: "契約額",
  award_decision: "交付決定額",
  subsidy_published: "補助金掲載額",
  finalized: "確定額",
  paid: "支払済額",
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function compactYen(value: number) {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}兆円`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万円`;
  return yen.format(value);
}

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function includesQuery(values: Array<string | number | null>, query: string) {
  if (!query) return true;
  return values.join(" ").toLocaleLowerCase("ja-JP").includes(query);
}

function distinctYears(values: number[]) {
  return Array.from(new Set(values.filter(Number.isInteger))).sort((a, b) => a - b);
}

function formatCoverageYears(years: number[]) {
  if (!years.length) return "収録なし";
  if (years.length === 1) return `${years[0]}年度`;
  return `${years[0]}–${years.at(-1)}年度（${years.length}年度）`;
}

export default function Home() {
  const initialYear = bundledFundingData.coverage?.gbiz.fiscalYears.at(-1);
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [manifest, setManifest] = useState<DataChunkManifest | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("all");
  const [stage, setStage] = useState("all");
  const [year, setYear] = useState(initialYear ? String(initialYear) : "all");
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
        if (typeof candidate.generatedAt === "string" && candidate.commitments) {
          setManifest(candidate);
          setDataset((current) => ({ ...current, generatedAt: candidate.generatedAt }));
        }
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
        setDataset((current) => ({
          ...current,
          generatedAt: manifest.generatedAt,
          records: groups.flat(),
        }));
        setDataMode("github");
        setDetailLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("unavailable");
        setDetailLoading(false);
      });
    return () => controller.abort();
  }, [manifest, year]);

  const commitments = useMemo(
    () => dataset.records.filter((row) => row.ingestSource !== "nedo-monthly-csv"),
    [dataset.records],
  );
  const gbizSource = dataset.sources.find((source) => source.id === "gbiz");
  const coverageYears = dataset.coverage?.gbiz.fiscalYears ?? distinctYears(commitments.map((row) => row.fiscalYear));
  const defaultYear = initialYear ? String(initialYear) : "all";
  const agencies = useMemo(
    () => Array.from(new Set(commitments.map((row) => row.sourceAgency).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja")),
    [commitments],
  );
  const fiscalYears = useMemo(() => {
    const years = commitments.length ? distinctYears(commitments.map((row) => row.fiscalYear)) : coverageYears;
    return [...years].sort((a, b) => b - a);
  }, [commitments, coverageYears]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const filteredCommitments = useMemo(() => commitments
    .filter((row) =>
      includesQuery([row.organization, row.corporateNumber], normalizedQuery) &&
      (agency === "all" || row.sourceAgency === agency) &&
      (stage === "all" || row.stage === stage) &&
      (year === "all" || String(row.fiscalYear) === year))
    .sort((a, b) =>
      b.fiscalYear - a.fiscalYear ||
      b.date.localeCompare(a.date) ||
      a.organization.localeCompare(b.organization, "ja")),
  [agency, commitments, normalizedQuery, stage, year]);

  const totalPages = Math.max(1, Math.ceil(filteredCommitments.length / pageSize));
  const visibleRows = filteredCommitments.slice(page * pageSize, (page + 1) * pageSize);
  const visibleStart = filteredCommitments.length ? page * pageSize + 1 : 0;
  const visibleEnd = Math.min((page + 1) * pageSize, filteredCommitments.length);
  const filteredAmount = filteredCommitments.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const hasFilters = query || agency !== "all" || stage !== "all" || year !== defaultYear;

  function clearFilters() {
    if (year !== defaultYear) {
      setDetailLoading(true);
      setDataMode("loading");
    }
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(defaultYear);
    setPage(0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="事業者等への交付金額(経産省) トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>事業者等への交付金額(経産省)</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">データ検索</a>
          <a href="#sources">データ更新</a>
        </nav>
        <span className="update-chip"><i />{
          dataMode === "github" ? "明細準備完了" : dataMode === "loading" ? "明細読込中" : "明細取得要確認"
        }</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">PUBLIC MONEY EXPLORER</p>
          <h1>事業者等への<br /><em>交付金額(経産省)</em></h1>
          <p className="hero-lead">
            GビズINFOに掲載された、経済産業省と所管法人による契約・補助金を、
            受取先名・法人番号・年度などから検索できます。
          </p>
          <div className="hero-note">
            <span>表示データ更新</span>
            <strong>{formatUpdated(dataset.generatedAt)}</strong>
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
            <p className="eyebrow">RECIPIENTS & FUNDING</p>
            <h2>受取先別の契約・補助金</h2>
          </div>
          <p>検索対象はGビズINFOに掲載された経済産業省関係の契約・補助金です。受取先名と法人番号で検索できます。</p>
        </div>

        <div className="series-label" aria-label="表示中のデータ系列">
          <strong>受取先別の契約・補助金</strong>
          <span>GビズINFO</span>
        </div>

        <div className="filters" aria-label="検索条件">
          <label className="search-field">
            <span className="sr-only">受取先名または法人番号で検索</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input
              type="search"
              placeholder="受取先名・法人番号で検索"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <label>
            <span className="sr-only">支出元・実施機関</span>
            <select value={agency} onChange={(event) => { setAgency(event.target.value); setPage(0); }}>
              <option value="all">すべての支出元</option>
              {agencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">金額段階</span>
            <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(0); }}>
              <option value="all">すべての金額段階</option>
              {Object.entries(stageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">年度</span>
            <select value={year} onChange={(event) => { setDetailLoading(true); setDataMode("loading"); setYear(event.target.value); setPage(0); }}>
              <option value="all">全期間</option>
              {fiscalYears.map((item) => <option key={item} value={item}>{item}年度</option>)}
            </select>
          </label>
        </div>

        <div className="result-bar">
          {detailLoading ? (
            <span><strong>明細を読込中</strong></span>
          ) : (
            <span>
              <strong>{filteredCommitments.length.toLocaleString("ja-JP")}</strong>件
              {filteredCommitments.length > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}件を表示）`}
              <b>・掲載額の単純合計 {compactYen(filteredAmount)}</b>
            </span>
          )}
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        <div className="records-table" role="region" aria-label="GビズINFO契約・補助金一覧" tabIndex={0}>
          <table>
            <thead><tr><th>受取先</th><th>制度・事業</th><th>実施機関</th><th>段階</th><th>金額</th><th>年度</th><th>根拠</th></tr></thead>
            <tbody>{visibleRows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td>
                <td><span className="program-name">{row.program}</span><small className="route">{row.route.join(" → ")}</small></td>
                <td>{row.sourceAgency}</td>
                <td><span className={`stage-badge ${row.stage}`}>{stageLabels[row.stage]}</span></td>
                <td className="amount">{row.amount === null ? "金額未公表" : yen.format(row.amount)}</td>
                <td>{row.fiscalYear}</td>
                <td><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">原典 ↗</a></td>
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
          <p>GビズINFOの更新内容を毎日取り込みます。取得に失敗した場合は、前回取得したデータを表示します。</p>
        </div>
        {gbizSource && (
          <div className="source-grid">
            <article>
              <div><span className={`health ${gbizSource.status}`} />GビズINFO</div>
              <strong>{gbizSource.recordCount.toLocaleString("ja-JP")}件</strong>
              <dl>
                <div><dt>取得方式</dt><dd>期間指定API（差分取得）</dd></div>
                <div><dt>更新周期</dt><dd>毎日</dd></div>
                <div><dt>収録期間</dt><dd>{formatCoverageYears(coverageYears)}</dd></div>
                <div><dt>最終確認</dt><dd>{gbizSource.lastChecked}</dd></div>
              </dl>
            </article>
          </div>
        )}
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>事業者等への交付金額(経産省)</span></div>
        <p>GビズINFOの公開情報を利用した非公式プロトタイプ</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
