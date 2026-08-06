"use client";

import { useEffect, useMemo, useState } from "react";
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

const bundledFundingData = fundingSummary as FundingDataset;
const liveDataUrl = "data/funding-data.json";
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
  const [view, setView] = useState<View>("payments");
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("all");
  const [stage, setStage] = useState("all");
  const [year, setYear] = useState(initialComparisonYear ? String(initialComparisonYear) : "all");
  const [comparisonYear, setComparisonYear] = useState(initialComparisonYear ? String(initialComparisonYear) : "");
  const [flowLevel, setFlowLevel] = useState<FlowLevel>("recipient");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(liveDataUrl, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub data: ${response.status}`);
        return response.json() as Promise<FundingDataset>;
      })
      .then((candidate) => {
        if (
          typeof candidate.generatedAt === "string" &&
          Array.isArray(candidate.records) &&
          Array.isArray(candidate.sources)
        ) {
          setDataset(candidate);
          const reviewYears = candidate.coverage?.reviewPayments.fiscalYears
            ?? distinctYears((candidate.reviewPayments ?? []).map((row) => row.fiscalYear));
          const gbizYears = candidate.coverage?.gbiz.fiscalYears
            ?? distinctYears(candidate.records
              .filter((row) => row.ingestSource === "gbiz-bulk-csv" || /GビズINFO/.test(row.sourceName))
              .map((row) => row.fiscalYear));
          const commonYears = candidate.coverage?.commonFiscalYears
            ?? reviewYears.filter((item) => gbizYears.includes(item));
          const latestCommonYear = commonYears.at(-1);
          if (latestCommonYear) {
            setComparisonYear(String(latestCommonYear));
            setYear(String(latestCommonYear));
          }
          setDataMode("github");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("unavailable");
      });
    return () => controller.abort();
  }, []);

  const commitments = dataset.records;
  const payments = dataset.reviewPayments ?? emptyReviewPayments;
  const programs = dataset.reviewPrograms ?? emptyReviewPrograms;

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
  const summaryAggregate = dataset.aggregates?.byFiscalYear[String(comparisonFiscalYear)];
  const useSummaryAggregate = dataMode === "loading" && comparisonPayments.length === 0 && comparisonCommitments.length === 0;
  const recipientPayments = comparisonPayments.filter((row) => row.flowLevel === "recipient");
  const intermediaryPayments = comparisonPayments.filter((row) => row.flowLevel === "intermediary");
  const recipientCommitments = comparisonCommitments.filter((row) => (row.flowLevel ?? "recipient") === "recipient");
  const recipientPaymentTotal = useSummaryAggregate
    ? summaryAggregate?.recipientPaymentAmount ?? 0
    : sumAmounts(recipientPayments);
  const intermediaryPaymentTotal = useSummaryAggregate
    ? summaryAggregate?.intermediaryPaymentAmount ?? 0
    : sumAmounts(intermediaryPayments);
  const recipientCommitmentTotal = useSummaryAggregate
    ? summaryAggregate?.recipientCommitmentAmount ?? 0
    : sumAmounts(recipientCommitments);
  const calculatedExecutionTotal = programs
    .filter((row) => row.executionFiscalYear === comparisonFiscalYear)
    .reduce((sum, row) => sum + (row.execution ?? 0), 0);
  const executionTotal = useSummaryAggregate
    ? summaryAggregate?.executionAmount ?? 0
    : calculatedExecutionTotal;
  const executionYear = comparisonFiscalYear;
  const paymentYear = comparisonFiscalYear;
  const nedoRecipients = recipientPayments.filter((row) =>
    row.route.some((node) => /NEDO|新エネルギー・産業技術総合開発機構/.test(node)),
  );
  const nedoRecipientTotal = useSummaryAggregate
    ? summaryAggregate?.nedoRecipientAmount ?? 0
    : sumAmounts(nedoRecipients);
  const nedoRecipientCount = useSummaryAggregate
    ? summaryAggregate?.nedoRecipientCount ?? 0
    : nedoRecipients.length;
  const showMetric = (value: number) => dataMode === "loading" && !value && !summaryAggregate ? "明細読込中" : compactYen(value);
  const sourceCoverage: Record<string, string> = {
    "review-sheets": formatCoverageYears(coverage.reviewPayments.fiscalYears),
    gbiz: formatCoverageYears(coverage.gbiz.fiscalYears),
    nedo: formatCoverageYears(coverage.nedo.fiscalYears),
  };

  function changeView(nextView: View) {
    setView(nextView);
    setAgency("all");
    setStage("all");
    setYear(comparisonYear || "all");
    setFlowLevel("recipient");
    setPage(0);
  }

  function clearFilters() {
    setQuery("");
    setAgency("all");
    setStage("all");
    setYear(comparisonYear || "all");
    setFlowLevel("recipient");
    setPage(0);
  }

  function changeComparisonYear(nextYear: string) {
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
          <a href="#records">受取先と金額</a>
          <a href="#sources">データソース</a>
          <a href="#about">集計上の注意</a>
        </nav>
        <span className="update-chip"><i />{
          dataMode === "github" ? "GitHub日次更新" : dataMode === "loading" ? "全件データ読込中" : "データ取得要確認"
        }</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">PUBLIC MONEY EXPLORER</p>
          <h1>事業者等への<br /><em>交付金額(経産省)</em></h1>
          <p className="hero-lead">
            行政事業レビューを事業・予算・執行の土台にし、GビズINFOとNEDOの一次データを接続。
            経産省から実施機関への上流資金と、その先の受取先への資金を分けて表示します。
          </p>
          <div className="hero-note">
            <span>最終データ取得</span>
            <strong>{formatUpdated(dataset.generatedAt)}</strong>
            <span className="source-count">{dataset.sources.length}ソース監視中</span>
          </div>
        </div>

        <aside className="flow-card" aria-label="NEDO経由の資金経路">
          <div className="flow-card-head">
            <span>レビューシート上の資金経路</span>
            <span className="live-dot">SEPARATED</span>
          </div>
          <div className="flow-path">
            <div className="flow-node ministry"><span>上流</span><strong>経済産業省</strong></div>
            <div className="flow-line"><span>運営費交付・基金等</span></div>
            <div className="flow-node agency"><span>実施機関</span><strong>NEDO</strong></div>
            <div className="flow-line"><span>委託・助成等</span></div>
            <div className="flow-node company"><span>公表経路上の受取先</span><strong>{nedoRecipientCount.toLocaleString("ja-JP")}件</strong></div>
          </div>
          <div className="flow-total">
            <span>{paymentYear || "—"}年度 支出先額</span>
            <strong>{showMetric(nedoRecipientTotal)}</strong>
          </div>
          <p>NEDOへの上流額はこの金額に足していません。経路が公表されている範囲の集計です。</p>
        </aside>
      </section>

      <section className="coverage-panel" aria-label="データ収録期間と比較年度">
        <div className="coverage-copy">
          <p className="eyebrow">PERIOD-ALIGNED VIEW</p>
          <h2>同じ年度だけで比べる</h2>
          <p>データ源ごとに公開期間が違うため、主要な金額は共通して収録されている年度にそろえています。</p>
        </div>
        <label className="comparison-year">
          <span>現在の比較年度</span>
          <select value={String(comparisonFiscalYear || "")} onChange={(event) => changeComparisonYear(event.target.value)}>
            {coverage.commonFiscalYears.slice().reverse().map((item) => (
              <option key={item} value={item}>{item}年度</option>
            ))}
          </select>
          <small>実支出とGビズINFOの共通年度</small>
        </label>
        <div className="coverage-grid">
          <article>
            <span>実支出先</span>
            <strong>{formatCoverageYears(coverage.reviewPayments.fiscalYears)}</strong>
            <small>行政事業レビュー公式CSV</small>
          </article>
          <article>
            <span>契約・補助金</span>
            <strong>{formatCoverageYears(coverage.gbiz.fiscalYears)}</strong>
            <small>GビズINFO収録レコード</small>
          </article>
          <article>
            <span>NEDO契約</span>
            <strong>{formatCoverageYears(coverage.nedo.fiscalYears)}</strong>
            <small>公開中の月次CSVのみ</small>
          </article>
          <article className="coverage-caution">
            <span>移行レビューシート</span>
            <strong>{coverage.migratedReviewSheetYears[0]}–{coverage.migratedReviewSheetYears.at(-1)}年度</strong>
            <small>支出先詳細不足のため全件集計外</small>
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
          <p>実支出、契約・補助金、予算事業を切り替えて確認できます。異なる系列の金額は合算しません。</p>
        </div>

        <div className="view-tabs" role="tablist" aria-label="表示するデータ">
          <button role="tab" aria-selected={view === "payments"} onClick={() => changeView("payments")}>
            実支出先 <small>行政事業レビュー</small>
          </button>
          <button role="tab" aria-selected={view === "commitments"} onClick={() => changeView("commitments")}>
            契約・補助金 <small>GビズINFO / NEDO</small>
          </button>
          <button role="tab" aria-selected={view === "programs"} onClick={() => changeView("programs")}>
            予算・執行 <small>レビューシート事業</small>
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
            <select value={year} onChange={(event) => { setYear(event.target.value); setPage(0); }}>
              <option value="all">全期間（収録範囲が異なります）</option>
              {fiscalYears.map((item) => <option key={item} value={item}>{item}年度</option>)}
            </select>
          </label>
        </div>

        <div className="result-bar">
          <span>
            <strong>{activeRows.length.toLocaleString("ja-JP")}</strong>件
            {activeRows.length > pageSize && `（${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}件を表示）`}
            {filteredAmount !== null && <b>・選択系列 {compactYen(filteredAmount)}</b>}
          </span>
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
              <strong>{dataMode === "loading" ? "明細データを読み込んでいます" : "該当するレコードがありません"}</strong>
              <span>{dataMode === "loading" ? "集計値と収録期間は先に確認できます。" : "検索語や条件を変えてください。"}</span>
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
          <div><p className="eyebrow">DATA PIPELINE</p><h2>データソースの更新状況</h2></div>
          <p>毎日自動確認し、取得失敗時は前回データを保持したまま状態を明示します。</p>
        </div>
        <div className="source-grid">
          {dataset.sources.map((source) => (
            <article key={source.id}>
              <div><span className={`health ${source.status}`} />{source.name}</div>
              <strong>{source.recordCount.toLocaleString("ja-JP")}件</strong>
              <dl>
                <div><dt>取得方式</dt><dd>{source.method}</dd></div>
                <div><dt>更新周期</dt><dd>{source.frequency}</dd></div>
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
            行政事業レビューの支出先額、事業執行額、GビズINFO等の契約・補助金掲載額は別系列です。
            また、経産省からNEDO等への金額と、そこから先の受取先への金額も分けています。
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
        <p>公開情報ベースの非公式プロトタイプ</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
