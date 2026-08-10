import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const fundingWorkerSource = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");
const adoptionSource = await readFile(new URL("../app/adoptions/AdoptionSearch.tsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const pageHtml = await readFile(new URL("../pages-site/index.html", import.meta.url), "utf8");

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
  assert.doesNotMatch(pageSource, /<strong>\{searchTotal\.toLocaleString\("ja-JP"\)\}<\/strong>件/);
  assert.match(pageHtml, /<title>経産省関係の調達（委託を含む）・補助金情報(?:（GビズINFO）)?<\/title>/);
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

test("verifies the release and searches verified static chunks in a worker", () => {
  assert.match(pageSource, /fetch\(`\$\{publicBaseUrl\}release\.json`/);
  assert.match(pageSource, /await sha256\(manifestBytes\).*candidateRelease\.manifestSha256/);
  assert.match(pageSource, /sourceSnapshots\.gbiz/);
  assert.match(pageSource, /new Worker\(new URL\("\.\/funding-search\.worker\.ts"/);
  assert.match(fundingWorkerSource, /message\.release\.files\[filename\]/);
  assert.match(fundingWorkerSource, /metadata\.bytes/);
  assert.match(fundingWorkerSource, /metadata\.sha256/);
  assert.match(fundingWorkerSource, /message\.release\.idSetSha256/);
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
  assert.match(pageSource, /query !== deferredQuery/);
  assert.match(pageSource, /\[agencies, agency, deferredQuery, page, query, release/);
  const requestError = pageSource.slice(
    pageSource.indexOf('if (message.type === "error")'),
    pageSource.indexOf("const candidate = message.result"),
  );
  assert.match(requestError, /message\.requestId !== undefined/);
  assert.match(requestError, /setSearchError/);
  assert.match(requestError, /setDataMode\("github"\)/);
  assert.ok(requestError.indexOf("setDataMode(\"github\")") < requestError.indexOf("setSearchReady(false)"));
  assert.match(pageSource, /sanitizeFundingSearchQuery\(initialSearchParam\("q"/);
  assert.match(pageSource, /sanitizeFundingSearchPage\(initialSearchParam\("page"/);
});

test("shows update failures and staleness without disabling verified search data", () => {
  assert.match(pageSource, /update-status\.json/);
  assert.match(pageSource, /evaluatePublicUpdateHealth/);
  assert.match(pageSource, /直近の自動更新に失敗しました/);
  assert.match(pageSource, /最終取込成功から30時間以上経過/);
  assert.match(pageSource, /日次自動更新の状態を確認できません/);
  assert.match(pageSource, /updateHealth === "failed"/);
  assert.match(pageSource, /badge\.svg\?branch=main&event=schedule/);
  assert.match(pageSource, /setInterval\(\(\) => setStatusClock\(Date\.now\(\)\), 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(pageSource, /setDataMode\("unavailable"\)[\s\S]{0,100}update-status\.json/);
});
