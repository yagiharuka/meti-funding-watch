"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";

type Stage = "contracted" | "award_decision" | "subsidy_published" | "finalized" | "paid";
type FlowLevel = "recipient" | "intermediary" | "unclassified";
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
  const [comparisonYear, setComparisonYear] = useState(initialComparisonYear ? String(initialComparisonYear) : "");
  const [flowLevel, setFlowLevel] = useState<FlowLevel>("recipient");
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

  const comparisonFiscalYear = Number(
    comparisonYear || coverage.commonFiscalYears.at(-1) || coverage.reviewPayments.fiscalYears.at(-1) || 0,
  );

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
      includesQuery([row.organization, row.corporateNumber, row.program, row.sourceAgency], normalizedQuery) &&
      row.flowLevel === flowLevel &&
      (agency === "all" || row.sourceAgency === agency) &&
      (year === "all" || String(row.fiscalYear) === year))
    .sort((a, b) =>
      b.fiscalYear - a.fiscalYear ||
      a.organization.localeCompare(b.organization, "ja") ||
      a.program.localeCompare(b.program, "ja")),
  [agency, flowLevel, normalizedQuery, payments, year]);

  const filteredCommitments = useMemo(() => commitments
    .filter((row) =>
      includesQuery([row.organization, row.corporateNumber, row.program, row.sourceAgency], normalizedQuery) &&
      (row.flowLevel ?? "recipient") === flowLevel &&
      (agency === "all" || row.sourceAgency === agency) &&
      (stage === "all" || row.stage === stage) &&
      (year === "all" || String(row.fiscalYear) === year))
    .sort((a, b) =>
      b.fiscalYear - a.fiscalYear ||
      b.date.localeCompare(a.date) ||
      a.organization.localeCompare(b.organization, "ja")),
  [agency, commitments, flowLevel, normalizedQuery, stage, year]);

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

  const comparisonPayments = payments.filter((row) => row.fiscalYear === comparisonFiscalYear);
  const comparisonCommitments = commitments.filter((row) => row.fiscalYear === comparisonFiscalYear);
  const comparisonPrograms = programs.filter((row) => row.executionFiscalYear === comparisonFiscalYear);
  const summaryAggregate = dataset.aggregates?.byFiscalYear[String(comparisonFiscalYear)];
  const recipientPayments = comparisonPayments.filter((row) => row.flowLevel === "recipient");
  const intermediaryPayments = comparisonPayments.filter((row) => row.flowLevel === "intermediary");
  const recipientCommitments = comparisonCommitments.filter((row) => (row.flowLevel ?? "recipient") === "recipient");
  const recipientPaymentTotal = comparisonPayments.length
    ? sumAmounts(recipientPayments)
    : summaryAggregate?.recipientPaymentAmount ?? 0;
  const intermediaryPaymentTotal = comparisonPayments.length
    ? sumAmounts(intermediaryPayments)
    : summaryAggregate?.intermediaryPaymentAmount ?? 0;
  const recipientCommitmentTotal = comparisonCommitments.length
    ? sumAmounts(recipientCommitments)
    : summaryAggregate?.recipientCommitmentAmount ?? 0;
  const executionTotal = comparisonPrograms.length
    ? comparisonPrograms.reduce((sum, row) => sum + (row.execution ?? 0), 0)
    : summaryAggregate?.executionAmount ?? 0;
  const executionYear = comparisonFiscalYear;
  const paymentYear = comparisonFiscalYear;
  const showMetric = (value: number) => dataMode === "loading" && !value && !summaryAggregate ? "明細読込中" : compactYen(value);
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
    setYear(comparisonYear || "all");
    setFlowLevel("recipient");
    setPage(0);
  }

  function clearFilters() {
    if (year !== (comparisonYear || "all")) {
      setDetailLoading(true);
      setDataMode("loading");
    }
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(comparisonYear || "all");
    setFlowLevel("recipient");
    setPage(0);
  }

  function changeComparisonYear(nextYear: string) {
    setDetailLoading(true);
    setDataMode("loading");
    setComparisonYear(nextYear);
    setYear(nextYear);
    setPage(0);
  }

  const hasFilters = query || agency !== "all" || stage !== "all" || year !== (comparisonYear || "all") || flowLevel !== "recipient";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="事業者等への交付金額(経産省) トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>事業者等への交付金額(経産省)</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">データ検索</a>
          <a href="#migration">移植後の構成</a>
          <a href="#sources">更新運用</a>
          <a href="#about">集計上の注意</a>
        </nav>
        <span className="update-chip"><i />{
          dataMode === "github" ? "明細準備完了" : dataMode === "loading" ? "明細読込中" : "明細取得要確認"
        }</span>
      </header>

      <div className="prototype-banner" role="note">
        <strong>庁内移植後の完成イメージ</strong>
        <span>SharePoint OnlineにPower Appsを埋め込み、Dataverseのデータを検索する想定です。</span>
      </div>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">SHAREPOINT / POWER APPS CONCEPT</p>
          <h1>事業者等への<br /><em>交付金額(経産省)</em></h1>
          <p className="hero-lead">
            GビズINFOの契約・補助金と、行政事業レビューシートの実支出先・事業別予算を、
            庁内の1画面から検索します。データの更新頻度に合わせ、日次更新と年次更新を分けて運用します。
          </p>
          <div className="hero-note">
            <span>表示データ更新</span>
            <strong>{formatUpdated(dataset.generatedAt)}</strong>
            <span className="source-count">庁内版ではDataverseから読込み</span>
          </div>
          <div className="hero-actions">
            <a className="primary-action" href="#records">画面イメージを見る</a>
            <a className="secondary-action" href="#migration">移植構成を見る</a>
          </div>
        </div>

        <aside className="flow-card" aria-label="庁内移植後のデータ構成">
          <div className="flow-card-head">
            <span>庁内版のデータ構成</span>
            <span className="live-dot">TARGET</span>
          </div>
          <div className="flow-path">
            <div className="flow-node ministry"><span>毎日</span><strong>GビズINFO 差分API</strong></div>
            <div className="flow-node review"><span>年1回</span><strong>行政事業レビューCSV</strong></div>
            <div className="flow-line"><span>Power Automate / データフロー</span></div>
            <div className="flow-node agency"><span>データベース</span><strong>Dataverse</strong></div>
            <div className="flow-line"><span>検索・絞り込み</span></div>
            <div className="flow-node company"><span>SharePointに埋込み</span><strong>Power Apps</strong></div>
          </div>
          <div className="flow-total">
            <span>GitHubとの自動接続</span>
            <strong>不要</strong>
          </div>
          <p>SPFx、Entra IDアプリ、Azure Functionsを使わない最小構成です。</p>
        </aside>
      </section>

      <section className="coverage-panel" aria-label="移植後の更新頻度と比較年度">
        <div className="coverage-copy">
          <p className="eyebrow">UPDATE POLICY</p>
          <h2>更新頻度を分けて、無理なく続ける</h2>
          <p>85万行規模の全件CSVを毎日処理せず、GビズINFOは差分だけ、レビューシートは公表時に年度単位で更新します。</p>
        </div>
        <label className="comparison-year">
          <span>現在の比較年度</span>
          <select value={String(comparisonFiscalYear || "")} onChange={(event) => changeComparisonYear(event.target.value)}>
            {coverage.commonFiscalYears.slice().reverse().map((item) => (
              <option key={item} value={item}>{item}年度</option>
            ))}
          </select>
          <small>実支出と契約・補助金を比較する年度</small>
        </label>
        <div className="coverage-grid">
          <article>
            <span>GビズINFO</span>
            <strong>毎日・差分取得</strong>
            <small>補助金・調達の期間指定API</small>
          </article>
          <article>
            <span>レビューシート</span>
            <strong>年1回・年度追加</strong>
            <small>実支出先と事業別予算・執行</small>
          </article>
          <article>
            <span>NEDO独自契約CSV</span>
            <strong>当面取り込まない</strong>
            <small>GビズINFOに掲載された情報は対象</small>
          </article>
          <article className="coverage-caution">
            <span>データ保管</span>
            <strong>Dataverse</strong>
            <small>Power Appsは庁内データだけを参照</small>
          </article>
        </div>
      </section>

      <section className="metrics" aria-label="データ全体の集計">
        <article>
          <span>{paymentYear || "—"}年度 公表経路上の支出先額</span>
          <strong>{showMetric(recipientPaymentTotal)}</strong>
          <small>行政事業レビュー・終端ブロック</small>
        </article>
        <article className="metric-upstream">
          <span>{paymentYear || "—"}年度 実施機関・中間受取先額</span>
          <strong>{showMetric(intermediaryPaymentTotal)}</strong>
          <small>上の支出先額とは合算しません</small>
        </article>
        <article>
          <span>{executionYear || "—"}年度 事業執行額</span>
          <strong>{showMetric(executionTotal)}</strong>
          <small>レビューシート単純合計・重複可能性あり</small>
        </article>
        <article className="metric-warning">
          <span>{comparisonFiscalYear || "—"}年度 契約・補助金掲載額</span>
          <strong>{showMetric(recipientCommitmentTotal)}</strong>
          <small>同年度に限定・実支出とは別系列</small>
        </article>
      </section>

      <section className="records-section" id="records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECIPIENTS & FUNDING</p>
            <h2>受取先と金額を検索</h2>
          </div>
          <p>行政事業レビューの支出先別実支出、GビズINFOの契約・補助金、レビューシート事業の予算・執行額を切り替えて確認できます。異なる系列の金額は合算しません。</p>
        </div>

        <div className="view-tabs" role="tablist" aria-label="表示するデータ">
          <button role="tab" aria-selected={view === "payments"} onClick={() => changeView("payments")}>
            受取先別の実支出 <small>行政事業レビュー</small>
          </button>
          <button role="tab" aria-selected={view === "commitments"} onClick={() => changeView("commitments")}>
            受取先別の契約・補助金 <small>GビズINFO</small>
          </button>
          <button role="tab" aria-selected={view === "programs"} onClick={() => changeView("programs")}>
            事業別の予算・執行額 <small>行政事業レビュー</small>
          </button>
        </div>

        <div className={`filters ${view === "programs" ? "program-filters" : ""}`} aria-label="検索条件">
          <label className="search-field">
            <span className="sr-only">受取先名、法人番号または制度名で検索</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input
              type="search"
              placeholder={view === "programs" ? "事業名・事業ID・担当組織で検索" : "受取先名・法人番号・制度名で検索"}
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
          {view !== "programs" && (
            <label>
              <span className="sr-only">資金レイヤー</span>
              <select value={flowLevel} onChange={(event) => { setFlowLevel(event.target.value as FlowLevel); setPage(0); }}>
                {Object.entries(flowLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
              {filteredAmount !== null && <b>・選択系列 {compactYen(filteredAmount)}</b>}
            </span>
          )}
          {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
        </div>

        <div className="records-table" role="region" aria-label="資金レコード一覧" tabIndex={0}>
          {view === "payments" && (
            <table>
              <thead><tr><th>受取先</th><th>レビューシート事業</th><th>支出元・経路</th><th>分類</th><th>支出先額</th><th>年度</th><th>根拠</th></tr></thead>
              <tbody>{(visibleRows as ReviewPayment[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td>
                  <td><span className="program-name">{row.program}</span><small>事業ID {row.reviewProjectId.replace(`rs-${row.reviewSheetYear}-`, "")}</small></td>
                  <td><span>{row.sourceAgency}</span><small className="route">{row.route.join(" → ")}</small></td>
                  <td><span className={`flow-badge ${row.flowLevel}`}>{flowLabels[row.flowLevel]}</span></td>
                  <td className="amount">{yen.format(row.amount)}</td>
                  <td>{row.fiscalYear}<small>{row.reviewSheetYear}年度シート</small></td>
                  <td><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">公式CSV ↗</a></td>
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
              <thead><tr><th>事業</th><th>担当組織</th><th>当初予算</th><th>歳出予算現額</th><th>執行額</th><th>執行率</th><th>根拠</th></tr></thead>
              <tbody>{(visibleRows as ReviewProgram[]).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><small>事業ID {row.projectNumber}・{row.reviewSheetYear}年度シート</small></td>
                  <td>{row.organization}</td>
                  <td className="amount">{row.initialBudget === null ? "未記載" : yen.format(row.initialBudget)}<small>{row.budgetFiscalYear}年度</small></td>
                  <td className="amount">{row.availableBudget === null ? "未記載" : yen.format(row.availableBudget)}<small>{row.budgetFiscalYear}年度</small></td>
                  <td className="amount">{row.execution === null ? "未記載" : yen.format(row.execution)}<small>{row.executionFiscalYear ?? "—"}年度</small></td>
                  <td>{row.executionRate === null ? "—" : `${(row.executionRate * 100).toFixed(1)}%`}</td>
                  <td><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">公式CSV ↗</a></td>
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

      <section className="migration-section" id="migration">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TARGET ARCHITECTURE</p>
            <h2>METI内への移植イメージ</h2>
          </div>
          <p>公開サイトのコードをそのまま持ち込むのではなく、標準のPower Platform機能で同じ検索体験を再構成します。</p>
        </div>
        <div className="migration-flow" aria-label="公開データからSharePoint画面までの流れ">
          <article>
            <span className="step-number">01</span>
            <small>公開データ</small>
            <strong>GビズINFO<br />レビューシート</strong>
            <p>機微情報は使わず、公開情報だけを取得します。</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">→</span>
          <article>
            <span className="step-number">02</span>
            <small>更新処理</small>
            <strong>Power Automate<br />データフロー</strong>
            <p>日次差分と年次取込を別々に実行します。</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">→</span>
          <article>
            <span className="step-number">03</span>
            <small>データ保管</small>
            <strong>Dataverse</strong>
            <p>3系列を別テーブルに保存し、重複を防ぎます。</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">→</span>
          <article>
            <span className="step-number">04</span>
            <small>庁内画面</small>
            <strong>Power Apps<br />＋ SharePoint</strong>
            <p>検索アプリをSharePointページへ埋め込みます。</p>
          </article>
        </div>
        <div className="migration-notes">
          <article>
            <span>利用するもの</span>
            <strong>Power Apps・Dataverse・Power Automate・SharePoint</strong>
          </article>
          <article>
            <span>利用しないもの</span>
            <strong>SPFx・App Catalog・Entra IDアプリ・Azure Functions・GitHub接続</strong>
          </article>
          <a href="https://github.com/yagiharuka/meti-funding-watch/blob/main/docs/METI_POWER_APPS_MIGRATION_GUIDE.md" target="_blank" rel="noreferrer">
            詳細な作業手順を開く ↗
          </a>
        </div>
      </section>

      <section className="source-section" id="sources">
        <div className="section-heading light">
          <div><p className="eyebrow">OPERATIONS</p><h2>移植後の更新運用</h2></div>
          <p>GビズINFOは毎日差分更新、レビューシートは年1回更新します。取得失敗時は前回データを残します。</p>
        </div>
        <div className="source-grid">
          {targetSources.map((source) => (
            <article key={source.id}>
              <div><span className={`health ${source.status}`} />{source.name}</div>
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

      <section className="about-section" id="about">
        <div>
          <p className="eyebrow">TRANSPARENCY BY DESIGN</p>
          <h2>違う段階の金額を、足さない。</h2>
        </div>
        <div className="about-copy">
          <p>
            行政事業レビューの支出先額、事業執行額、GビズINFOの契約・補助金掲載額は別系列です。
            庁内版でも、段階の違う金額を合算せずに表示します。
          </p>
          <ul>
            <li>2024・2025年度レビューシートの支出先情報を、原則2023・2024年度の支出として表示</li>
            <li>GビズINFOとの比較は共通して収録されている同一年度に限定し、全期間総額を横並びにしない</li>
            <li>2021〜2023年度の移行レビューシートは支出先詳細・支出経路が不足するため、全件集計には含めない</li>
            <li>「公表経路上の受取先」は、レビューシートでその先の経路が確認できない終端を意味する</li>
            <li>レビューシートの予算・執行額はシート単純合計で、同一予算事業の重複を含む可能性がある</li>
            <li>法人番号がない団体もレビューシート掲載名のまま収録し、欠損を0円に置き換えない</li>
          </ul>
          <p className="attribution">
            出典：<a href="https://rssystem.go.jp/download-csv" target="_blank" rel="noreferrer">行政事業レビュー見える化サイト</a>。
            当サイトでデータを編集・加工して作成。
          </p>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>事業者等への交付金額(経産省)</span></div>
        <p>庁内移植の説明用・公開情報ベースの非公式プロトタイプ</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
