import fs from "node:fs";

const path = "app/page.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: target is not unique`);
  source = source.replace(before, after);
}

replaceOnce(
`type FundingSearchResult = {
  totalRecords: number;
  totalPages: number;
  page: number;
  pageSize: number;
  records: FundingRecord[];
  releaseCommit: string;
  generatedAt: string;
};`,
`type FundingSearchSummary = {
  amountKnownTotal: number;
  amountKnownCount: number;
  amountUnknownCount: number;
  organizationCount: number;
  organizations: Array<{ name: string; corporateNumber: string; records: number; amount: number }>;
  byStage: Array<{ stage: Stage; records: number; amount: number; amountKnownCount: number }>;
  byYear: Array<{ fiscalYear: number | null; records: number; amount: number; amountKnownCount: number }>;
  topPrograms: Array<{ program: string; records: number; amount: number; amountKnownCount: number }>;
};

type FundingSearchResult = {
  totalRecords: number;
  totalPages: number;
  page: number;
  pageSize: number;
  records: FundingRecord[];
  summary: FundingSearchSummary;
  releaseCommit: string;
  generatedAt: string;
};`,
"summary type",
);

replaceOnce(
`function initialSearchParam(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}


export default function Home() {`,
`function initialSearchParam(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function summarizeFundingRecords(rows: FundingRecord[]): FundingSearchSummary {
  let amountKnownTotal = 0;
  let amountKnownCount = 0;
  const organizations = new Map<string, { name: string; corporateNumber: string; records: number; amount: number }>();
  const stages = new Map<Stage, { stage: Stage; records: number; amount: number; amountKnownCount: number }>();
  const years = new Map<string, { fiscalYear: number | null; records: number; amount: number; amountKnownCount: number }>();
  const programs = new Map<string, { program: string; records: number; amount: number; amountKnownCount: number }>();

  for (const row of rows) {
    const amount = row.amount ?? 0;
    if (row.amount !== null) { amountKnownTotal += row.amount; amountKnownCount += 1; }
    const organization = organizations.get(row.corporateNumber) ?? { name: row.organization, corporateNumber: row.corporateNumber, records: 0, amount: 0 };
    organization.records += 1; organization.amount += amount; organizations.set(row.corporateNumber, organization);
    const stageItem = stages.get(row.stage) ?? { stage: row.stage, records: 0, amount: 0, amountKnownCount: 0 };
    stageItem.records += 1; stageItem.amount += amount; if (row.amount !== null) stageItem.amountKnownCount += 1; stages.set(row.stage, stageItem);
    const yearKey = row.fiscalYear === null ? "unclassified" : String(row.fiscalYear);
    const yearItem = years.get(yearKey) ?? { fiscalYear: row.fiscalYear, records: 0, amount: 0, amountKnownCount: 0 };
    yearItem.records += 1; yearItem.amount += amount; if (row.amount !== null) yearItem.amountKnownCount += 1; years.set(yearKey, yearItem);
    const programName = row.program.trim() || "活動名称・件名の記載なし";
    const programItem = programs.get(programName) ?? { program: programName, records: 0, amount: 0, amountKnownCount: 0 };
    programItem.records += 1; programItem.amount += amount; if (row.amount !== null) programItem.amountKnownCount += 1; programs.set(programName, programItem);
  }

  return {
    amountKnownTotal,
    amountKnownCount,
    amountUnknownCount: rows.length - amountKnownCount,
    organizationCount: organizations.size,
    organizations: [...organizations.values()].sort((a,b)=>b.amount-a.amount || b.records-a.records || a.name.localeCompare(b.name,"ja")).slice(0,10),
    byStage: [...stages.values()].sort((a,b)=>a.stage.localeCompare(b.stage)),
    byYear: [...years.values()].sort((a,b)=>(b.fiscalYear ?? Number.NEGATIVE_INFINITY)-(a.fiscalYear ?? Number.NEGATIVE_INFINITY)).slice(0,5),
    topPrograms: [...programs.values()].sort((a,b)=>b.amount-a.amount || b.records-a.records || a.program.localeCompare(b.program,"ja")).slice(0,5),
  };
}

export default function Home() {`,
"fallback summary helper",
);

replaceOnce(
`  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalPages, setSearchTotalPages] = useState(1);`,
`  const [searchTotal, setSearchTotal] = useState(0);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [searchSummary, setSearchSummary] = useState<FundingSearchSummary | null>(null);`,
"summary state",
);

replaceOnce(
`          setSearchTotal(0);
          setSearchTotalPages(1);
          setSearchError("検索条件を処理できませんでした。条件を変えてもう一度お試しください。");`,
`          setSearchTotal(0);
          setSearchTotalPages(1);
          setSearchSummary(null);
          setSearchError("検索条件を処理できませんでした。条件を変えてもう一度お試しください。");`,
"worker error summary reset",
);

replaceOnce(
`        || !Number.isSafeInteger(candidate.page) || candidate.page < 1 || candidate.page > candidate.totalPages
        || records.length > pageSize
      ) {`,
`        || !Number.isSafeInteger(candidate.page) || candidate.page < 1 || candidate.page > candidate.totalPages
        || records.length > pageSize
        || !candidate.summary || !Number.isSafeInteger(candidate.summary.organizationCount)
        || !Number.isFinite(candidate.summary.amountKnownTotal)
      ) {`,
"summary validation",
);

replaceOnce(
`      setSearchTotal(candidate.totalRecords);
      setSearchTotalPages(candidate.totalPages);
      setSearchError(null);`,
`      setSearchTotal(candidate.totalRecords);
      setSearchTotalPages(candidate.totalPages);
      setSearchSummary(candidate.summary);
      setSearchError(null);`,
"worker summary state",
);

replaceOnce(
`    setSearchTotal(totalRecords);
    setSearchTotalPages(totalPages);
    setSearchError(null);`,
`    setSearchTotal(totalRecords);
    setSearchTotalPages(totalPages);
    setSearchSummary(summarizeFundingRecords(matching));
    setSearchError(null);`,
"fallback summary state",
);

replaceOnce(
`    setDataset((current) => ({ ...current, records: [] }));
    setSearchError(null);
    setDetailLoading(true);`,
`    setDataset((current) => ({ ...current, records: [] }));
    setSearchSummary(null);
    setSearchError(null);
    setDetailLoading(true);`,
"pending summary reset",
);

replaceOnce(
`    setSearchTotal(0);
    setSearchTotalPages(1);
    setDetailLoading(true);`,
`    setSearchTotal(0);
    setSearchTotalPages(1);
    setSearchSummary(null);
    setDetailLoading(true);`,
"retry summary reset",
);

replaceOnce(
`        <div className="result-bar">
          <span role="status" aria-live="polite">`,
`        {query.trim() && searchSummary && !detailLoading && searchTotal > 0 && (
          <div className="records-table" role="region" aria-label="企業検索結果サマリー" tabIndex={0} style={{ marginBottom: "1rem" }}>
            <table>
              <caption style={{ textAlign: "left", padding: "1rem", fontWeight: 700 }}>検索結果サマリー（現在の検索条件）</caption>
              <thead><tr><th>対象法人</th><th>掲載行</th><th>金額記載あり</th><th>GビズINFO掲載値合計</th></tr></thead>
              <tbody><tr><td><strong>{searchSummary.organizationCount.toLocaleString("ja-JP")}法人</strong><small>法人番号単位</small></td><td>{searchTotal.toLocaleString("ja-JP")}行</td><td>{searchSummary.amountKnownCount.toLocaleString("ja-JP")}行<small>{searchSummary.amountUnknownCount ? `／金額不明 ${searchSummary.amountUnknownCount.toLocaleString("ja-JP")}行` : ""}</small></td><td className="amount"><strong>{yen.format(searchSummary.amountKnownTotal)}</strong><small>金額記載のある掲載行のみ。総支出額ではありません。</small></td></tr></tbody>
            </table>
            <table>
              <thead><tr><th>情報種別</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.byStage.map((item)=><tr key={item.stage}><td><span className={`stage-badge ${item.stage}`}>{stageLabels[item.stage]}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
            </table>
            <table>
              <thead><tr><th>直近の年度</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.byYear.map((item)=><tr key={item.fiscalYear ?? "unclassified"}><td>{item.fiscalYear === null ? "年度不明" : `${item.fiscalYear}年度`}</td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
            </table>
            <table>
              <thead><tr><th>掲載値上位の活動名称・件名</th><th>掲載行</th><th>掲載値合計</th></tr></thead>
              <tbody>{searchSummary.topPrograms.map((item)=><tr key={item.program}><td><span className="program-name">{item.program}</span></td><td>{item.records.toLocaleString("ja-JP")}行</td><td className="amount">{yen.format(item.amount)}<small>金額記載 {item.amountKnownCount.toLocaleString("ja-JP")}行</small></td></tr>)}</tbody>
            </table>
          </div>
        )}

        <div className="result-bar">
          <span role="status" aria-live="polite">`,
"summary UI",
);

fs.writeFileSync(path, source);
console.log("Patched app/page.tsx with company search summary UI");
