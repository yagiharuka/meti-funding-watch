"use client";

import { useEffect, useMemo, useState } from "react";

type OfficialRecord = {
  id: string;
  sourceKey: string;
  datasetId: string;
  category: "contract_result" | "grant_decision";
  kind: string;
  amountStage: string;
  executorId: string;
  executorName: string;
  fiscalYear: number;
  date: string | null;
  dateRaw: string;
  organization: string;
  organizations?: string[];
  corporateNumber: string | null;
  corporateNumbers?: string[];
  corporateNumberRaw: string;
  multiplePartyListing?: boolean;
  program: string;
  amount: number | null;
  amountRaw: string;
  method: string;
  notes: string;
  sourceDocumentUrl: string;
  sourceSheet: string;
  sourceRowNumber: number;
};

type OfficialManifest = {
  schemaVersion: 1;
  generatedAt: string;
  recordCount: number;
  files: Record<string, string>;
};

type OfficialRelease = {
  generatedAt: string;
  recordCount: number;
  manifestSha256: string;
  idSetSha256: string;
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
};

const PAGE_SIZE = 50;

export default function OfficialSearch() {
  const [records, setRecords] = useState<OfficialRecord[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [executor, setExecutor] = useState("all");
  const [year, setYear] = useState("all");
  const [page, setPage] = useState(0);
  const [officialUpdateOutcome, setOfficialUpdateOutcome] = useState<"succeeded" | "failed" | "unknown">("unknown");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const [manifestResponse, releaseResponse, updateStatus] = await Promise.all([
          fetch("../data/official/manifest.json", { cache: "no-store", signal: controller.signal }),
          fetch("../release.json", { cache: "no-store", signal: controller.signal }),
          fetch("../update-status.json", { cache: "no-store", signal: controller.signal })
            .then(async (response) => response.ok ? response.json() : null)
            .catch(() => null),
        ]);
        if (!manifestResponse.ok || !releaseResponse.ok) throw new Error("公開データの検証情報を取得できません");
        const manifestText = await manifestResponse.text();
        const manifest = JSON.parse(manifestText) as OfficialManifest;
        const release = await releaseResponse.json() as { official?: OfficialRelease };
        if (
          manifest.schemaVersion !== 1 || typeof manifest.generatedAt !== "string"
          || !Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 1
          || !manifest.files || typeof manifest.files !== "object"
          || !release.official
        ) throw new Error("公開データのmanifestが不正です");
        if (await sha256(manifestText) !== release.official.manifestSha256) {
          throw new Error("公式資料manifestのハッシュが一致しません");
        }
        const loaded: OfficialRecord[] = [];
        for (const filename of Object.values(manifest.files)) {
          if (!/^records-\d{4}\.json$/.test(filename)) throw new Error("許可されていない明細ファイルです");
          const response = await fetch(`../data/official/${filename}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error(`${filename}を取得できません`);
          const text = await response.text();
          const receipt = release.official.files[filename];
          const rows = JSON.parse(text) as OfficialRecord[];
          if (
            !receipt || await sha256(text) !== receipt.sha256
            || new TextEncoder().encode(text).byteLength !== receipt.bytes
            || !Array.isArray(rows) || rows.length !== receipt.rows
          ) throw new Error(`${filename}の検証情報が一致しません`);
          for (const row of rows) validateRecord(row);
          loaded.push(...rows);
        }
        const ids = loaded.map((row) => row.id);
        if (
          loaded.length !== manifest.recordCount
          || loaded.length !== release.official.recordCount
          || new Set(ids).size !== ids.length
          || await sha256(`${[...ids].sort().join("\n")}\n`) !== release.official.idSetSha256
          || manifest.generatedAt !== release.official.generatedAt
        ) throw new Error("公式資料明細の全体検証に失敗しました");
        if (!active) return;
        setRecords(loaded);
        setGeneratedAt(manifest.generatedAt);
        setOfficialUpdateOutcome(readOfficialUpdateOutcome(updateStatus, release.official.generatedAt));
        setError(null);
      } catch (reason) {
        if (!active || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setRecords([]);
        setError(reason instanceof Error ? reason.message : "公式資料明細を取得できません");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  const executors = useMemo(() => [...new Set(records.map((row) => row.executorName))].sort(localeCompare), [records]);
  const years = useMemo(() => [...new Set(records.map((row) => row.fiscalYear))].sort((a, b) => b - a), [records]);
  const filtered = useMemo(() => {
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    return records
      .filter((row) => category === "all" || row.category === category)
      .filter((row) => executor === "all" || row.executorName === executor)
      .filter((row) => year === "all" || String(row.fiscalYear) === year)
      .filter((row) => {
        if (!terms.length) return true;
        const haystack = normalizeSearch([
          row.organization, row.corporateNumber, row.corporateNumberRaw,
          ...(row.organizations ?? []), ...(row.corporateNumbers ?? []),
          row.program, row.executorName, row.kind, row.method, row.notes,
        ].filter(Boolean).join(" "));
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || localeCompare(a.organization, b.organization));
  }, [records, query, category, executor, year]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(effectivePage * PAGE_SIZE, (effectivePage + 1) * PAGE_SIZE);
  const hasFilters = Boolean(query.trim()) || category !== "all" || executor !== "all" || year !== "all";

  function updateFilter(action: () => void) {
    action();
    setPage(0);
  }

  function clearFilters() {
    setQuery(""); setCategory("all"); setExecutor("all"); setYear("all"); setPage(0);
  }

  return (
    <section className="official-search-section" id="official-records" aria-labelledby="official-search-title">
      <div className="section-heading compact">
        <div><p className="eyebrow">VERIFIED DETAIL SEARCH</p><h2 id="official-search-title">公式資料の明細検索</h2></div>
        <p>manifestに列挙した各執行機関の公式公表資料を検索できます。未収録の機関・年度・区分は下の一覧に残します。</p>
      </div>
      <div className="series-label" aria-label="表示中のデータ系列">
        <strong>直接契約結果・補助金等の交付決定</strong>
        <span>公式公表資料／複数年度／部分収録</span>
      </div>
      <div className="filters official-search-filters" aria-label="公式資料明細の検索条件">
        <label className="search-field">
          <span className="sr-only">交付先・契約相手、法人番号、事業名で検索</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
          <input type="search" maxLength={100} placeholder="交付先・契約相手、法人番号、事業名で検索" value={query} onChange={(event) => updateFilter(() => setQuery(event.target.value))} />
        </label>
        <label><span className="sr-only">公式資料の系列</span><select value={category} onChange={(event) => updateFilter(() => setCategory(event.target.value))}><option value="all">契約結果・交付決定すべて</option><option value="contract_result">契約結果</option><option value="grant_decision">補助金等の交付決定</option></select></label>
        <label><span className="sr-only">執行機関</span><select value={executor} onChange={(event) => updateFilter(() => setExecutor(event.target.value))}><option value="all">収録中の執行機関すべて</option>{executors.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span className="sr-only">年度</span><select value={year} onChange={(event) => updateFilter(() => setYear(event.target.value))}><option value="all">収録年度すべて</option>{years.map((item) => <option key={item} value={item}>{item}年度</option>)}</select></label>
      </div>
      <p className="official-coverage-note">
        <strong>収録範囲：</strong>年度・機関・区分ごとに公式HTML・XLSX・文字PDFを取得し、検証できた掲載行だけです。
        13執行機関・全年度・全公表区分の完全収録ではなく、実支払や下流支出も含みません。
      </p>
      {officialUpdateOutcome === "failed" && (
        <p className="official-update-alert" role="alert">
          <strong>直近の公式資料明細の自動取得に失敗しました。</strong>
          現在は下記生成日時の、前回検証済みデータを表示しています。
        </p>
      )}
      <div className="result-bar">
        <span role="status" aria-live="polite">{loading ? <strong>明細を検証中</strong> : error ? <strong>明細を取得できません</strong> : <><strong>{filtered.length.toLocaleString("ja-JP")}</strong>掲載行{filtered.length > PAGE_SIZE && `（${effectivePage * PAGE_SIZE + 1}–${Math.min((effectivePage + 1) * PAGE_SIZE, filtered.length)}行を表示）`}</>}</span>
        {hasFilters && <button onClick={clearFilters}>条件をクリア</button>}
      </div>
      {error ? (
        <div className="adoption-error" role="alert"><strong>検索データの整合性を確認できませんでした。</strong><p>{error}。未検証の明細は表示していません。</p></div>
      ) : (
        <div className="records-table official-results-table" role="region" aria-label="公式契約結果・補助金交付決定の明細一覧" tabIndex={0}>
          <table>
            <caption className="sr-only">manifestに列挙した各執行機関の公式公表資料から取り込んだ明細</caption>
            <thead><tr><th scope="col">交付先・契約相手</th><th scope="col">事業名・契約件名</th><th scope="col">執行機関・系列</th><th scope="col">公式掲載値</th><th scope="col">日付・年度</th><th scope="col">原資料</th></tr></thead>
            <tbody>{visible.map((row) => (
              <tr key={row.id}>
                <td data-label="交付先・契約相手">
                  <strong>{displayOrganizations(row)}</strong>
                  <small>{displayCorporateNumbers(row)}</small>
                  {isMultiplePartyListing(row) && <small className="official-multi-party-note">原表の共同1掲載行です。掲載値は法人別に配賦できません。</small>}
                </td>
                <td data-label="事業名・契約件名"><span className="program-name">{row.program}</span>{row.method && <small>{row.method}</small>}{row.notes && <small className="official-record-notes">備考：{row.notes}</small>}</td>
                <td data-label="執行機関・系列">{row.executorName}<small>{row.category === "contract_result" ? "契約結果" : "補助金等の交付決定"}／{row.kind}</small></td>
                <td className="amount" data-label="公式掲載値">{formatAmount(row)}<small>{row.amountStage}（実支払ではありません）</small></td>
                <td data-label="日付・年度">{row.date ? formatDate(row.date) : row.dateRaw || "日付の記載なし"}<small>{row.fiscalYear}年度</small></td>
                <td data-label="原資料"><a className="source-link" href={row.sourceDocumentUrl} target="_blank" rel="noreferrer" aria-label={`${row.organization}の公式原資料を新しいタブで開く`}>公式原資料 ↗</a><small>{row.sourceSheet}・掲載順{row.sourceRowNumber}</small></td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && !visible.length && <div className="empty-state"><strong>該当する掲載行がありません</strong><span>検索語や条件を変えてください。</span></div>}
          {loading && <div className="empty-state"><strong>公式資料明細を検証しています</strong><span>ハッシュと行数が一致したデータだけを表示します。</span></div>}
        </div>
      )}
      {!error && filtered.length > PAGE_SIZE && <nav className="pagination" aria-label="公式資料検索結果のページ送り"><button disabled={effectivePage === 0} onClick={() => setPage(Math.max(0, effectivePage - 1))}>← 前へ</button><span>{effectivePage + 1} / {totalPages}</span><button disabled={effectivePage + 1 >= totalPages} onClick={() => setPage(Math.min(totalPages - 1, effectivePage + 1))}>次へ →</button></nav>}
      {generatedAt && <p className="official-search-updated">検索データ生成：{new Date(generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>}
    </section>
  );
}

function validateRecord(row: OfficialRecord) {
  if (
    !row || typeof row.id !== "string" || !row.id
    || typeof row.sourceKey !== "string" || !row.sourceKey
    || !["contract_result", "grant_decision"].includes(row.category)
    || typeof row.organization !== "string" || !row.organization
    || (row.organizations !== undefined && (!Array.isArray(row.organizations) || row.organizations.some((item) => typeof item !== "string" || !item)))
    || (row.corporateNumbers !== undefined && (!Array.isArray(row.corporateNumbers) || row.corporateNumbers.some((item) => typeof item !== "string" || !/^\d{13}$/.test(item))))
    || typeof row.program !== "string" || !row.program
    || typeof row.executorName !== "string" || !row.executorName
    || !Number.isInteger(row.fiscalYear)
    || (row.amount !== null && !Number.isSafeInteger(row.amount))
    || typeof row.sourceDocumentUrl !== "string" || !row.sourceDocumentUrl.startsWith("https://")
    || !Number.isSafeInteger(row.sourceRowNumber) || row.sourceRowNumber < 1
  ) throw new Error("公式資料明細の必須項目が不正です");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s　]+/g, " ").trim();
}

function localeCompare(a: string, b: string) { return a.localeCompare(b, "ja"); }

function formatAmount(row: OfficialRecord) {
  if (row.amount !== null) return `¥${row.amount.toLocaleString("ja-JP")}`;
  return row.amountRaw || "金額の記載なし";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function isMultiplePartyListing(row: OfficialRecord) {
  return row.multiplePartyListing === true
    || (row.organizations?.length ?? 0) > 1
    || (row.corporateNumbers?.length ?? 0) > 1
    || (row.corporateNumberRaw.match(/\d{13}/g)?.length ?? 0) > 1;
}

function displayOrganizations(row: OfficialRecord) {
  return row.organizations?.length ? row.organizations.join("／") : row.organization;
}

function displayCorporateNumbers(row: OfficialRecord) {
  if (row.corporateNumbers?.length) return row.corporateNumbers.join("／");
  return (row.corporateNumber ?? row.corporateNumberRaw) || "法人番号の記載なし";
}

function readOfficialUpdateOutcome(value: unknown, generatedAt: string) {
  if (!value || typeof value !== "object" || !("official" in value)) return "unknown";
  const official = (value as { official?: { attempt?: { outcome?: unknown }; published?: { generatedAt?: unknown } } }).official;
  if (
    !official || official.published?.generatedAt !== generatedAt
    || !["succeeded", "failed", "unknown"].includes(String(official.attempt?.outcome))
  ) return "unknown";
  return official.attempt?.outcome as "succeeded" | "failed" | "unknown";
}
