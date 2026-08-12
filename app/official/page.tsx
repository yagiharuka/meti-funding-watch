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
  reasonCode: "empty_response" | "fetch_failed" | "parse_failed";
};

export default function OfficialSourcesPage() {
  const coverage = manifest.coverage as typeof manifest.coverage & { fiscalYears?: number[]; sourceDocumentCount?: number };
  const sourceFailures = ((manifest as typeof manifest & { sourceFailures?: SourceFailure[] }).sourceFailures ?? []);
  const smeaRecordCount = manifest.coverage.executors.smea.contractResults.records + manifest.coverage.executors.smea.grantDecisions.records;
  const jpoRecordCount = manifest.coverage.executors.jpo.contractResults.records + manifest.coverage.executors.jpo.grantDecisions.records;
  const years = coverage.fiscalYears ?? [...new Set(Object.values(manifest.coverage.executors).flatMap((item) => item.fiscalYears))].sort();
  const yearRange = years.length === 1 ? `${years[0]}年度` : `${years[0]}～${years[years.length - 1]}年度`;
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
          現在の検索収録は中小企業庁・特許庁の{yearRange}に公表された資料の一部です。
        </p>
        <p className="official-warning">
          契約額と交付決定額は段階が異なり、いずれも実支払額ではありません。
          GビズINFOの掲載値とも合算しません。再委託先、間接補助先、基金・所管法人からの下流支出は、この一覧では網羅しません。
        </p>
      </section>

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
          公式入口 {registry.collectionStatus.registeredEndpoints}/{registry.collectionStatus.registeredEndpoints}系列を登録／
          一部でも明細検索できる系列 {registry.collectionStatus.searchableSeriesCells}/{registry.collectionStatus.registeredEndpoints}／
          全年度・全公表区分を完全照合した系列 {registry.collectionStatus.fullyReconciledCells}/{registry.collectionStatus.registeredEndpoints}。
          検索可能な公式資料明細は {manifest.recordCount}掲載行です。
          検索収録は2機関・{yearRange}の{coverage.sourceDocumentCount ?? manifest.sourceDocuments.length}公式資料です。リンクだけの資料は収録済みと数えていません。
        </p>
        {sourceFailures.length > 0 && (
          <details className="official-source-failures">
            <summary>取得・形式検証できず未収録の候補資料：{sourceFailures.length}件</summary>
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
                  <td data-label="検索収録">{executor.id in manifest.coverage.executors ? (
                    <span className="coverage-badge ready">
                      {(manifest.coverage.executors[executor.id as keyof typeof manifest.coverage.executors].contractResults.records
                        + manifest.coverage.executors[executor.id as keyof typeof manifest.coverage.executors].grantDecisions.records).toLocaleString("ja-JP")}掲載行
                    </span>
                  ) : <span className="coverage-badge partial">明細未収録</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="official-limitations">
          <article><strong>契約結果の分母</strong><p>{registry.series.contracts.population}。{registry.series.contracts.notIncluded}は含みません。</p></article>
          <article><strong>交付決定の分母</strong><p>{registry.series.grantDecisions.population}。{registry.series.grantDecisions.notIncluded}は含みません。</p></article>
          <article><strong>検索できる明細</strong><p>現在は中小企業庁{smeaRecordCount.toLocaleString("ja-JP")}行、特許庁{jpoRecordCount.toLocaleString("ja-JP")}行です。機関・年度・契約区分を画面上で限定し、未収録資料はそのまま残します。</p></article>
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
  if (reason === "parse_failed") return "形式を検証できないため未収録";
  return "取得できないため未収録";
}
