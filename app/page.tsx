"use client";

import { useEffect, useMemo, useState } from "react";
import fundingSummary from "@/data/funding-summary.json";

type Stage = "contracted" | "award_decision" | "subsidy_published" | "finalized" | "paid";

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
  route: string[];
  sourceName: string;
  sourceUrl: string;
  quality: "primary" | "aggregated";
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

type FundingDataset = {
  generatedAt: string;
  sources: FundingSource[];
  records: FundingRecord[];
};

const bundledFundingData = fundingSummary as FundingDataset;
const liveDataUrl =
  "https://raw.githubusercontent.com/yagiharuka/meti-funding-watch/main/data/funding-data.json";
const pageSize = 100;

const stageLabels: Record<Stage, string> = {
  contracted: "契約額",
  award_decision: "交付決定額",
  subsidy_published: "補助金掲載額",
  finalized: "確定額",
  paid: "支払済額",
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

function compactYen(value: number) {
  if (value >= 100_000_000_000) return `${(value / 100_000_000_000).toFixed(2)}千億円`;
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

export default function Home() {
  const [dataset, setDataset] = useState<FundingDataset>(bundledFundingData);
  const [dataMode, setDataMode] = useState<"loading" | "github" | "unavailable">("loading");
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("all");
  const [stage, setStage] = useState("all");
  const [year, setYear] = useState("all");
  const [page, setPage] = useState(0);
  const records = dataset.records;

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
          setDataMode("github");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataMode("unavailable");
      });
    return () => controller.abort();
  }, []);

  const agencies = useMemo(
    () => Array.from(new Set(records.map((record) => record.sourceAgency))).sort(),
    [records],
  );

  const fiscalYears = useMemo(
    () => Array.from(new Set(records.map((record) => record.fiscalYear))).sort((a, b) => b - a),
    [records],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja-JP");
    return records
      .filter((record) => {
        const haystack = [
          record.organization,
          record.corporateNumber,
          record.program,
          record.sourceAgency,
        ]
          .join(" ")
          .toLocaleLowerCase("ja-JP");
        return (
          (!normalized || haystack.includes(normalized)) &&
          (agency === "all" || record.sourceAgency === agency) &&
          (stage === "all" || record.stage === stage) &&
          (year === "all" || String(record.fiscalYear) === year)
        );
      })
      .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  }, [agency, query, records, stage, year]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRecords = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const visibleStart = filtered.length ? page * pageSize + 1 : 0;
  const visibleEnd = Math.min((page + 1) * pageSize, filtered.length);
  const visibleTotal = filtered.reduce((sum, record) => sum + (record.amount ?? 0), 0);
  const visibleRecipients = new Set(filtered.map((record) => record.corporateNumber)).size;
  const paidTotal = filtered
    .filter((record) => record.stage === "paid")
    .reduce((sum, record) => sum + (record.amount ?? 0), 0);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="経産省資金フロー トップ">
          <span className="brand-mark" aria-hidden="true">¥</span>
          <span>経産省資金フロー</span>
        </a>
        <nav aria-label="ページ内ナビゲーション">
          <a href="#records">受取先と金額</a>
          <a href="#sources">データソース</a>
          <a href="#about">このサイトについて</a>
        </nav>
        <span className="update-chip"><i /> {
          dataMode === "github" ? "GitHub日次更新" : dataMode === "loading" ? "全件データ読込中" : "データ取得要確認"
        }</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">PUBLIC MONEY EXPLORER</p>
          <h1>経産省の資金は、<br /><em>どの受取先へ。</em></h1>
          <p className="hero-lead">
            経産省とNEDO等の所管法人から企業・大学・一般法人・自治体等に流れた資金を、法人番号でつなぎ、
            契約・交付決定・確定・支払の段階を分けて可視化します。
          </p>
          <div className="hero-note">
            <span>最終データ取得</span>
            <strong>{formatUpdated(dataset.generatedAt)}</strong>
            <span className="source-count">{dataset.sources.length}ソース監視中</span>
          </div>
        </div>

        <aside className="flow-card" aria-label="資金経路の例">
          <div className="flow-card-head">
            <span>資金経路の例</span>
            <span className="live-dot">LIVE</span>
          </div>
          <div className="flow-path">
            <div className="flow-node ministry"><span>支出元</span><strong>経済産業省</strong></div>
            <div className="flow-line"><span>基金・委託</span></div>
            <div className="flow-node agency"><span>実施機関</span><strong>NEDO</strong></div>
            <div className="flow-line"><span>契約</span></div>
            <div className="flow-node company"><span>受取先</span><strong>Rapidus株式会社</strong></div>
          </div>
          <div className="flow-total">
            <span>公開契約額</span>
            <strong>1,230.7億円</strong>
          </div>
          <p>同じ資金を上流と下流で二重計上しない構造で集計します。</p>
        </aside>
      </section>

      <section className="metrics" aria-label="検索対象の集計">
        <article>
          <span>表示中の金額</span>
          <strong>{compactYen(visibleTotal)}</strong>
          <small>契約・交付・確定を段階別に収録</small>
        </article>
        <article>
          <span>受取先数</span>
          <strong>{visibleRecipients}<b>者</b></strong>
          <small>法人番号で名寄せ</small>
        </article>
        <article>
          <span>公開レコード</span>
          <strong>{filtered.length}<b>件</b></strong>
          <small>原典リンク付き</small>
        </article>
        <article className="metric-warning">
          <span>支払済額</span>
          <strong>{paidTotal ? compactYen(paidTotal) : "未公表"}</strong>
          <small>0円とは扱いません</small>
        </article>
      </section>

      <section className="records-section" id="records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECIPIENTS & FUNDING</p>
            <h2>受取先と資金を検索</h2>
          </div>
          <p>GビズINFOの経産省系補助金・調達から、法人番号のある全受取先を取得し、NEDOの一次データで補完します。</p>
        </div>

        <div className="filters" aria-label="検索条件">
          <label className="search-field">
            <span className="sr-only">受取先名、法人番号または制度名で検索</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></svg>
            <input
              type="search"
              placeholder="受取先名・法人番号・制度名で検索"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <label>
            <span className="sr-only">実施機関</span>
            <select value={agency} onChange={(event) => { setAgency(event.target.value); setPage(0); }}>
              <option value="all">すべての実施機関</option>
              {agencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">金額段階</span>
            <select value={stage} onChange={(event) => { setStage(event.target.value); setPage(0); }}>
              <option value="all">すべての金額段階</option>
              {Object.entries(stageLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">年度</span>
            <select value={year} onChange={(event) => { setYear(event.target.value); setPage(0); }}>
              <option value="all">すべての年度</option>
              {fiscalYears.map((item) => <option key={item} value={item}>{item}年度</option>)}
            </select>
          </label>
        </div>

        <div className="result-bar">
          <span>
            <strong>{filtered.length.toLocaleString("ja-JP")}</strong>件中
            {filtered.length > pageSize && ` ${visibleStart.toLocaleString("ja-JP")}–${visibleEnd.toLocaleString("ja-JP")}件を表示`}
          </span>
          {(query || agency !== "all" || stage !== "all" || year !== "all") && (
            <button onClick={() => { setQuery(""); setAgency("all"); setStage("all"); setYear("all"); setPage(0); }}>
              条件をクリア
            </button>
          )}
        </div>

        <div className="records-table" role="region" aria-label="資金レコード一覧" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>受取先</th>
                <th>制度・事業</th>
                <th>実施機関</th>
                <th>段階</th>
                <th>金額</th>
                <th>年度</th>
                <th>根拠</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.organization}</strong>
                    <small>{record.corporateNumber}</small>
                  </td>
                  <td>
                    <span className="program-name">{record.program}</span>
                    <small className="route">{record.route.join(" → ")}</small>
                  </td>
                  <td>{record.sourceAgency}</td>
                  <td><span className={`stage-badge ${record.stage}`}>{stageLabels[record.stage]}</span></td>
                  <td className="amount">{record.amount === null ? "金額未公表" : yen.format(record.amount)}</td>
                  <td>{record.fiscalYear}</td>
                  <td>
                    <a className="source-link" href={record.sourceUrl} target="_blank" rel="noreferrer">
                      原典 ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-state">
              <strong>{dataMode === "loading" ? "全件データを読み込んでいます" : "該当するレコードがありません"}</strong>
              <span>{dataMode === "loading" ? "しばらくお待ちください。" : "検索語や条件を変えてください。"}</span>
            </div>
          )}
        </div>
        {filtered.length > pageSize && (
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
          <p>取得失敗時は古いデータを消さず、更新状態を明示します。</p>
        </div>
        <div className="source-grid">
          {dataset.sources.map((source) => (
            <article key={source.id}>
              <div><span className={`health ${source.status}`} />{source.name}</div>
              <strong>{source.recordCount.toLocaleString("ja-JP")}件</strong>
              <dl>
                <div><dt>取得方式</dt><dd>{source.method}</dd></div>
                <div><dt>更新周期</dt><dd>{source.frequency}</dd></div>
                <div><dt>最終確認</dt><dd>{source.lastChecked}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="about-section" id="about">
        <div>
          <p className="eyebrow">TRANSPARENCY BY DESIGN</p>
          <h2>「分からない」を、0円にしない。</h2>
        </div>
        <div className="about-copy">
          <p>
            このサイトは公開情報をもとにした検証版です。採択、交付決定、契約、額の確定、
            支払済を区別し、実支出が公開されていない場合は「未公表」と表示します。
          </p>
          <ul>
            <li>すべての金額に原典URLと取得日を保持</li>
            <li>法人番号と表記ゆれ辞書による受取先の名寄せ</li>
            <li>経産省→所管法人→受取先の二重計上を防止</li>
          </ul>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><span>経産省資金フロー</span></div>
        <p>公開情報ベースの非公式プロトタイプ</p>
        <a href="#top">ページ上部へ ↑</a>
      </footer>
    </main>
  );
}
