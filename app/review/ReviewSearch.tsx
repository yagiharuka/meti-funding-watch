"use client";

import { useEffect, useMemo, useState } from "react";

type FlowLevel = "recipient" | "intermediary" | "unclassified";
type ReviewPayment = {
  id: string; fiscalYear: number; reviewSheetYear: number; reviewProjectId: string;
  organization: string; corporateNumber: string; organizationType: string; sourceAgency: string;
  program: string; amount: number; flowLevel: FlowLevel; flowDepth: number | null; block: string;
  route: string[]; sourceName: string; sourceUrl: string; quality: "primary";
};
type ReviewProgram = {
  id: string; reviewSheetYear: number; projectNumber: string; name: string; organization: string;
  budgetFiscalYear: number; initialBudget: number | null; availableBudget: number | null;
  executionFiscalYear: number | null; execution: number | null; executionRate: number | null; sourceUrl: string;
};
type ReviewManifest = {
  schemaVersion: 3; generatedAt: string; lastSuccessfulSourceRefresh?: string; refreshStatus?: string; sourceUrl: string; reviewSheetYears: number[];
  programsFile: string; paymentFiles: string[]; programCount: number; paymentCount: number;
  sourceReceipts: Array<{ reviewSheetYear: number; filename: string; sha256: string; bytes: number }>;
  bootstrapProvenance?: { commit: string; description: string };
};

const PAGE_SIZE = 50;
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const flowLabels: Record<FlowLevel, string> = {
  recipient: "公開経路上の終端支出先", intermediary: "実施機関・中間支出先", unclassified: "経路未分類",
};

export default function ReviewSearch() {
  const [manifest, setManifest] = useState<ReviewManifest | null>(null);
  const [programs, setPrograms] = useState<ReviewProgram[]>([]);
  const [payments, setPayments] = useState<ReviewPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [flow, setFlow] = useState<"all" | FlowLevel>("all");
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
  const terms = normalized.split(" ").filter(Boolean);
  const termsKey = terms.join("\u0000");
  const filteredPayments = useMemo(() => payments.filter((row) => {
    if (year !== "all" && String(row.reviewSheetYear) !== year) return false;
    if (flow !== "all" && row.flowLevel !== flow) return false;
    const haystack = normalize([row.organization, row.corporateNumber, row.program, row.sourceAgency, row.organizationType, ...row.route].join(" "));
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => b.amount - a.amount || a.organization.localeCompare(b.organization, "ja")), [payments, termsKey, year, flow]);
  const filteredPrograms = useMemo(() => programs.filter((row) => {
    if (year !== "all" && String(row.reviewSheetYear) !== year) return false;
    const haystack = normalize([row.projectNumber, row.name, row.organization].join(" "));
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => (b.execution ?? -1) - (a.execution ?? -1)), [programs, termsKey, year]);
  const rows = mode === "payments" ? filteredPayments : filteredPrograms;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const effective = Math.min(page, pages - 1);
  const visible = rows.slice(effective * PAGE_SIZE, (effective + 1) * PAGE_SIZE);
  const hasFilters = Boolean(query.trim()) || year !== "all" || flow !== "all";

  function resetPage(action: () => void) { action(); setPage(0); }
  function clear() { setQuery(""); setYear("all"); setFlow("all"); setPage(0); }

  return (
    <section className="official-search-section" aria-labelledby="review-search-title">
      <div className="section-heading compact">
        <div><p className="eyebrow">SEPARATE REFERENCE SERIES</p><h2 id="review-search-title">レビューシート検索</h2></div>
        <p>支出先と事業を別表示します。支出先額は上流・中間・下流を足し上げません。</p>
      </div>
      <div className="review-mode-tabs" role="group" aria-label="行政事業レビューの表示対象">
        <button className={mode === "payments" ? "active" : undefined} onClick={() => resetPage(() => setMode("payments"))}>支出先</button>
        <button className={mode === "programs" ? "active" : undefined} onClick={() => resetPage(() => setMode("programs"))}>事業・予算執行</button>
      </div>
      <div className="filters official-search-filters">
        <label className="search-field"><span className="sr-only">名称等で検索</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg><input type="search" maxLength={100} placeholder={mode === "payments" ? "支出先名・法人番号・事業名で検索" : "事業名・予算事業ID・担当組織で検索"} value={query} onChange={(e) => resetPage(() => setQuery(e.target.value))} /></label>
        <label><span className="sr-only">レビューシート年度</span><select value={year} onChange={(e) => resetPage(() => setYear(e.target.value))}><option value="all">収録レビューシート年度すべて</option>{[...(manifest?.reviewSheetYears ?? [])].sort((a,b)=>b-a).map((y)=><option key={y} value={y}>{y}年度シート</option>)}</select></label>
        {mode === "payments" && <label><span className="sr-only">経路上の位置</span><select value={flow} onChange={(e) => resetPage(() => setFlow(e.target.value as typeof flow))}><option value="all">経路上の位置すべて</option>{Object.entries(flowLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
      </div>
      <p className="official-coverage-note"><strong>否定検索には使えません：</strong>{manifest ? `${manifest.reviewSheetYears.join("・")}年度シートを収録。` : "収録年度を確認中。"} 2021–2023年度の移行データは支出先詳細・経路が欠けるため、この支出先検索には含めません。0件でも「資金を受けていない」とは判断できません。</p>
      {manifest?.refreshStatus === "cached-official-source-route-changed" && <p className="official-warning"><strong>鮮度要確認：</strong>この系列は{manifest.lastSuccessfulSourceRefresh ?? "2026-08-06"}に行政事業レビュー公式CSVから取得できた最終検証済みキャッシュです。RSシステムの直接CSV配布経路変更を検知しており、新しい値で上書きしていません。</p>}
      <div className="result-bar"><span role="status" aria-live="polite">{loading ? <strong>レビュー明細を読込中</strong> : error ? <strong>レビュー明細を取得できません</strong> : <><strong>{rows.length.toLocaleString("ja-JP")}</strong>{mode === "payments" ? "支出先掲載行" : "事業"}</>}</span>{hasFilters && <button onClick={clear}>条件をクリア</button>}</div>
      {error ? <div className="adoption-error" role="alert"><strong>行政事業レビューを表示できません。</strong><p>{error}</p></div> : (
        <div className="records-table official-results-table" role="region" aria-label="行政事業レビュー検索結果" tabIndex={0}>
          {mode === "payments" ? <table><thead><tr><th>支出先</th><th>事業</th><th>レビュー掲載の支出先額</th><th>公開経路上の位置</th><th>レビュー年度</th><th>原典</th></tr></thead><tbody>{(visible as ReviewPayment[]).map((row)=><tr key={row.id}><td data-label="支出先"><strong>{row.organization}</strong><small>{row.corporateNumber || "法人番号の記載なし"}</small></td><td data-label="事業"><span className="program-name">{row.program}</span><small>{row.sourceAgency}</small></td><td className="amount" data-label="レビュー掲載の支出先額">{yen.format(row.amount)}<small>支出先の合計支出額（他系列と合算不可）</small></td><td data-label="公開経路上の位置"><strong>{flowLabels[row.flowLevel]}</strong><small>{row.route.join(" → ")}</small></td><td data-label="レビュー年度">{row.reviewSheetYear}年度シート<small>支出対象年度の目安：{row.fiscalYear}年度</small></td><td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a><small>支出先ブロック {row.block}</small></td></tr>)}</tbody></table> : <table><thead><tr><th>事業</th><th>担当組織</th><th>当初予算</th><th>執行額</th><th>レビュー年度</th><th>原典</th></tr></thead><tbody>{(visible as ReviewProgram[]).map((row)=><tr key={row.id}><td data-label="事業"><strong>{row.name}</strong><small>予算事業ID {row.projectNumber}</small></td><td data-label="担当組織">{row.organization}</td><td className="amount" data-label="当初予算">{row.initialBudget === null ? "記載なし" : yen.format(row.initialBudget)}<small>レビューシート掲載値</small></td><td className="amount" data-label="執行額">{row.execution === null ? "記載なし" : yen.format(row.execution)}<small>{row.executionFiscalYear ? `${row.executionFiscalYear}年度` : "年度不明"}{row.executionRate === null ? "" : `／執行率 ${row.executionRate}`}</small></td><td data-label="レビュー年度">{row.reviewSheetYear}年度シート</td><td data-label="原典"><a className="source-link" href={row.sourceUrl} target="_blank" rel="noreferrer">行政事業レビュー ↗</a></td></tr>)}</tbody></table>}
          {!loading && !visible.length && <div className="empty-state zero-result-warning"><strong>収録済みレビューシートでは確認できませんでした</strong><span>これは「資金を受けていない」という意味ではありません。未収録年度・支出先詳細がない年度・レビューに掲載されない支出があり得ます。</span></div>}
        </div>
      )}
      {!error && rows.length > PAGE_SIZE && <nav className="pagination" aria-label="レビュー検索結果のページ送り"><button disabled={effective===0} onClick={()=>setPage(Math.max(0,effective-1))}>← 前へ</button><span>{effective+1} / {pages}</span><button disabled={effective+1>=pages} onClick={()=>setPage(Math.min(pages-1,effective+1))}>次へ →</button></nav>}
      {manifest && <p className="official-search-updated">レビュー系列の最終検証済み取得：{manifest.lastSuccessfulSourceRefresh ?? new Date(manifest.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}{manifest.sourceReceipts.length ? `／原資料receipt ${manifest.sourceReceipts.length}ファイル` : "／旧公式CSVキャッシュから復元（新経路の原資料receipt再取得待ち）"}</p>}
    </section>
  );
}

function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　]+/g," ").trim(); }
function validateManifest(m: ReviewManifest) { if (!m || m.schemaVersion !== 3 || !Array.isArray(m.reviewSheetYears) || !Array.isArray(m.paymentFiles) || !Number.isSafeInteger(m.programCount) || !Number.isSafeInteger(m.paymentCount)) throw new Error("行政事業レビューmanifestが不正です"); }
function validatePayment(r: ReviewPayment) { if (!r || !r.id || !r.organization || !Number.isSafeInteger(r.amount) || r.amount <= 0 || !["recipient","intermediary","unclassified"].includes(r.flowLevel) || !Array.isArray(r.route) || !r.sourceUrl?.startsWith("https://")) throw new Error("行政事業レビュー支出先明細が不正です"); }
function validateProgram(r: ReviewProgram) { if (!r || !r.id || !r.projectNumber || !r.name || !r.sourceUrl?.startsWith("https://")) throw new Error("行政事業レビュー事業明細が不正です"); }
