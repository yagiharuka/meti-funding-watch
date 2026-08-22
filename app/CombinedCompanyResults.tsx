"use client";

import { useEffect, useMemo, useState } from "react";
import officialSupplementData from "@/data/official-supplement-index.json";
import { filterCompanyEntities } from "@/scripts/company-search.mjs";

type ReviewEntry = {
  id: string;
  reviewSheetYear: number;
  reviewProjectId: string;
  program: string;
  amount: number | null;
  amountRaw: string;
  amountStatus: string;
  sourceAgency: string | null;
  route: string[] | null;
  block: string;
  sourceUrl: string;
  sourceRowNumber: number | null;
  flowLevel: string;
};
type ReviewRecipient = {
  organization: string;
  corporateNumber: string;
  aliases: string[];
  searchText: string;
  entryCount: number;
  amountKnownCount: number;
  amountUnknownCount: number;
  entries: ReviewEntry[];
};
type ReviewCompanyIndex = {
  schemaVersion: 1;
  generatedAt: string;
  reviewSheetYears: number[];
  recipientCount: number;
  semantics: { amount: string; aggregationWarning: string };
  recipients: ReviewRecipient[];
};
type OfficialSupplementSource = {
  id: "meti" | "nedo" | "smrj";
  name: string;
  coverageNote: string;
  recordCount: number;
};
type OfficialSupplementRecord = {
  id: string;
  sourceId: "meti" | "nedo" | "smrj";
  sourceName: string;
  organization: string;
  corporateNumber: string;
  fiscalYear: number;
  date: string | null;
  program: string;
  theme: string;
  phase: string;
  supportYears: string;
  category: "grant_decision" | "contract_result";
  amountStage: string;
  amount: number;
  sourceUrl: string;
  sourcePageUrl: string;
  sourceKey: string;
  searchText: string;
};
type OfficialSupplementIndex = {
  schemaVersion: 1;
  generatedAt: string;
  minFiscalYear: number;
  scopeNote: string;
  recordCount: number;
  sources: OfficialSupplementSource[];
  records: OfficialSupplementRecord[];
};
type Props = { query: string };

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const officialIndex = officialSupplementData as OfficialSupplementIndex;

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/g, "株式会社")
    .replace(/\(有\)|㈲/g, "有限会社")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s　]+/g, " ")
    .trim();
}
function routeLabel(row: ReviewEntry) {
  if (row.route?.length) return row.route.join(" → ");
  if (row.sourceAgency) return `${row.sourceAgency} → ${row.block}`;
  return "支出経路の記載なし";
}
function displayReviewAmount(row: ReviewEntry) {
  if (row.amount !== null) return yen.format(row.amount);
  return row.amountRaw?.trim() ? `原文：${row.amountRaw}` : "金額欄なし";
}
function formatDate(value: string | null) {
  if (!value) return "日付記載なし";
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}
function getPublicBaseUrl() {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".chatgpt.site")) {
    return "https://yagiharuka.github.io/meti-funding-watch/";
  }
  return typeof window === "undefined" ? "" : new URL("./", window.location.href).href;
}

export default function CombinedCompanyResults({ query }: Props) {
  const [index, setIndex] = useState<ReviewCompanyIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = normalize(query);
  const loading = Boolean(normalizedQuery && !index && !error);

  useEffect(() => {
    if (!normalizedQuery || index || error) return;
    let active = true;
    const controller = new AbortController();
    const indexUrl = new URL("data/review-company-index.json", getPublicBaseUrl());
    fetch(indexUrl, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`行政事業レビュー企業索引を取得できません（HTTP ${response.status}）`);
        return response.json() as Promise<ReviewCompanyIndex>;
      })
      .then((value) => {
        if (value.schemaVersion !== 1 || !Array.isArray(value.recipients)) throw new Error("行政事業レビュー企業索引の形式が不正です");
        if (active) { setIndex(value); setError(null); }
      })
      .catch((reason) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; controller.abort(); };
  }, [normalizedQuery, index, error]);

  const reviewMatches = useMemo(() => {
    if (!index || !normalizedQuery) return [] as ReviewRecipient[];
    return filterCompanyEntities(index.recipients, normalizedQuery) as ReviewRecipient[];
  }, [index, normalizedQuery]);
  const matchedCorporateNumbers = useMemo(
    () => new Set(reviewMatches.map((row) => row.corporateNumber).filter(Boolean)),
    [reviewMatches],
  );
  const officialMatches = useMemo(() => {
    if (!normalizedQuery) return [] as OfficialSupplementRecord[];
    const directMatches = filterCompanyEntities(officialIndex.records, normalizedQuery) as OfficialSupplementRecord[];
    const directIds = new Set(directMatches.map((row) => row.id));
    return officialIndex.records.filter((row) =>
      directIds.has(row.id)
      || Boolean(row.corporateNumber && matchedCorporateNumbers.has(row.corporateNumber)));
  }, [normalizedQuery, matchedCorporateNumbers]);

  if (!normalizedQuery) return null;

  const entries = reviewMatches.flatMap((recipient) => recipient.entries.map((entry) => ({ recipient, entry })))
    .sort((a, b) => b.entry.reviewSheetYear - a.entry.reviewSheetYear || (b.entry.amount ?? -1) - (a.entry.amount ?? -1));
  const reviewAmountKnownCount = reviewMatches.reduce((sum, row) => sum + row.amountKnownCount, 0);
  const reviewAmountUnknownCount = reviewMatches.reduce((sum, row) => sum + row.amountUnknownCount, 0);

  return (
    <section aria-labelledby="combined-company-review-title" style={{ marginTop: "1.25rem", marginBottom: "1.25rem" }}>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">SAME COMPANY / DIFFERENT SERIES</p>
          <h2 id="combined-company-review-title">同じ企業を行政事業レビュー・公式補足でも確認</h2>
        </div>
        <p>GビズINFO、行政事業レビュー、公式補足は金額の意味や時点が違うため、相互に合算しません。行政事業レビュー内でも掲載行をまたぐ金額合計は表示しません。</p>
      </div>
      <p className="filter-note">企業名・法人番号の検索語だけを共通利用します。完全一致する法人名があればそれを優先し、完全一致がない場合だけ名称の部分一致を使います。上部の公表組織・情報種別・年度フィルターはGビズINFO側だけに適用されます。</p>

      {loading && <div className="result-bar"><strong>行政事業レビューの企業索引を読込中</strong></div>}
      {error && <div className="adoption-error" role="alert"><strong>行政事業レビューを同時検索できません。</strong><p>{error}</p></div>}

      {!loading && !error && index && (
        <>
          <p className="filter-note">行政事業レビューの現在の同時検索対象は {index.reviewSheetYears.join("・")}年度シートです。旧年度は公表形式・取得経路が異なるため、現時点では同時検索に含めていません。</p>
          <p className="filter-note">{index.semantics.aggregationWarning}</p>
          <div className="records-table" role="region" aria-label="行政事業レビュー企業検索サマリー" tabIndex={0} style={{ marginBottom: "1rem" }}>
            <table>
              <caption style={{ textAlign: "left", padding: "1rem", fontWeight: 700 }}>行政事業レビュー：同じ企業検索の結果</caption>
              <thead><tr><th>対象法人</th><th>支出先明細</th><th>金額記載あり</th><th>掲載値</th></tr></thead>
              <tbody><tr>
                <td><strong>{reviewMatches.length.toLocaleString("ja-JP")}法人</strong><small>名称・法人番号で一致</small></td>
                <td>{entries.length.toLocaleString("ja-JP")}行</td>
                <td>{reviewAmountKnownCount.toLocaleString("ja-JP")}行<small>{reviewAmountUnknownCount ? `／金額欄なし ${reviewAmountUnknownCount.toLocaleString("ja-JP")}行` : ""}</small></td>
                <td className="amount"><strong>合計しません</strong><small>個別の掲載額は下の明細で確認</small></td>
              </tr></tbody>
            </table>
          </div>
          {entries.length > 0 ? (
            <div className="records-table" role="region" aria-label="行政事業レビューの支出先明細" tabIndex={0} style={{ marginBottom: "1rem" }}>
              <table>
                <thead><tr><th>支出先</th><th>事業</th><th>レビュー掲載の支出先額</th><th>資金経路</th><th>レビュー年度</th><th>原典</th></tr></thead>
                <tbody>{entries.slice(0, 100).map(({ recipient, entry }) => (
                  <tr key={`${recipient.corporateNumber || recipient.organization}-${entry.id}`}>
                    <td data-label="支出先"><strong>{recipient.organization}</strong><small>{recipient.corporateNumber || "法人番号の記載なし"}</small></td>
                    <td data-label="事業"><span className="program-name">{entry.program}</span></td>
                    <td className="amount" data-label="レビュー掲載の支出先額">{displayReviewAmount(entry)}<small>行政事業レビュー「支出先の合計支出額」</small></td>
                    <td className="review-route" data-label="資金経路"><strong>{routeLabel(entry)}</strong></td>
                    <td data-label="レビュー年度">{entry.reviewSheetYear}年度シート</td>
                    <td data-label="原典"><a className="source-link" href={entry.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a><small>支出先ブロック {entry.block}</small></td>
                  </tr>
                ))}</tbody>
              </table>
              {entries.length > 100 && <p className="filter-note">同時表示は上位100行までです。全明細は「行政事業レビュー詳細」で確認できます。</p>}
            </div>
          ) : <p className="filter-note">現在収録している行政事業レビューでは、この企業名・法人番号に一致する支出先を確認できません。</p>}
        </>
      )}

      <div className="section-heading compact" style={{ marginTop: "1.5rem" }}>
        <div>
          <p className="eyebrow">OFFICIAL SUPPLEMENT</p>
          <h2>公式補足（経産省本省・NEDO・中小機構）</h2>
        </div>
        <p>2021年度以降を基本対象とする採択・交付決定・契約結果を補足します。機関ごとに実際の収録開始年度は異なり、確認できた公表情報だけを表示します。</p>
      </div>
      {officialMatches.length > 0 ? (
        <div className="records-table" role="region" aria-label="公式補足の企業検索結果" tabIndex={0}>
          <table>
            <thead><tr><th>公表機関</th><th>受取先</th><th>事業・テーマ</th><th>公表金額</th><th>時点</th><th>原典</th></tr></thead>
            <tbody>{officialMatches.slice(0, 100).map((row) => (
              <tr key={row.id}>
                <td data-label="公表機関"><strong>{row.sourceName}</strong><small>{row.category === "grant_decision" ? "採択・交付決定" : "契約結果"}</small></td>
                <td data-label="受取先"><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td>
                <td data-label="事業・テーマ"><span className="program-name">{row.theme || row.program}</span>{row.theme && <small>{row.program}</small>}{row.phase && <small>{row.phase}{row.supportYears ? `／${row.supportYears}` : ""}</small>}</td>
                <td className="amount" data-label="公表金額"><strong>{yen.format(row.amount)}</strong><small>{row.amountStage}。GビズINFO・レビューと合算不可。</small></td>
                <td data-label="時点">{formatDate(row.date)}<small>{row.fiscalYear}年度</small></td>
                <td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceName}公式 ↗</a></td>
              </tr>
            ))}</tbody>
          </table>
          {officialMatches.length > 100 && <p className="filter-note">同時表示は上位100行までです。</p>}
        </div>
      ) : <p className="filter-note">現在の公式補足では、この企業名・法人番号に一致する公表情報を確認できません。</p>}
      <p className="filter-note">{officialIndex.scopeNote}</p>
      {officialIndex.sources.map((source) => <p className="filter-note" key={source.id}><strong>{source.name}：</strong>{source.coverageNote}</p>)}
    </section>
  );
}
