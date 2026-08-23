import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const fundingWorkerSource = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");
const adoptionSource = await readFile(new URL("../app/adoptions/AdoptionSearch.tsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const pageHtml = await readFile(new URL("../pages-site/index.html", import.meta.url), "utf8");
const officialPageHtml = await readFile(new URL("../pages-site/official/index.html", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const tabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const homeProgramSearchSource = await readFile(new URL("../app/HomeProgramSearch.tsx", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("resets hidden agency state whenever the fiscal year changes", () => {
  const changeYear = pageSource.match(/function changeYear\(nextYear: string\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.match(changeYear, /setAgency\("all"\)/);
  assert.match(changeYear, /setYear\(nextYear\)/);
  assert.match(pageSource, /agencies\.includes\(agency\)/);
});

test("describes Gbiz results as published rows and uses the official category wording", () => {
  assert.match(pageSource, /<strong>\{searchTotal\.toLocaleString\("ja-JP"\)\}<\/strong>掲載行/);
  assert.match(pageSource, /–\$\{visibleEnd\.toLocaleString\("ja-JP"\)\}行を表示/);
  assert.match(pageSource, /調達（委託を含む）・補助金/);
  assert.match(pageSource, /<h1>経産省関連の事業費額<em>（非公式）<\/em><\/h1>/);
  assert.doesNotMatch(pageSource, /<strong>\{searchTotal\.toLocaleString\("ja-JP"\)\}<\/strong>件/);
  assert.match(pageHtml, /<title>経産省関連の事業費額（非公式）<\/title>/);
});

test("does not render an unavailable status field or its notice", () => {
  assert.doesNotMatch(pageSource, /補助金掲載値の注意|法人詳細画面に表示される手続ステータス|GビズINFO画面のステータス|sourceStatusCell|source-status unavailable/);
  assert.match(pageSource, /\?hojinBango=\$\{row\.corporateNumber\}\$\{row\.stage === "subsidy_published" \? "#subsidy" : "#procurement"\}/);
  assert.doesNotMatch(pageSource, /subsidy_published: "補助金CSV"/);
});

test("describes two main series and a bounded reconciliation log", () => {
  for (const source of [layoutSource, pageHtml]) {
    assert.match(source, /GビズINFOと行政事業レビューを主系列/);
    assert.match(source, /機関公表資料との照合結果/);
  }
  for (const source of [officialPageSource, officialPageHtml]) {
    assert.match(source, /機関公表資料.*GビズINFO掲載値/);
    assert.match(source, /照合/);
  }
  assert.match(readme, /2つの主系列/);
  assert.match(readme, /照合の記録/);
  assert.doesNotMatch(pageSource, /<h3>機関公表資料との照合/);
  assert.doesNotMatch(tabsSource, /<strong>照合の記録/);
  assert.match(officialPageSource, /<h1 id="official-title">機関公表資料との照合の記録（非公式）<\/h1>/);
});

test("distinguishes page navigation from result-series tabs", () => {
  assert.match(tabsSource, /className="search-page-nav"/);
  assert.match(tabsSource, /aria-label="検索ページ"/);
  assert.match(tabsSource, /検索方法/);
  assert.doesNotMatch(tabsSource, /className="view-tabs"|role="tablist"/);
});

test("offers review-program search in the first search area without merging it into company results", () => {
  assert.match(pageSource, /aria-label="検索対象"/);
  assert.match(pageSource, /企業名・法人番号/);
  assert.match(pageSource, /事業名・予算事業ID/);
  assert.match(pageSource, /searchTarget !== "company"/);
  assert.match(homeProgramSearchSource, /事業名の一部、予算事業ID、担当組織/);
  assert.match(homeProgramSearchSource, /行政事業レビューの事業・予算執行を検索/);
  assert.match(homeProgramSearchSource, /企業別のGビズINFO掲載行とは合算しません/);
});

test("uses non-authoritative freshness wording", () => {
  assert.match(pageSource, /掲載データ読込済み/);
  assert.doesNotMatch(pageSource, /明細準備完了/);
  assert.match(pageSource, /取得時CSVの抽出対象行を取込確認/);
  assert.match(pageSource, /取得時CSVの最終取込成功/);
  assert.match(pageSource, /公式ダッシュボード確認日時/);
});

test("normalizes adoption year and round without double decoration", () => {
  assert.match(adoptionSource, /if \(\/\^第\.\+回\$\/\.test\(normalized\)\) return normalized/);
  assert.match(adoptionSource, /if \(\/\^\[0-9０-９\]\+\$\/\.test\(normalized\)\) return `第\$\{normalized\}回`/);
  assert.doesNotMatch(adoptionSource, /第\$\{row\.round\}回/);
  assert.match(adoptionSource, /if \(\/\^\\d\{4\}\$\/\.test\(normalized\)\) return `\$\{normalized\}年`/);
});

test("tables expose accessible labels and become cards on small screens", () => {
  assert.match(pageSource, /<caption className="sr-only">/);
  assert.match(adoptionSource, /<caption className="sr-only">/);
  assert.match(adoptionSource, /<th scope="col">掲載事業者名<\/th>/);
  assert.match(adoptionSource, /aria-label=\{`\$\{row\.name\}の\$\{row\.subsidy\}/);
  assert.match(styleSource, /@media \(max-width: 640px\)[\s\S]*\.records-table table[\s\S]*display: block/);
  assert.match(pageSource, /<td data-label="法人等の名称">/);
});

test("search state is reflected in the URL", () => {
  assert.match(pageSource, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(pageSource, /window\.history\.replaceState/);
  assert.match(adoptionSource, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(adoptionSource, /pushState/);
  assert.match(adoptionSource, /popstate/);
});

test("verifies the release and searches only verified company or filter partitions", () => {
  assert.match(pageSource, /fetch\(`\$\{publicBaseUrl\}release\.json\?load=\$\{cacheKey\}`/);
  assert.match(pageSource, /await sha256\(manifestBytes\).*candidateRelease\.manifestSha256/);
  assert.match(pageSource, /candidateRelease\.preview\.sha256/);
  assert.match(pageSource, /setDetailLoading\(false\)/);
  assert.match(pageSource, /sourceSnapshots\.gbiz/);
  assert.match(pageSource, /corrections\\\/index\\\.html/);
  assert.match(pageSource, /\\\.\(\?:svg\|txt\)/);
  assert.match(pageSource, /new Worker\(new URL\("\.\/funding-search\.worker\.ts"/);
  assert.match(fundingWorkerSource, /metadata\.bytes/);
  assert.match(fundingWorkerSource, /metadata\.sha256/);
  assert.match(fundingWorkerSource, /searchParams\.set\("release", message\.release\.commitSha\)/);
  assert.match(fundingWorkerSource, /activeMessage\.release\.companySearch\.files\[filename\]/);
  assert.match(fundingWorkerSource, /activeMessage\.release\.companySearch\.filterFiles\[partition\.filename\]/);
  assert.match(fundingWorkerSource, /buckets\.map\(loadCompanyBucket\)/);
  assert.match(fundingWorkerSource, /selected\.map\(loadFilterPartition\)/);
  assert.doesNotMatch(fundingWorkerSource, /loadAllLegacyRecords/);
  assert.match(fundingWorkerSource, /cache: "force-cache"/);
  assert.match(pageSource, /loadVerifiedFundingRecords\(getPublicBaseUrl\(\), manifest, release/);
  assert.match(pageSource, /setSearchBackend\("main"\)/);
  assert.match(pageSource, /await sha256\(idSetBytes\.buffer\) !== release\.idSetSha256/);
  assert.match(pageSource, /records\.length > pageSize/);
  assert.doesNotMatch(pageSource, /getFundingSearchUrl|haru620328\.chatgpt\.site\/api\/funding/);
});

test("keeps interactive controls outside the Gbiz live status region", () => {
  assert.match(pageSource, /<div className="result-bar">\s*<span role="status" aria-live="polite">/);
  assert.doesNotMatch(pageSource, /<div className="result-bar" role="status"/);
});

test("invalidates stale funding searches and keeps request errors recoverable", () => {
  const pending = pageSource.slice(
    pageSource.indexOf("function markSearchPending()"),
    pageSource.indexOf("function clearFilters()"),
  );
  assert.ok(
    pending.indexOf("requestIdRef.current += 1") < pending.indexOf("setDataset"),
    "the old request must be invalidated before rows are cleared",
  );
  assert.match(pageSource, /window\.setTimeout\(\(\) => setDebouncedQuery\(query\), 400\)/);
  assert.match(pageSource, /query !== debouncedQuery \|\| isComposingQuery/);
  assert.match(pageSource, /onCompositionStart=\{\(\) => setIsComposingQuery\(true\)\}/);
  assert.match(pageSource, /onCompositionEnd=/);
  assert.match(pageSource, /\[agencies, agency, debouncedQuery, isComposingQuery, manifest\?\.generatedAt, page, query, release/);
  const requestError = pageSource.slice(
    pageSource.indexOf('if (message.type === "error")'),
    pageSource.indexOf("const candidate = message.result"),
  );
  assert.match(requestError, /message\.requestId !== undefined/);
  assert.match(requestError, /setSearchError/);
  assert.match(requestError, /setDataMode\("github"\)/);
  assert.ok(requestError.indexOf("setDataMode(\"github\")") < requestError.indexOf("startMainThreadFallback()"));
  assert.match(pageSource, /sanitizeFundingSearchQuery\(initialSearchParam\("q"/);
  assert.match(pageSource, /sanitizeFundingSearchPage\(initialSearchParam\("page"/);
});

test("shows update failures and staleness without disabling verified search data", () => {
  assert.match(pageSource, /update-status\.json/);
  assert.match(pageSource, /evaluatePublicUpdateHealth/);
  assert.match(pageSource, /直近の自動更新に失敗しました/);
  assert.match(pageSource, /最終取込成功から8日以上経過/);
  assert.doesNotMatch(pageSource, /週次自動更新の状態を確認できません/);
  assert.match(pageSource, /updateHealth === "failed"/);
  assert.match(pageSource, /badge\.svg\?branch=main&event=schedule/);
  assert.match(pageSource, /setInterval\(\(\) => setStatusClock\(Date\.now\(\)\), 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(pageSource, /setDataMode\("unavailable"\)[\s\S]{0,100}update-status\.json/);
});
