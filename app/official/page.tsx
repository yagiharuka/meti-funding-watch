import type { Metadata } from "next";

import ViewTabs from "@/app/ViewTabs";
import OfficialSearch from "@/app/official/OfficialSearch";
import officialManifest from "@/data/official/manifest.json";
import sourceRegistry from "@/data/official-source-registry.json";

export const metadata: Metadata = {
  title: "公式契約結果・補助金交付決定",
  description: "経済産業省関係機関の公式契約結果と補助金等の交付決定を、収録範囲を限定して明細検索できます。",
};

const registry = sourceRegistry;
const manifest = officialManifest;

type SourceFailure = {
  id: string;
  executorId: string;
  fiscalYear: number;
  kind: string;
  sourcePageUrl: string;
  reasonCode: "empty_response" | "fetch_failed" | "parse_failed" | "evidence_mismatch";
};

type FallbackFailureReason = SourceFailure["reasonCode"] | "transient_http";

type SourceDocument = (typeof manifest.sourceDocuments)[number] & {
  primaryUrl?: string;
  transportUrl?: string;
  fallbackUsed?: boolean;
  carryForwardUsed?: boolean;
  primaryFailureReasonCode?: FallbackFailureReason | null;
  lastSuccessfulRetrievedAt?: string | null;
  attemptedAt?: string | null;
};

export default function OfficialSourcesPage() {
  const coverage = manifest.coverage as typeof manifest.coverage & {
    fiscalYears?: number[];
    sourceDocumentCount?: number;
    attemptedSourceDocumentCount?: number;
    failedSourceDocumentCount?: number;
    fallbackSourceDocumentCount?: number;
    carryForwardSourceDocumentCount?: number;
  };
  const sourceFailures = ((manifest as typeof manifest & { sourceFailures?: SourceFailure[] }).sourceFailures ?? []);
  const sourceDocuments = manifest.sourceDocuments as SourceDocument[];
  const fallbackSources = sourceDocuments.filter((source) => source.fallbackUsed);
  const carryForwardSources = sourceDocuments.filter((source) => source.carryForwardUsed);
  const executorCoverage = Object.values(manifest.coverage.executors);
  const searchableExecutorNames = executorCoverage.map((item) => item.name);
  const searchableSeriesCells = executorCoverage.reduce((sum, item) => sum
    + Number(item.contractResults.records > 0)
    + Number(item.grantDecisions.records > 0), 0);
  const executorRecordSummary = executorCoverage.map((item) => {
    const records = item.contractResults.records + item.grantDecisions.records;
    return `${item.name}${records.toLocaleString("ja-JP")}行`;
  }).join("、");
  const years = coverage.fiscalYears ?? [...new Set(Object.values(manifest.coverage.executors).flatMap((item) => item.fiscalYears))].sort();
  const yearList = `${years.join("・")}年度`;
  const attemptedYears = [...new Set([
    ...sourceDocuments.map((source) => source.fiscalYear),
    ...sourceFailures.map((failure) => failure.fiscalYear),
  ])].sort();
  const missingYears = attemptedYears.filter((year) => !years.includes(year));
  const attemptedSourceCount = coverage.attemptedSourceDocumentCount
    ?? (coverage.sourceDocumentCount ?? sourceDocuments.length) + sourceFailures.length;
  const verifiedSourceCount = coverage.sourceDocumentCount ?? sourceDocuments.length;
  const failedSourceCount = coverage.failedSourceDocumentCount ?? sourceFailures.length;
  const fallbackSourceCount = coverage.fallbackSourceDocumentCount ?? fallbackSources.length;
  const carryForwardSourceCount = coverage.carryForwardSourceDocumentCount ?? carryForwardSources.length;
  if (fallbackSourceCount !== fallbackSources.length) throw new Error("公式資料manifestのWARP代替取得件数が一致しません");
  if (carryForwardSourceCount !== carryForwardSources.length) throw new Error("公式資料manifestの前回明細継続件数が一致しません");
  if (sourceDocuments.some((source) => source.fallbackUsed && source.carryForwardUsed)) throw new Error("公式資料manifestの代替取得状態が重複しています");
  const currentVerifiedSourceCount = verifiedSourceCount - carryForwardSourceCount;
  if (currentVerifiedSourceCount < 0) throw new Error("公式資料manifestの今回検証件数が不正です");
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="../" aria-label="経産省関係の調達（委託を含む）・補助金情報 トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省関係の調達（委託を含む）・補助金情報</span>
        </a>
      </header>

      <ViewTabs active="official" />

      <section className="official-hero" id="top" aria-labelledby="official-title">
        <p className="eyebrow">DIRECT OFFICIAL SOURCES</p>
        <h1 id="official-title">公式契約結果・補助金交付決定</h1>
        <p className="official-lead">
          公式資料に掲載された直接契約と補助金等の交付決定を、交付先・契約相手、法人番号、事業名から検索できます。
          現在の検索収録は{searchableExecutorNames.join("・")}の公表資料の一部です。
          収録年度は機関・系列ごとに異なり、全体では{yearList}です。
        </p>
        <p className="official-warning">
          契約額と交付決定額は段階が異なり、いずれも実支払額ではありません。
          GビズINFOの掲載値とも合算しません。再委託先、間接補助先、基金・所管法人からの下流支出は、この一覧では網羅しません。
        </p>
      </section>

      <aside className="official-ingestion-summary" aria-labelledby="official-ingestion-title">
        <strong id="official-ingestion-title">部分収録：登録資料 {attemptedSourceCount}件のうち、検索に使用する資料 {verifiedSourceCount}件</strong>
        <span>
          今回取得・検証 {currentVerifiedSourceCount}件／前回検証済み明細を継続 {carryForwardSourceCount}件／未取得候補 {failedSourceCount}件／全年度・全区分を完全照合済み {registry.collectionStatus.fullyReconciledCells}/{registry.collectionStatus.registeredEndpoints}系列。
          {fallbackSourceCount > 0 && ` ライブ取得に失敗し、前回公開明細との完全一致を検証したWARP保存資料を使用 ${fallbackSourceCount}件。`}
          {missingYears.length > 0 && `${missingYears.join("・")}年度の検索明細は現在ありません。`}
        </span>
        <small>日次更新は登録済みURLを再取得します。新年度・新URL・新機関は自動発見せず、確認・検証後に追加します。</small>
      </aside>

      <OfficialSearch />

      <section className="official-section" aria-labelledby="meaning-title">
        <div className="section-heading compact">
          <div><p className="eyebrow">WHAT EACH SOURCE SHOWS</p><h2 id="meaning-title">3系列の違い</h2></div>
          <p>同じ法人名や事業名があっても、自動で同一案件にまとめません。</p>
        </div>
        <div className="population-matrix" role="region" aria-label="データ系列ごとの収録範囲">
          <table>
            <caption className="sr-only">GビズINFO、公式契約結果、補助金交付決定の違い</caption>
            <thead><tr><th scope="col">系列</th><th scope="col">このサイトでの状態</th><th scope="col">金額の段階</th><th scope="col">実支払・下流</th></tr></thead>
            <tbody>
              <tr><th scope="row">GビズINFO</th><td><span className="coverage-badge ready">○ 明細を検索可</span></td><td>GビズINFO掲載値</td><td><span className="coverage-badge no">× 判定不可</span></td></tr>
              <tr><th scope="row">公式契約結果</th><td><span className="coverage-badge partial">△ {manifest.seriesCounts.contract_result}掲載行を検索可</span></td><td>契約額欄の掲載値</td><td><span className="coverage-badge no">× 実支払・再委託なし</span></td></tr>
              <tr><th scope="row">補助金等の交付決定</th><td><span className="coverage-badge partial">△ {manifest.seriesCounts.grant_decision}掲載行を検索可</span></td><td>交付決定額欄の掲載値</td><td><span className="coverage-badge no">× 確定・支払・間接補助なし</span></td></tr>
            </tbody>
          </table>
        </div>
        <p className="catalog-status" role="status">
          <strong>現在の収録状態：</strong>
          公式入口リンク {registry.collectionStatus.registeredEndpoints}件（明細収録の分母ではありません）／
          一部でも明細検索できる系列 {searchableSeriesCells}/{registry.collectionStatus.registeredEndpoints}／
          全年度・全公表区分を完全照合した系列 {registry.collectionStatus.fullyReconciledCells}/{registry.collectionStatus.registeredEndpoints}。
          検索可能な公式資料明細は {manifest.recordCount}掲載行です。
          検索収録は{coverage.executorCount}機関・{yearList}の{verifiedSourceCount}公式資料です。リンクだけの資料は収録済みと数えていません。
        </p>
        {sourceFailures.length > 0 && (
          <details className="official-source-failures">
            <summary>取得・形式検証できず未収録の登録資料：{sourceFailures.length}件</summary>
            <p>失敗した新規候補を0件資料とは扱わず、検索対象から外しています。前回公開済み資料の再検証に失敗した場合は、公式明細全体の更新を停止します。</p>
            <ul>
              {sourceFailures.map((failure) => {
                const executorName = registry.executors.find((item) => item.id === failure.executorId)?.name ?? failure.executorId;
                return (
                  <li key={failure.id}>
                    <a href={failure.sourcePageUrl} target="_blank" rel="noreferrer">{executorName}・{failure.fiscalYear}年度・{failure.kind} ↗</a>
                    <span>{sourceFailureLabel(failure.reasonCode)}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {fallbackSources.length > 0 && (
          <details className="official-source-failures">
            <summary>ライブ取得失敗後に検証済みWARP保存資料を使用：{fallbackSources.length}件</summary>
            <p>ライブURLは日次更新で再試行します。WARP保存資料は、取得バイト・SHA-256・明細数と、前回公開した全明細の内容・識別子が一致した場合だけ使用します。</p>
            <ul>
              {fallbackSources.map((source) => (
                <li key={source.id}>
                  <a href={source.primaryUrl ?? source.originalUrl} target="_blank" rel="noreferrer">{executorName(source.executorId)}・{source.fiscalYear}年度・{source.kind}（ライブURL）↗</a>
                  <span>{fallbackFailureLabel(source.primaryFailureReasonCode)}／WARP保存資料で明細を維持</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {carryForwardSources.length > 0 && (
          <details className="official-source-failures">
            <summary>ライブ取得失敗後に前回検証済み明細を継続使用：{carryForwardSources.length}件</summary>
            <p>今回のライブ取得は完了していません。前回公開manifestと明細ファイルのハッシュ・行数、資料ID・原本URL・資料別明細数を再検証し、前回の明細を変更せず掲載しています。新しい内容を取得済みとは扱いません。</p>
            <ul>
              {carryForwardSources.map((source) => (
                <li key={source.id}>
                  <a href={source.primaryUrl ?? source.originalUrl} target="_blank" rel="noreferrer">{executorName(source.executorId)}・{source.fiscalYear}年度・{source.kind}（ライブURL）↗</a>
                  <span>{fallbackFailureLabel(source.primaryFailureReasonCode)}／最終正常取得 {formatJapaneseTimestamp(source.lastSuccessfulRetrievedAt)}／前回明細を継続</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="official-section official-catalog" aria-labelledby="catalog-title">
        <div className="section-heading compact">
          <div><p className="eyebrow">SOURCE CATALOG</p><h2 id="catalog-title">執行機関別の公式入口</h2></div>
          <p>基準日：{registry.asOf}。公式ページの掲載期間やファイル形式は機関・年度ごとに異なります。</p>
        </div>
        <div className="official-source-table" role="region" aria-label="執行機関別の契約結果と交付決定の公式資料" tabIndex={0}>
          <table>
            <caption className="sr-only">13執行機関の契約結果と補助金等交付決定の公式入口</caption>
            <thead><tr><th scope="col">執行機関</th><th scope="col">契約結果</th><th scope="col">補助金等の交付決定</th><th scope="col">検索収録</th></tr></thead>
            <tbody>
              {registry.executors.map((executor) => (
                <tr key={executor.id}>
                  <th scope="row" data-label="執行機関">{executor.name}</th>
                  <td data-label="契約結果"><a className="source-link" href={executor.contracts} target="_blank" rel="noreferrer" aria-label={`${executor.name}の契約結果を新しいタブで開く`}>公式契約結果 ↗</a><small>金額段階：契約額</small></td>
                  <td data-label="補助金等の交付決定"><a className="source-link" href={executor.grantDecisions} target="_blank" rel="noreferrer" aria-label={`${executor.name}の補助金等交付決定を新しいタブで開く`}>公式交付決定 ↗</a><small>金額段階：交付決定額</small></td>
                  <td data-label="検索収録">{executor.id in manifest.coverage.executors ? (() => {
                    const detail = manifest.coverage.executors[executor.id as keyof typeof manifest.coverage.executors];
                    return <>
                      <span className="coverage-badge ready">契約 {detail.contractResults.records > 0 ? `${detail.contractResults.records.toLocaleString("ja-JP")}行` : "未収録"}</span>
                      <small>交付決定 {detail.grantDecisions.records > 0 ? `${detail.grantDecisions.records.toLocaleString("ja-JP")}行` : "未収録"}</small>
                      <small>年度：{detail.fiscalYears.join("・")}</small>
                    </>;
                  })() : <span className="coverage-badge partial">契約・交付決定とも明細未収録</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="official-limitations">
          <article><strong>契約結果の分母</strong><p>{registry.series.contracts.population}。{registry.series.contracts.notIncluded}は含みません。</p></article>
          <article><strong>交付決定の分母</strong><p>{registry.series.grantDecisions.population}。{registry.series.grantDecisions.notIncluded}は含みません。</p></article>
          <article><strong>検索できる明細</strong><p>現在は{executorRecordSummary}です。機関・年度・契約区分を画面上で限定し、未収録資料はそのまま残します。{years.includes(2026) && "FY2026は年度途中で、完了年度の件数ではありません。"}</p></article>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>公式契約結果・補助金交付決定</span></div>
        <p>公式資料を取得・整形した非公式検索サイトです。検索明細の収録範囲は各行に明示します。</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}

function sourceFailureLabel(reason: SourceFailure["reasonCode"]) {
  if (reason === "empty_response") return "0バイト応答のため未収録";
  if (reason === "evidence_mismatch") return "検証済みreceiptと一致しないため未収録";
  if (reason === "parse_failed") return "形式を検証できないため未収録";
  return "取得できないため未収録";
}

function executorName(executorId: string) {
  return registry.executors.find((item) => item.id === executorId)?.name ?? executorId;
}

function fallbackFailureLabel(reason: FallbackFailureReason | null | undefined) {
  if (reason === "empty_response") return "ライブURLが0バイト応答";
  if (reason === "transient_http") return "ライブURLが一時的なHTTPエラー";
  return "ライブURLの取得に失敗";
}

function formatJapaneseTimestamp(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
