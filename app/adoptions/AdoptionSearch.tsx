"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { MIRASAPO_SUBSIDIES } from "@/scripts/mirasapo-search.mjs";

type AdoptionRecord = {
  id: string;
  name: string;
  prefecture: string;
  subsidy: string;
  year: string;
  round: string;
  plan: string;
  sourceUrl: string;
};

type SearchResponse = {
  totalRecords: number;
  totalPages: number;
  page: number;
  pageSize: number;
  retrievedAt: string;
  sourceUrl: string;
  records: AdoptionRecord[];
};

type Criteria = {
  keyword: string;
  prefCode: string;
  subsidyCode: string;
};

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

const EMPTY_CRITERIA: Criteria = { keyword: "", prefCode: "", subsidyCode: "" };

function apiUrl(criteria: Criteria, page: number) {
  const base = typeof window !== "undefined" && window.location.hostname === "yagiharuka.github.io"
    ? "https://meti-funding-watch.haru620328.chatgpt.site/api/adoptions"
    : "/api/adoptions";
  const url = new URL(base, typeof window === "undefined" ? "https://example.invalid" : window.location.href);
  if (criteria.keyword) url.searchParams.set("keyword", criteria.keyword);
  if (criteria.prefCode) url.searchParams.set("prefCode", criteria.prefCode);
  if (criteria.subsidyCode) url.searchParams.set("subsidyCode", criteria.subsidyCode);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function formatRetrievedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "取得時刻不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AdoptionSearch() {
  const [draft, setDraft] = useState<Criteria>(EMPTY_CRITERIA);
  const [criteria, setCriteria] = useState<Criteria>(EMPTY_CRITERIA);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetch(apiUrl(criteria, page), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as SearchResponse & { error?: string };
        if (!response.ok) throw new Error(body.error || "採択者情報を取得できませんでした");
        if (!Array.isArray(body.records) || typeof body.totalRecords !== "number") {
          throw new Error("採択者情報の応答形式が不正です");
        }
        return body;
      })
      .then((body) => {
        if (!active) return;
        setResult(body);
      })
      .catch((reason) => {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setResult(null);
        setError(reason instanceof Error ? reason.message : "採択者情報を取得できませんでした");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [criteria, page, revision]);

  const officialSearchUrl = useMemo(() => {
    if (result?.sourceUrl) return result.sourceUrl;
    const url = new URL("https://mirasapo-connect.go.jp/chusho-subsidies");
    if (criteria.keyword) url.searchParams.set("keyword", criteria.keyword);
    if (criteria.prefCode) url.searchParams.set("prefCode", criteria.prefCode);
    if (criteria.subsidyCode) url.searchParams.set("subsidyCodes", criteria.subsidyCode);
    if (page > 1) url.searchParams.set("page", String(page));
    return url.toString();
  }, [criteria, page, result?.sourceUrl]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setPage(1);
    setCriteria({ ...draft, keyword: draft.keyword.trim() });
    setRevision((value) => value + 1);
  }

  function clear() {
    setLoading(true);
    setError(null);
    setResult(null);
    setDraft(EMPTY_CRITERIA);
    setCriteria(EMPTY_CRITERIA);
    setPage(1);
    setRevision((value) => value + 1);
  }

  function changePage(nextPage: number) {
    setLoading(true);
    setError(null);
    setResult(null);
    setPage(nextPage);
  }

  return (
    <section className="adoption-results" aria-labelledby="adoption-search-title">
      <div className="series-label">
        <strong id="adoption-search-title">補助金採択者情報</strong>
        <span>中小企業庁</span>
      </div>

      <form className="adoption-filters" onSubmit={submit}>
        <label className="adoption-keyword">
          <span>事業者名・事業計画名</span>
          <input
            type="search"
            value={draft.keyword}
            maxLength={20}
            placeholder="キーワード（20文字まで）"
            onChange={(event) => setDraft((current) => ({ ...current, keyword: event.target.value }))}
          />
        </label>
        <label>
          <span>補助金</span>
          <select
            value={draft.subsidyCode}
            onChange={(event) => setDraft((current) => ({ ...current, subsidyCode: event.target.value }))}
          >
            <option value="">すべての補助金</option>
            {MIRASAPO_SUBSIDIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span>都道府県</span>
          <select
            value={draft.prefCode}
            onChange={(event) => setDraft((current) => ({ ...current, prefCode: event.target.value }))}
          >
            <option value="">すべての都道府県</option>
            {PREFECTURES.map((name, index) => (
              <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>
            ))}
          </select>
        </label>
        <button className="adoption-search-button" type="submit" disabled={loading}>検索</button>
      </form>

      <div className="adoption-result-bar" role="status" aria-live="polite">
        <div>
          {loading ? <strong>検索中…</strong> : error ? <strong>取得できませんでした</strong> : (
            <><strong>{result?.totalRecords.toLocaleString("ja-JP") ?? 0}</strong><span> 採択掲載行</span></>
          )}
          {result && !loading && <small>公式検索取得：{formatRetrievedAt(result.retrievedAt)}</small>}
        </div>
        <button type="button" onClick={clear} disabled={loading}>条件をクリア</button>
      </div>

      {error ? (
        <div className="adoption-error" role="alert">
          <strong>{error}</strong>
          <p>公式検索の仕様変更や一時的な障害の場合があります。0件とは扱っていません。</p>
          <a href={officialSearchUrl} target="_blank" rel="noreferrer">同じ条件で公式検索を開く ↗</a>
        </div>
      ) : (
        <div className="adoption-records" aria-busy={loading}>
          {loading ? (
            <div className="empty-state"><strong>公式検索から取得しています</strong><span>しばらくお待ちください。</span></div>
          ) : result?.records.length === 0 ? (
            <div className="empty-state"><strong>該当する掲載行はありません</strong><span>条件を変えて検索してください。</span></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>掲載事業者名</th>
                  <th>都道府県</th>
                  <th>補助金名</th>
                  <th>事業計画名</th>
                  <th>申請年度・公募回</th>
                  <th>掲載元</th>
                </tr>
              </thead>
              <tbody>
                {(result?.records ?? []).map((row) => (
                  <tr key={row.id}>
                    <td data-label="掲載事業者名"><strong>{row.name}</strong></td>
                    <td data-label="都道府県">{row.prefecture || "記載なし"}</td>
                    <td data-label="補助金名">{row.subsidy}</td>
                    <td data-label="事業計画名"><span className="adoption-plan">{row.plan || "記載なし"}</span></td>
                    <td data-label="申請年度・公募回">{row.year || "不明"}{row.round ? `・第${row.round}回` : ""}</td>
                    <td data-label="掲載元"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">公式詳細 ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {result && result.totalPages > 1 && !error && (
        <nav className="pagination" aria-label="採択掲載行のページ">
          <button type="button" disabled={loading || page <= 1} onClick={() => changePage(Math.max(1, page - 1))}>前へ</button>
          <span>{page.toLocaleString("ja-JP")} / {result.totalPages.toLocaleString("ja-JP")}</span>
          <button type="button" disabled={loading || page >= result.totalPages} onClick={() => changePage(page + 1)}>次へ</button>
        </nav>
      )}

      <p className="adoption-source-note">
        表示内容は中小企業庁の公開検索から取得しています。公式画面の仕様変更時には取得できない場合があります。
        <a href={officialSearchUrl} target="_blank" rel="noreferrer"> 同じ条件を公式検索で確認 ↗</a>
      </p>
    </section>
  );
}
