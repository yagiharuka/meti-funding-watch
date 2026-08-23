"use client";

import { useEffect, useMemo, useState } from "react";
import { reviewProgramHref } from "./review-program-link";

type ReviewProgram = {
  id: string;
  reviewSheetYear: number;
  projectNumber: string;
  name: string;
  organization: string;
  budgetFiscalYear: number;
  initialBudget: number | null;
  executionFiscalYear: number | null;
  execution: number | null;
  executionRate: number | null;
  sourceUrl: string;
};

type ReviewManifest = {
  schemaVersion: 4;
  programsFile: string;
  programCount: number;
};

type HomeProgramSearchProps = {
  query: string;
  page: number;
  onPageChange: (page: number) => void;
  onClear: () => void;
};

const PAGE_SIZE = 50;
const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function getPublicBaseUrl() {
  if (window.location.hostname.endsWith(".chatgpt.site")) {
    return "https://yagiharuka.github.io/meti-funding-watch/";
  }
  return new URL("./", window.location.href).href;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　]+/g, " ").trim();
}

function validateProgram(value: unknown): value is ReviewProgram {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ReviewProgram>;
  return typeof row.id === "string" && Boolean(row.id)
    && Number.isSafeInteger(row.reviewSheetYear)
    && typeof row.projectNumber === "string" && Boolean(row.projectNumber)
    && typeof row.name === "string" && Boolean(row.name)
    && typeof row.organization === "string"
    && Number.isSafeInteger(row.budgetFiscalYear)
    && (row.initialBudget === null || Number.isSafeInteger(row.initialBudget))
    && (row.executionFiscalYear === null || Number.isSafeInteger(row.executionFiscalYear))
    && (row.execution === null || Number.isSafeInteger(row.execution))
    && (row.executionRate === null || typeof row.executionRate === "number")
    && typeof row.sourceUrl === "string" && row.sourceUrl.startsWith("https://");
}

function formatAmount(value: number | null) {
  return value === null ? "記載なし" : yen.format(value);
}

export default function HomeProgramSearch({ query, page, onPageChange, onClear }: HomeProgramSearchProps) {
  const [programs, setPrograms] = useState<ReviewProgram[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const base = getPublicBaseUrl();
    (async () => {
      try {
        const manifestResponse = await fetch(`${base}data/review/manifest.json`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!manifestResponse.ok) throw new Error("行政事業レビューの事業索引を取得できません");
        const manifest = await manifestResponse.json() as Partial<ReviewManifest>;
        if (
          manifest.schemaVersion !== 4
          || manifest.programsFile !== "programs.json"
          || !Number.isSafeInteger(manifest.programCount)
          || (manifest.programCount ?? 0) < 1
        ) {
          throw new Error("行政事業レビューの事業索引情報が不正です");
        }
        const programsResponse = await fetch(`${base}data/review/${manifest.programsFile}`, {
          cache: "force-cache",
          signal: controller.signal,
        });
        if (!programsResponse.ok) throw new Error("行政事業レビューの事業索引を取得できません");
        const rows = await programsResponse.json() as unknown;
        if (!Array.isArray(rows) || rows.length !== manifest.programCount || !rows.every(validateProgram)) {
          throw new Error("行政事業レビューの事業索引が不正です");
        }
        setPrograms(rows);
        setError(null);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setPrograms([]);
        setError(reason instanceof Error ? reason.message : "行政事業レビューの事業索引を取得できません");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const terms = useMemo(() => normalize(query).split(" ").filter(Boolean), [query]);
  const matches = useMemo(() => {
    if (!terms.length || !programs) return [];
    return programs.filter((row) => {
      const haystack = normalize(`${row.name} ${row.projectNumber} ${row.organization}`);
      return terms.every((term) => haystack.includes(term));
    }).sort((left, right) =>
      (right.execution ?? Number.NEGATIVE_INFINITY) - (left.execution ?? Number.NEGATIVE_INFINITY)
      || right.reviewSheetYear - left.reviewSheetYear
      || left.name.localeCompare(right.name, "ja"));
  }, [programs, terms]);
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages - 1);
  const visible = matches.slice(effectivePage * PAGE_SIZE, (effectivePage + 1) * PAGE_SIZE);

  return (
    <div className="home-program-results">
      <div className="result-bar">
        <span role="status" aria-live="polite">
          {loading ? <strong>事業索引を読込中</strong> : error ? <strong>事業索引を取得できません</strong> : !terms.length ? <strong>事業名を入力してください</strong> : <><strong>{matches.length.toLocaleString("ja-JP")}</strong>事業</>}
        </span>
        {query.trim() && <button onClick={onClear}>条件をクリア</button>}
      </div>

      <div className="records-table home-program-table" role="region" aria-label="行政事業レビューの事業検索結果" tabIndex={0}>
        {visible.length > 0 && (
          <table>
            <caption className="sr-only">行政事業レビューに掲載された事業・予算執行情報</caption>
            <thead><tr><th scope="col">事業</th><th scope="col">担当組織</th><th scope="col">当初予算</th><th scope="col">執行額</th><th scope="col">レビュー年度</th><th scope="col">原典</th></tr></thead>
            <tbody>{visible.map((row) => (
              <tr key={row.id}>
                <td data-label="事業"><strong><a className="program-detail-link" href={reviewProgramHref(getPublicBaseUrl(), row.id)} aria-label={`${row.name}の事業カードを表示`}>{row.name}</a></strong><small>予算事業ID {row.projectNumber}</small></td>
                <td data-label="担当組織">{row.organization || "記載なし"}</td>
                <td className="amount" data-label="当初予算">{formatAmount(row.initialBudget)}<small>{row.budgetFiscalYear}年度のレビューシート掲載値</small></td>
                <td className="amount" data-label="執行額">{formatAmount(row.execution)}<small>{row.executionFiscalYear ? `${row.executionFiscalYear}年度` : "年度不明"}{row.executionRate === null ? "" : `／執行率 ${row.executionRate}`}</small></td>
                <td data-label="レビュー年度">{row.reviewSheetYear}年度シート</td>
                <td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {!loading && error && <div className="empty-state"><strong>事業索引を表示できません</strong><span>{error}</span></div>}
        {!loading && !error && !terms.length && <div className="empty-state"><strong>事業名・予算事業IDで検索</strong><span>事業名の一部、予算事業ID、担当組織を入力できます。</span></div>}
        {!loading && !error && terms.length > 0 && !visible.length && <div className="empty-state"><strong>収録済みレビューシートでは確認できませんでした</strong><span>表記を短くするか、別の語で検索してください。</span></div>}
      </div>

      {matches.length > PAGE_SIZE && (
        <nav className="pagination" aria-label="事業検索結果のページ送り">
          <button disabled={effectivePage === 0} onClick={() => onPageChange(Math.max(0, effectivePage - 1))}>← 前へ</button>
          <span>{effectivePage + 1} / {totalPages}</span>
          <button disabled={effectivePage + 1 >= totalPages} onClick={() => onPageChange(Math.min(totalPages - 1, effectivePage + 1))}>次へ →</button>
        </nav>
      )}
      <p className="home-program-note">行政事業レビューの事業・予算執行を検索しています。企業別のGビズINFO掲載行とは合算しません。</p>
    </div>
  );
}
