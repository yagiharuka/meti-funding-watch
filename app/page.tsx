"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";

type Stage = "contracted" | "award_decision" | "subsidy_published" | "finalized" | "paid";
type FlowLevel = "recipient" | "intermediary" | "unclassified";
type FlowFilter = "all" | FlowLevel;
type View = "payments" | "commitments" | "programs";

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
  flowLevel?: FlowLevel;
  route: string[];
  sourceName: string;
  sourceUrl: string;
  quality: "primary" | "aggregated";
  ingestSource?: "gbiz-api" | "gbiz-bulk-csv" | "nedo-monthly-csv";
};

type ReviewPayment = {
  id: string;
  fiscalYear: number;
  reviewSheetYear: number;
  reviewProjectId: string;
  organization: string;
  corporateNumber: string;
  organizationType: string;
  sourceAgency: string;
  program: string;
  amount: number;
  flowLevel: FlowLevel;
  flowDepth: number | null;
  block: string;
  route: string[];
  sourceName: string;
  sourceUrl: string;
  quality: "primary";
};

type ReviewProgram = {
  id: string;
  reviewSheetYear: number;
  projectNumber: string;
  name: string;
  organization: string;
  budgetFiscalYear: number;
  initialBudget: number | null;
  availableBudget: number | null;
  executionFiscalYear: number | null;
  execution: number | null;
  executionRate: number | null;
  sourceUrl: string;
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
  reviewSheetYears?: number[];
};

type DatasetCoverage = {
  reviewPayments: CoverageSeries;
  gbiz: CoverageSeries;
  nedo: CoverageSeries;
  commonFiscalYears: number[];
  migratedReviewSheetYears: number[];
  migratedDataNote: string;
};

type FiscalYearAggregate = {
  recipientPaymentAmount: number;
  intermediaryPaymentAmount: number;
  recipientCommitmentAmount: number;
  executionAmount: number;
  nedoRecipientAmount: number;
  nedoRecipientCount: number;
};

type FundingDataset = {
  generatedAt: string;
  sources: FundingSource[];
  records: FundingRecord[];
  reviewPayments?: ReviewPayment[];
  reviewPrograms?: ReviewProgram[];
  coverage?: DatasetCoverage;
  aggregates?: {
    byFiscalYear: Record<string, FiscalYearAggregate>;
  };
};

type DataChunkManifest = {
  generatedAt: string;
  payments: Record<string, string>;
  commitments: Record<string, string>;
  programs: Record<string, string>;
};

const bundledFundingData = fundingSummary as FundingDataset;
const dataBaseUrl = "data/";
const pageSize = 100;
const emptyReviewPayments: ReviewPayment[] = [];
const emptyReviewPrograms: ReviewProgram[] = [];

const stageLabels: Record<Stage, string> = {
  contracted: "契約額",
  award_decision: "交付決定額",
  subsidy_published: "補助金掲載額",
  finalized: "確定額",
  paid: "支払済額",
};

const flowLabels: Record<FlowLevel, string> = {
  recipient: "公表経路上の受取先",
  intermediary: "実施機関・中間受取先",
  unclassified: "経路未分類",
};

const flowFilterLabels: Record<FlowFilter, string> = {
  all: "すべての経路上の掲載先",
  ...flowLabels,
};

const targetSourceMeta: Record<string, Pick<FundingSource, "method" | "frequency">> = {
  gbiz: {
    method: "期間指定API（差分取得）",
    frequency: "毎日",
  },
  "review-sheets": {
    method: "公式CSV（年度単位）",
    frequency: "年1回",
  },
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

function sumAmounts<T extends { amount: number | null }>(rows: T[]) {
  return rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
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
  const initialComparisonYear = bundledFundingData.coverage?.commonFiscalYears.at(-1);
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [manifest, setManifest] = useState<DataChunkManifest | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [view, setView] = useState<View>("payments");
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("all");
  const [stage, setStage] = useState("all");
  const [year, setYear] = useState(initialComparisonYear ? String(initialComparisonYear) : "all");
  const [flowLevel, setFlowLevel] = useState<FlowFilter>("all");
  const [page, setPage] = useState(0);
  const chunkCache = useRef(new Map<string, unknown[]>());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${dataBaseUrl}manifest.json`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Data manifest: ${response.status}`);
        return response.json() as Promise<DataChunkManifest>;
      })
      .then((candidate) => {
        if (
          typeof candidate.generatedAt === "string" &&
          candidate.payments &&
          candidate.commitments &&
          candidate.programs
        ) {
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
    const filesByYear = manifest[view];
    const filenames = year === "all"
      ? Object.values(filesByYear)
      : [filesByYear[year]].filter((filename): filename is string => Boolean(filename));

    Promise.all(filenames.map(async (filename) => {
      const cached = chunkCache.current.get(filename);
      if (cached) return cached;
      const response = await fetch(`${dataBaseUrl}${filename}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Data chunk: ${response.status}`);
      const rows = await response.json() as unknown[];
      chunkCache.current.set(filename, rows);
      return rows;
    }))
      .then((groups) => {
        const rows = groups.flat();
        setDataset((current) => ({
          ...current,
          generatedAt: manifest.generatedAt,
          records: view === "commitments" ? rows as FundingRecord[] : current.records,
          reviewPayments: view === "payments" ? rows as ReviewPayment[] : current.reviewPayments,
          reviewPrograms: view === "programs" ? rows as ReviewProgram[] : current.reviewPrograms,
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
  }, [manifest, view, year]);

  const commitments = useMemo(
    () => dataset.records.filter((row) => row.ingestSource !== "nedo-monthly-csv"),
    [dataset.records],
  );
  const payments = dataset.reviewPayments ?? emptyReviewPayments;
  const programs = dataset.reviewPrograms ?? emptyReviewPrograms;
  const targetSources = useMemo(
    () => dataset.sources.filter((source) => source.id === "gbiz" || source.id === "review-sheets"),
    [dataset.sources],
  );

  const coverage = useMemo<DatasetCoverage>(() => {
    const reviewFiscalYears = distinctYears(payments.map((row) => row.fiscalYear));
    const reviewSheetYears = distinctYears(payments.map((row) => row.reviewSheetYear));
    const gbizFiscalYears = distinctYears(commitments
      .filter((row) => row.ingestSource === "gbiz-bulk-csv" || /GビズINFO/.test(row.sourceName))
      .map((row) => row.fiscalYear));
    const nedoFiscalYears = distinctYears(commitments
      .filter((row) => row.ingestSource === "nedo-monthly-csv" || /^NEDO .+契約CSV/.test(row.sourceName))
      .map((row) => row.fiscalYear));
    return dataset.coverage ?? {
      reviewPayments: {
        fiscalYears: reviewFiscalYears,
        reviewSheetYears,
        completeness: "official-csv",
        note: "行政事業レビュー公式CSVの支出先・支出経路",
      },
      gbiz: {
        fiscalYears: gbizFiscalYears,
        completeness: "source-records",
        note: "GビズINFO全件CSVの補助金・調達",
      },
      nedo: {
        fiscalYears: nedoFiscalYears,
        completeness: "published-monthly-csv",
        note: "NEDO月次契約CSV",
      },
      commonFiscalYears: reviewFiscalYears.filter((item) => gbizFiscalYears.includes(item)),
      migratedReviewSheetYears: [2021, 2022, 2023],
      migratedDataNote: "移行年度は支出先詳細・支出経路が不足するため全件集計に含めない",
    };
  }, [commitments, dataset.coverage, payments]);

  const defaultYear = initialComparisonYear ? String(initialComparisonYear) : "all";

  const agencies = useMemo(() => {
    const values = view === "payments"
      ? payments.map((row) => row.sourceAgency)
      : view === "commitments"
        ? commitments.map((row) => row.sourceAgency)
        : programs.map((row) => row.organization);
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
  }, [commitments, payments, programs, view]);

  const fiscalYears = useMemo(() => {
    const rowValues = view === "payments"
      ? payments.map((row) => row.fiscalYear)
      : view === "commitments"
        ? commitments.map((row) => row.fiscalYear)
        : programs.flatMap((row) => row.executionFiscalYear === null ? [] : [row.executionFiscalYear]);
    const values = rowValues.length
      ? rowValues
      : view === "commitments"
        ? coverage.gbiz.fiscalYears
        : coverage.reviewPayments.fiscalYears;
    return Array.from(new Set(values)).sort((a, b) => b - a);
  }, [commitments, coverage.gbiz.fiscalYears, coverage.reviewPayments.fiscalYears, payments, programs, view]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const filteredPayments = useMemo(() => payments
    .filter((row) =>
      includesQuery([row.organization, row.corporateNumber], normalizedQuery) &&
      (flowLevel === "all" || row.flowLevel === flowLevel) &&
      (agency === "all" || row.sourceAgency === agency) &&
      (year === "all" || String(row.fiscalYear) === year))
    .sort((a, b) =>
      b.fiscalYear - a.fiscalYear ||
      a.organization.localeCompare(b.organization, "ja") ||
      a.program.localeCompare(b.program, "ja")),
  [agency, flowLevel, normalizedQuery, payments, year]);

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

  const filteredPrograms = useMemo(() => programs
    .filter((row) =>
      includesQuery([row.projectNumber, row.name, row.organization], normalizedQuery) &&
      (agency === "all" || row.organization === agency) &&
      (year === "all" || String(row.executionFiscalYear) === year))
    .sort((a, b) =>
      (b.executionFiscalYear ?? 0) - (a.executionFiscalYear ?? 0) ||
      a.projectNumber.localeCompare(b.projectNumber, "ja")),
  [agency, normalizedQuery, programs, year]);

  const activeRows = view === "payments"
    ? filteredPayments
    : view === "commitments"
      ? filteredCommitments
      : filteredPrograms;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const visibleRows = activeRows.slice(page * pageSize, (page + 1) * pageSize);
  const visibleStart = activeRows.length ? page * pageSize + 1 : 0;
  const visibleEnd = Math.min((page + 1) * pageSize, activeRows.length);
  const filteredAmount = view === "programs" ? null : sumAmounts(activeRows as Array<{ amount: number | null }>);

  const sourceCoverage: Record<string, string> = {
    "review-sheets": formatCoverageYears(coverage.reviewPayments.fiscalYears),
    gbiz: formatCoverageYears(coverage.gbiz.fiscalYears),
  };

  function changeView(nextView: View) {
    if (nextView === view) return;
    setDetailLoading(true);
    setDataMode("loading");
    setView(nextView);
    setAgency("all");
    setStage("all");
    setYear(defaultYear);
    setFlowLevel(nextView === "payments" ? "all" : "recipient");
    setPage(0);
  }

  function clearFilters() {
    if (year !== defaultYear) {
      setDetailLoading(true);
      setDataMode("loading");
    }
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(defaultYear);
    setFlowLevel(view === "payments" ? "all" : "recipient");
    setPage(0);
  }

  const defaultFlowLevel: FlowFilter = view === "payments" ? "all" : "recipient";
  const hasFilters = query || agency !== "all" || stage !== "all" || year !== defaultYear || flowLevel !== defaultFlowLevel;

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
            GビズINFOの契約・補助金と、行政事業レビューシートの掲載支出額・事業別予算／執行を
            1画面で検索します。意味の異なる金額は分けて表示します。
          </p>
          <div className="hero-note">
            <span>表示データ更新</span>
            <strong>{formatUpdated(dataset.generatedAt)}</strong>
            <span className="source-count">2つの公式データ系列</span>
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
            <h2>受取先と金額を検索</h2>
          </div>
          <p>GビズINFOの契約・補助金、行政事業レビューシートの掲載支出額、事業別の予算・執行額を切り替えて確認できます。異なる系列の金額は合算しません。</p>
        </div>

        <div className="view-tabs" role="tablist" aria-label="表示するデータ">
          <button role="tab" aria-selected={view === "commitments"} onClick={() => changeView("commitments")}>
            受取先別の契約・補助金 <small>GビズINFO</small>
          </button>
          <button role="tab" aria-selected={view === "payments"} onClick={() => changeView("payments")}>
            レビューシート掲載支出額 <small>行政事業レビューシート・各支出先ブロック上位10者</small>
          </button>
          <button role="tab" aria-selected={view === "programs"} onClick={() => changeView("programs")}>
            事業別の予算・執行額 <small>行政事業レビューシート</small>
          </button>
        </div>

        <div className={`filters ${view === "programs" ? "program-filters" : ""}`} aria-label="検索条件">
          <label className="search-field">
            <span className="sr-only">{view === "programs" ? "事業名、事業IDまたは担当組織で検索" : "受取先名または法人番号で検索"}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input
              type="search"
              placeholder={view === "programs" ? "事業名・事業ID・担当組織で検索" : "受取先名・法人番号で検索"}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <label>
            <span className="sr-only">{view === "programs" ? "担当組織" : "支出元・実施機関"}</span>
            <select value={agency} onChange={(event) => { setAgency(event.target.value); setPage(0); }}>
              <option value="all">{view === "programs" ? "すべての担当組織" : "すべての支出元"}</option>
              {agencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          {view === "payments" && (
            <label>
              <span className="sr-only">レビューシート上の経路区分</span>
              <select value={flowLevel} onChange={(event) => { setFlowLevel(event.target.value as FlowFilter); setPage(0); }}>
                {Object.entries(flowFilterLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          )}
          {view === "commitments" && (
            <label>
              <span className="sr-only">金額段階</span>
              <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(0); }}>
                <option value="all">すべての金額段階</option>
                {Object.entries(stageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">年度</span>
            <select value={year} onChange={(event) => { setDetailLoading(true); setDataMode("loading"); setYear(event.target.value); setPage(0); }}>
              <option value="all">全期間（収録範囲が異なります）</option>
              {fiscalYears.map((item) => <option key={item} value={item}>{item}年度</option>)}
            </select>
          </label>
        </div>

        <div className="result-bar">
          {detailLoading ? (
            <span><strong>明細を読込中</strong></span>
          ) : (
            <span>
              <strong>{activeRows.length.toLocaleString("ja-JP")}</strong>件
              {activeRows.length > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}件を表示）`}
              {filteredAmount !== null && <b>・掲載額の単純合計 {compactYen(filteredAmount)}</b>}
            </span>
          )}
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        {view === "payments" && (
          <p className="coverage-note">
            各支出先ブロックの上位10者のみを掲載しており、すべての支出先を網羅していません。
            <a href="https://rssystem.go.jp/files/user-guide.pdf" target="_blank" rel="noreferrer">公式ガイド ↗</a>
          </p>
        )}

        <div className="records-table" role="region" aria-label="資金レコード一覧" tabIndex={0}>
          {view === "payments" && (
            <table>
              <thead><tr><th>掲載先</th><th>レビューシート事業</th><th>支出元・経路</th><th>分類</th><th>掲載支出額</th><th>年度</th></tr></thead>
              <tbody>{(visibleRows as ReviewPayment[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td>
                  <td><span className="program-name">{row.program}</span><small>事業ID {row.reviewProjectId.replace(`rs-${row.reviewSheetYear}-`, "")}</small></td>
                  <td><span>{row.sourceAgency}</span><small className="route">{row.route.join(" → ")}</small></td>
                  <td><span className={`flow-badge ${row.flowLevel}`}>{flowLabels[row.flowLevel]}</span></td>
                  <td className="amount">{yen.format(row.amount)}</td>
                  <td>{row.fiscalYear}<small>{row.reviewSheetYear}年度シート</small></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {view === "commitments" && (
            <table>
              <thead><tr><th>受取先</th><th>制度・事業</th><th>実施機関</th><th>段階</th><th>金額</th><th>年度</th><th>根拠</th></tr></thead>
              <tbody>{(visibleRows as FundingRecord[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.organization}</strong><small>{row.corporateNumber}</small></td>
                  <td><span className="program-name">{row.program}</span><small className="route">{row.route.join(" → ")}</small></td>
                  <td>{row.sourceAgency}<small><span className={`flow-badge ${row.flowLevel ?? "recipient"}`}>{flowLabels[row.flowLevel ?? "recipient"]}</span></small></td>
                  <td><span className={`stage-badge ${row.stage}`}>{stageLabels[row.stage]}</span></td>
                  <td className="amount">{row.amount === null ? "金額未公表" : yen.format(row.amount)}</td>
                  <td>{row.fiscalYear}</td>
                  <td><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">原典 ↗</a></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {view === "programs" && (
            <table>
              <thead><tr><th>事業</th><th>担当組織</th><th>当初予算</th><th>歳出予算現額</th><th>執行額</th><th>執行率</th></tr></thead>
              <tbody>{(visibleRows as ReviewProgram[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><small>事業ID {row.projectNumber}・{row.reviewSheetYear}年度シート</small></td>
                  <td>{row.organization}</td>
                  <td className="amount">{row.initialBudget === null ? "未記載" : yen.format(row.initialBudget)}<small>{row.budgetFiscalYear}年度</small></td>
                  <td className="amount">{row.availableBudget === null ? "未記載" : yen.format(row.availableBudget)}<small>{row.budgetFiscalYear}年度</small></td>
                  <td className="amount">{row.execution === null ? "未記載" : yen.format(row.execution)}<small>{row.executionFiscalYear ?? "—"}年度</small></td>
                  <td>{row.executionRate === null ? "—" : `${(row.executionRate * 100).toFixed(1)}%`}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {!activeRows.length && (
            <div className="empty-state">
              <strong>{detailLoading ? "明細データを読み込んでいます" : dataMode === "unavailable" ? "明細データを取得できません" : "該当するレコードがありません"}</strong>
              <span>{detailLoading ? "集計値と収録期間は先に確認できます。" : dataMode === "unavailable" ? "時間をおいて再読み込みしてください。" : "検索語や条件を変えてください。"}</span>
            </div>
          )}
        </div>
        {activeRows.length > pageSize && (
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
          <p>GビズINFOは毎日差分更新、行政事業レビューシートは年1回更新します。取得失敗時は前回データを残します。</p>
        </div>
        <div className="source-grid">
          {targetSources.map((source) => (
            <article key={source.id}>
              <div><span className={`health ${source.status}`} />{source.id === "review-sheets" ? "行政事業レビューシート" : source.name}</div>
              <strong>{source.recordCount.toLocaleString("ja-JP")}件</strong>
              <dl>
                <div><dt>取得方式</dt><dd>{targetSourceMeta[source.id]?.method ?? source.method}</dd></div>
                <div><dt>更新周期</dt><dd>{targetSourceMeta[source.id]?.frequency ?? source.frequency}</dd></div>
                <div><dt>収録期間</dt><dd>{sourceCoverage[source.id] ?? "確認中"}</dd></div>
                <div><dt>最終確認</dt><dd>{source.lastChecked}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>事業者等への交付金額(経産省)</span></div>
        <p>公開情報ベースの非公式プロトタイプ</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
