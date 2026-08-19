"use client";

import { useEffect, useMemo, useState } from "react";
import nedoSupplementData from "@/data/nedo-supplements.json";

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
  amountKnownTotal: number;
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
type NedoSupplement = {
  organization: string;
  corporateNumber: string;
  program: string;
  theme: string;
  phase: string;
  supportYears: string;
  grantDecisionAmount: number;
  sourceUrl: string;
};

type Props = { query: string };

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const nedo = nedoSupplementData as { schemaVersion: number; updatedAt: string; scopeNote: string; records: NedoSupplement[] };

function normalize(value = "") {
  return String(value).normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　]+/g, " ").trim();
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
function getPublicBaseUrl() {
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".chatgpt.site")) {
    return "https://yagiharuka.github.io/meti-funding-watch/";
  }
  return typeof window === "undefined" ? "" : new URL("./", window.location.href).href;
}

export default function CombinedCompanyResults({ query }: Props) {
  const [index, setIndex] = useState<ReviewCompanyIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = normalize(query);
  const terms = useMemo(() => normalizedQuery.split(" ").filter(Boolean), [normalizedQuery]);

  useEffect(() => {
    if (!normalizedQuery || index || loading) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
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
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [normalizedQuery, index, loading]);

  const reviewMatches = useMemo(() => {
    if (!index || !terms.length) return [] as ReviewRecipient[];
    return index.recipients.filter((recipient) => terms.every((term) => recipient.searchText.includes(term)));
  }, [index, terms]);

  const matchedCorporateNumbers = useMemo(() => new Set(reviewMatches.map((row) => row.corporateNumber).filter(Boolean)), [reviewMatches]);
  const nedoMatches = useMemo(() => {
    if (!terms.length) return [] as NedoSupplement[];
    return nedo.records.filter((row) => {
      if (matchedCorporateNumbers.has(row.corporateNumber)) return true;
      const haystack = normalize(`${row.organization} ${row.corporateNumber} ${row.program} ${row.theme}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [terms, matchedCorporateNumbers]);

  if (!normalizedQuery) return null;

  const entries = reviewMatches.flatMap((recipient) => recipient.entries.map((entry) => ({ recipient, entry })))
    .sort((a, b) => b.entry.reviewSheetYear - a.entry.reviewSheetYear || (b.entry.amount ?? -1) - (a.entry.amount ?? -1));
  const reviewAmountKnownTotal = reviewMatches.reduce((sum, row) => sum + row.amountKnownTotal, 0);
  const reviewAmountKnownCount = reviewMatches.reduce((sum, row) => sum + row.amountKnownCount, 0);
  const reviewAmountUnknownCount = reviewMatches.reduce((sum, row) => sum + row.amountUnknownCount, 0);

  return (
    <section aria-labelledby="combined-company-review-title" style={{ marginTop: "1.25rem", marginBottom: "1.25rem" }}>
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">SAME COMPANY / DIFFERENT SERIES</p>
          <h2 id="combined-company-review-title">行政事業レビューも同じ企業名で検索</h2>
        </div>
        <p>GビズINFOとは別系列です。レビュー掲載の支出先額・NEDOの交付決定額・GビズINFO掲載値は性質が違うため合算しません。</p>
      </div>
      <p className="filter-note">企業名・法人番号の検索語だけを共通利用します。上部の公表組織・情報種別・年度フィルターはGビズINFO側だけに適用され、行政事業レビューには適用しません。</p>

      {loading && <div className="result-bar"><strong>行政事業レビューの企業索引を読込中</strong></div>}
      {error && <div className="adoption-error" role="alert"><strong>行政事業レビューを同時検索できません。</strong><p>{error}</p></div>}

      {!loading && !error && index && (
        <>
          <p className="filter-note">行政事業レビューの現在の同時検索対象は {index.reviewSheetYears.join("・")}年度シートです。旧年度は公表形式・取得経路が異なるため、現時点では同時検索に含めていません。</p>
          <div className="records-table" role="region" aria-label="行政事業レビュー企業検索サマリー" tabIndex={0} style={{ marginBottom: "1rem" }}>
            <table>
              <caption style={{ textAlign: "left", padding: "1rem", fontWeight: 700 }}>行政事業レビュー：同じ企業検索の結果</caption>
              <thead><tr><th>対象法人</th><th>支出先明細</th><th>金額記載あり</th><th>金額記載行の単純合計</th></tr></thead>
              <tbody><tr>
                <td><strong>{reviewMatches.length.toLocaleString("ja-JP")}法人</strong><small>名称・法人番号で一致</small></td>
                <td>{entries.length.toLocaleString("ja-JP")}行</td>
                <td>{reviewAmountKnownCount.toLocaleString("ja-JP")}行<small>{reviewAmountUnknownCount ? `／金額欄なし ${reviewAmountUnknownCount.toLocaleString("ja-JP")}行` : ""}</small></td>
                <td className="amount"><strong>{yen.format(reviewAmountKnownTotal)}</strong><small>企業検索用に同一事業・同一支出ブロックの重複行を整理した掲載値の単純合計。総支出額とは扱わず、GビズINFOとも合算しません。</small></td>
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

          {nedoMatches.length > 0 && (
            <div className="records-table" role="region" aria-label="NEDO公式の採択・交付決定情報" tabIndex={0}>
              <table>
                <caption style={{ textAlign: "left", padding: "1rem", fontWeight: 700 }}>NEDO公式補足（確認できた採択・交付決定情報）</caption>
                <thead><tr><th>採択先</th><th>事業・テーマ</th><th>フェーズ・期間</th><th>NEDO交付決定額</th><th>原典</th></tr></thead>
                <tbody>{nedoMatches.map((row) => <tr key={`${row.corporateNumber}-${row.theme}`}>
                  <td data-label="採択先"><strong>{row.organization}</strong><small>{row.corporateNumber}</small></td>
                  <td data-label="事業・テーマ"><span className="program-name">{row.theme}</span><small>{row.program}</small></td>
                  <td data-label="フェーズ・期間">{row.phase}<small>{row.supportYears}</small></td>
                  <td className="amount" data-label="NEDO交付決定額"><strong>{yen.format(row.grantDecisionAmount)}</strong><small>年度支出額ではありません。レビュー・GビズINFOと合算不可。</small></td>
                  <td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">NEDO公式 ↗</a></td>
                </tr>)}</tbody>
              </table>
              <p className="filter-note">{nedo.scopeNote}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
