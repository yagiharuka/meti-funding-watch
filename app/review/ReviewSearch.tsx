"use client";

import { useEffect, useMemo, useState } from "react";

type FlowLevel = "disclosed_intermediary" | "terminal_in_disclosed_graph" | "unclassified";
type AmountStatus = "positive" | "zero" | "negative" | "blank" | "invalid";
type ReviewPayment = {
  id: string; reviewSheetYear: number; reviewProjectId: string;
  organization: string; corporateNumber: string; organizationType: string; sourceAgency: string | null;
  program: string; amount: number | null; amountRaw: string; amountStatus: AmountStatus;
  flowLevel: FlowLevel; flowDepth: number | null; block: string;
  route: string[] | null; routeStatus: string; directUpstreamNames: string[];
  parentPaymentIds: string[]; hasDisclosedDownstream: boolean | null; sourceRowNumber: number | null;
  sourceName: string; sourceUrl: string; quality: "primary";
};
type ReviewProgram = {
  id: string; reviewSheetYear: number; projectNumber: string; name: string; organization: string;
  budgetFiscalYear: number; initialBudget: number | null; availableBudget: number | null;
  executionFiscalYear: number | null; execution: number | null; executionRate: number | null; sourceUrl: string;
};
type ReviewManifest = {
  schemaVersion: 4; generatedAt: string; lastSuccessfulSourceRefresh?: string; lastSuccessfulSourceRefreshAt?: string | null; lastSuccessfulSourceRefreshDate?: string | null; refreshStatus?: string; sourceUrl: string; reviewSheetYears: number[];
  programsFile: string; paymentFiles: string[]; programCount: number; paymentCount: number;
  excludedRowsFile: string; excludedRowCount: number;
  rowAccounting: { status: "complete" | "partial_unknown_legacy_cache"; totals: { sourcePaymentRowCount: number | null; publishedPaymentRowCount: number; excludedPaymentRowCount: number | null } };
  sourceReceipts: Array<{ reviewSheetYear: number; filename: string; sha256: string; bytes: number }>;
  bootstrapProvenance?: { commit: string; description: string };
};

const PAGE_SIZE = 50;
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const organizationAliases: Array<[RegExp, string]> = [
  [/新エネルギー・産業技術総合開発機構/, "NEDO ネド"],
  [/情報処理推進機構/, "IPA"],
  [/中小企業基盤整備機構/, "中小機構"],
  [/石油天然ガス・金属鉱物資源機構/, "JOGMEC"],
  [/日本貿易振興機構/, "JETRO ジェトロ"],
];

export default function ReviewSearch() {
  const [manifest, setManifest] = useState<ReviewManifest | null>(null);
  const [programs, setPrograms] = useState<ReviewProgram[]>([]);
  const [payments, setPayments] = useState<ReviewPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [upstream, setUpstream] = useState("");
  const [year, setYear] = useState("all");
  const [mode, setMode] = useState<"payments" | "programs">("payments");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let active = true; const controller = new AbortController();
    (async () => {
      try {
        const mr = await fetch("../data/review/manifest.json", { cache: "no-store", signal: controller.signal });
        if (!mr.ok) throw new Error("行政事業レビューmanifestを取得できません");
        const m = await mr.json() as ReviewManifest;
        validateManifest(m);
        const [programResponse, ...paymentResponses] = await Promise.all([
          fetch(`../data/review/${m.programsFile}`, { cache: "no-store", signal: controller.signal }),
          ...m.paymentFiles.map((file) => fetch(`../data/review/${file}`, { cache: "no-store", signal: controller.signal })),
        ]);
        if (!programResponse.ok || paymentResponses.some((r) => !r.ok)) throw new Error("行政事業レビュー明細を取得できません");
        const loadedPrograms = await programResponse.json() as ReviewProgram[];
        const paymentGroups = await Promise.all(paymentResponses.map((r) => r.json() as Promise<ReviewPayment[]>));
        const loadedPayments = paymentGroups.flat();
        if (loadedPrograms.length !== m.programCount || loadedPayments.length !== m.paymentCount) throw new Error("行政事業レビューmanifestと明細件数が一致しません");
        loadedPayments.forEach(validatePayment); loadedPrograms.forEach(validateProgram);
        if (!active) return;
        setManifest(m); setPrograms(loadedPrograms); setPayments(loadedPayments); setError(null);
      } catch (reason) {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setError(reason instanceof Error ? reason.message : "行政事業レビューデータを取得できません");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  const normalized = normalize(query);
  const terms = useMemo(() => normalized.split(" ").filter(Boolean), [normalized]);
  const upstreamTerms = useMemo(() => normalize(upstream).split(" ").filter(Boolean), [upstream]);
  const filteredPayments = useMemo(() => payments.filter((row) => {
    if (year !== "all" && String(row.reviewSheetYear) !== year) return false;
    const recipientHaystack = normalize(searchableOrganization(`${row.organization} ${row.corporateNumber}`));
    const routeNames = [...(row.route ?? []), ...reviewUpstreamNames(row)];
    const routeHaystack = normalize(routeNames.map(searchableOrganization).join(" "));
    return terms.every((term) => recipientHaystack.includes(term))
      && upstreamTerms.every((term) => routeHaystack.includes(term));
  }).sort((a, b) => (b.amount ?? Number.NEGATIVE_INFINITY) - (a.amount ?? Number.NEGATIVE_INFINITY) || a.organization.localeCompare(b.organization, "ja")), [payments, terms, upstreamTerms, year]);
  const filteredPrograms = useMemo(() => programs.filter((row) => {
    if (year !== "all" && String(row.reviewSheetYear) !== year) return false;
    const haystack = normalize([row.projectNumber, row.name, row.organization].join(" "));
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => (b.execution ?? -1) - (a.execution ?? -1)), [programs, terms, year]);
  const rows = mode === "payments" ? filteredPayments : filteredPrograms;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const effective = Math.min(page, pages - 1);
  const visible = rows.slice(effective * PAGE_SIZE, (effective + 1) * PAGE_SIZE);
  const hasFilters = Boolean(query.trim()) || Boolean(upstream.trim()) || year !== "all";

  function resetPage(action: () => void) { action(); setPage(0); }
  function clear() { setQuery(""); setUpstream(""); setYear("all"); setPage(0); }
  function selectUpstream(name: string) { setUpstream(name); setPage(0); }

  return (
    <section className="official-search-section" aria-labelledby="review-search-title">
      <div className="section-heading compact">
        <div><p className="eyebrow">SEPARATE REFERENCE SERIES</p><h2 id="review-search-title">レビューシート検索</h2></div>
        <p>支出先企業を検索する欄と、資金経路上の支出元を絞る欄を分けています。支出先額は上流・中間・下流を足し上げません。</p>
      </div>
      <div className="review-mode-tabs" role="group" aria-label="行政事業レビューの表示対象">
        <button className={mode === "payments" ? "active" : undefined} onClick={() => resetPage(() => setMode("payments"))}>支出先</button>
        <button className={mode === "programs" ? "active" : undefined} onClick={() => resetPage(() => setMode("programs"))}>事業・予算執行</button>
      </div>
      <div className="filters official-search-filters">
        <label className="search-field"><span className="sr-only">支出先の名称または法人番号で検索</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg><input type="search" maxLength={100} placeholder={mode === "payments" ? "支出先の名称・法人番号で検索" : "事業名・予算事業ID・担当組織で検索"} value={query} onChange={(e) => resetPage(() => setQuery(e.target.value))} /></label>
        {mode === "payments" && <label className="search-field review-upstream-field"><span className="sr-only">資金経路上の支出元で絞る</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg><input type="search" maxLength={100} placeholder="資金経路で絞る（例：NEDO・中小機構）" value={upstream} onChange={(e) => resetPage(() => setUpstream(e.target.value))} /></label>}
        <label><span className="sr-only">レビューシート年度</span><select value={year} onChange={(e) => resetPage(() => setYear(e.target.value))}><option value="all">収録レビューシート年度すべて</option>{[...(manifest?.reviewSheetYears ?? [])].sort((a,b)=>b-a).map((y)=><option key={y} value={y}>{y}年度シート</option>)}</select></label>
      </div>
      {mode === "payments" && <>
        <div className="review-upstream-shortcuts" aria-label="主な支出元から先を見る">
          <span>資金経路から絞る：</span>
          {["NEDO", "IPA", "中小機構", "JOGMEC", "JETRO"].map((name) => <button key={name} className={upstream === name ? "active" : undefined} onClick={() => selectUpstream(name)}>{name}を経由</button>)}
        </div>
        <p className="filter-note">上の「支出先」検索は受取先の名称・法人番号だけを対象にします。NEDOや中小機構などが資金経路の途中にある案件を探す場合は、右の資金経路欄を使ってください。</p>
      </>}
      {manifest && manifest.rowAccounting.status !== "complete" && <p className="official-warning"><strong>原資料行数は未照合：</strong>取得証跡と原資料行数の照合が揃っていない年度があります。表示中の{manifest.paymentCount.toLocaleString("ja-JP")}行を原資料の全行とは扱わないでください。</p>}
      <div className="result-bar"><span role="status" aria-live="polite">{loading ? <strong>レビュー明細を読込中</strong> : error ? <strong>レビュー明細を取得できません</strong> : <><strong>{rows.length.toLocaleString("ja-JP")}</strong>{mode === "payments" ? "支出先掲載行" : "事業"}</>}</span>{hasFilters && <button onClick={clear}>条件をクリア</button>}</div>
      {error ? <div className="adoption-error" role="alert"><strong>行政事業レビューを表示できません。</strong><p>{error}</p></div> : (
        <div className="records-table official-results-table" role="region" aria-label="行政事業レビュー検索結果" tabIndex={0}>
          {mode === "payments" ? <table><thead><tr><th>支出先</th><th>事業</th><th>レビュー掲載の支出先額</th><th>レビューシート記載の支出経路</th><th>レビュー年度</th><th>原典</th></tr></thead><tbody>{(visible as ReviewPayment[]).map((row)=><tr key={row.id}><td data-label="支出先"><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td><td data-label="事業"><span className="program-name">{row.program}</span></td><td className="amount" data-label="レビュー掲載の支出先額">{formatReviewAmount(row)}<small>支出先の合計支出額（他系列と合算不可）</small></td><td className="review-route" data-label="支出経路"><strong>{describeRoute(row)}</strong></td><td data-label="レビュー年度">{row.reviewSheetYear}年度シート<small>シート年度であり、支出年度の推定値ではありません</small></td><td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a><small>支出先ブロック {row.block}{row.sourceRowNumber ? `／CSV ${row.sourceRowNumber}行目` : "／CSV行番号の記録なし"}</small></td></tr>)}</tbody></table> : <table><thead><tr><th>事業</th><th>担当組織</th><th>当初予算</th><th>執行額</th><th>レビュー年度</th><th>原典</th></tr></thead><tbody>{(visible as ReviewProgram[]).map((row)=><tr key={row.id}><td data-label="事業"><strong>{row.name}</strong><small>予算事業ID {row.projectNumber}</small></td><td data-label="担当組織">{row.organization}</td><td className="amount" data-label="当初予算">{row.initialBudget === null ? "記載なし" : yen.format(row.initialBudget)}<small>{row.budgetFiscalYear}年度のレビューシート掲載値</small></td><td className="amount" data-label="執行額">{row.execution === null ? "記載なし" : yen.format(row.execution)}<small>{row.executionFiscalYear ? `${row.executionFiscalYear}年度` : "年度不明"}{row.executionRate === null ? "" : `／執行率 ${row.executionRate}`}</small></td><td data-label="レビュー年度">{row.reviewSheetYear}年度シート</td><td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a></td></tr>)}</tbody></table>}
          {!loading && !visible.length && <div className="empty-state zero-result-warning"><strong>収録済みレビューシートでは確認できませんでした</strong><span>これは「資金を受けていない」という意味ではありません。未収録年度・支出先詳細がない年度・レビューに掲載されない支出があり得ます。</span></div>}
        </div>
      )}
      {!error && rows.length > PAGE_SIZE && <nav className="pagination" aria-label="レビュー検索結果のページ送り"><button disabled={effective===0} onClick={()=>setPage(Math.max(0,effective-1))}>← 前へ</button><span>{effective+1} / {pages}</span><button disabled={effective+1>=pages} onClick={()=>setPage(Math.min(pages-1,effective+1))}>次へ →</button></nav>}
      {manifest && <p className="official-search-updated">レビュー系列の最終検証済み取得：{formatAcquisition(manifest)}{manifest.sourceReceipts.length ? `／原資料receipt ${manifest.sourceReceipts.length}ファイル` : "／原資料の取得証跡を確認できません"}</p>}
    </section>
  );
}

function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　]+/g," ").trim(); }
function formatAcquisition(manifest: ReviewManifest) {
  if (manifest.lastSuccessfulSourceRefreshAt) {
    return new Date(manifest.lastSuccessfulSourceRefreshAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long", timeStyle: "short" });
  }
  const date = manifest.lastSuccessfulSourceRefreshDate ?? manifest.lastSuccessfulSourceRefresh;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return `${year}年${month}月${day}日（取得時刻の記録なし）`;
  }
  return "取得日時不明";
}
function formatReviewAmount(row: ReviewPayment) { if (row.amount !== null) return yen.format(row.amount); return row.amountStatus === "blank" ? "原資料では空欄" : `数値として解釈できません（${row.amountRaw || "記載なし"}）`; }
function describeRoute(row: ReviewPayment) { if (row.route) return `${row.route.join(" → ")}（レビューシートCSVの経路情報）`; if (row.directUpstreamNames.length) return `支出元：${row.directUpstreamNames.join("／")}（複数経路のため直接上流のみ表示）`; return "レビューシートCSVでは支出元を確認できません"; }
function reviewUpstreamNames(row: ReviewPayment) { return [...new Set([row.sourceAgency, ...row.directUpstreamNames].filter((value): value is string => Boolean(value)))]; }
function searchableOrganization(value: string) { return `${value} ${organizationAliases.filter(([pattern]) => pattern.test(value)).map(([, aliases]) => aliases).join(" ")}`; }
function validateManifest(m: ReviewManifest) { if (!m || m.schemaVersion !== 4 || !Array.isArray(m.reviewSheetYears) || !Array.isArray(m.paymentFiles) || !m.rowAccounting || !Number.isSafeInteger(m.programCount) || !Number.isSafeInteger(m.paymentCount)) throw new Error("行政事業レビューmanifestが不正です"); }
function validatePayment(r: ReviewPayment) { if (!r || !r.id || !r.organization || (r.amount !== null && !Number.isSafeInteger(r.amount)) || !["positive","zero","negative","blank","invalid"].includes(r.amountStatus) || !["disclosed_intermediary","terminal_in_disclosed_graph","unclassified"].includes(r.flowLevel) || (r.route !== null && !Array.isArray(r.route)) || !r.sourceUrl?.startsWith("https://")) throw new Error("行政事業レビュー支出先明細が不正です"); }
function validateProgram(r: ReviewProgram) { if (!r || !r.id || !r.projectNumber || !r.name || !r.sourceUrl?.startsWith("https://")) throw new Error("行政事業レビュー事業明細が不正です"); }
