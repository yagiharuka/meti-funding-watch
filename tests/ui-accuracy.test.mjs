import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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

test("verifies the release and loads only paginated server search rows", () => {
  assert.match(pageSource, /fetch\(`\$\{publicBaseUrl\}release\.json`/);
  assert.match(pageSource, /await sha256\(manifestBytes\).*candidateRelease\.manifestSha256/);
  assert.match(pageSource, /sourceSnapshots\.gbiz/);
  assert.match(pageSource, /getFundingSearchUrl/);
  assert.match(pageSource, /candidate\.releaseCommit !== release\.commitSha/);
  assert.match(pageSource, /records\.length > pageSize/);
  assert.doesNotMatch(pageSource, /loadWithConcurrency|chunkCache|fetchWithRetry/);
});

test("keeps interactive controls outside the Gbiz live status region", () => {
  assert.match(pageSource, /<div className="result-bar">\s*<span role="status" aria-live="polite">/);
  assert.doesNotMatch(pageSource, /<div className="result-bar" role="status"/);
});
