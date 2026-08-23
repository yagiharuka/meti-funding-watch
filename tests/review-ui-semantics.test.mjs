import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const reviewPageSource = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
const reviewSearchSource = await readFile(new URL("../app/review/ReviewSearch.tsx", import.meta.url), "utf8");
const homeProgramSearchSource = await readFile(new URL("../app/HomeProgramSearch.tsx", import.meta.url), "utf8");
const reviewProgramLinkSource = await readFile(new URL("../app/review-program-link.ts", import.meta.url), "utf8");
const reviewHtmlSource = await readFile(new URL("../pages-site/review/index.html", import.meta.url), "utf8");
const tabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("exposes administrative review only as a separate non-aggregated series", () => {
  assert.match(tabsSource, /行政事業レビュー/);
  assert.match(reviewPageSource, /別の参考系列/);
  assert.match(reviewPageSource, /他系列ともレビュー内の異なる階層同士とも合算しません/);
  assert.match(reviewSearchSource, /他系列と合算不可/);
  assert.match(reviewSearchSource, /支出先の合計支出額/);
  assert.match(reviewHtmlSource, /行政事業レビュー/);
  assert.match(readme, /2つの主系列/);
  assert.match(readme, /行政事業レビュー/);
});

test("makes negative-search limitations visible instead of implying no funding", () => {
  assert.match(pageSource, /収録済みのGビズINFO掲載行では確認できませんでした/);
  assert.match(pageSource, /資金を受けていないという意味ではありません/);
  assert.match(officialPageSource, /照合結果は対象資料の全掲載行や、他の機関・年度を代表しません/);
  assert.doesNotMatch(reviewSearchSource, /否定検索には使えません/);
});

test("publishes a bounded reconciliation log without the review freshness warning", () => {
  assert.match(officialPageSource, /照合を試みた件数/);
  assert.match(officialPageSource, /未照合/);
  assert.doesNotMatch(officialPageSource, /収録率|網羅|カバレッジ/);
  assert.doesNotMatch(reviewSearchSource, /鮮度要確認/);
});

test("makes disclosed review routes understandable without legacy-cache wording", () => {
  assert.match(reviewSearchSource, /支出先企業を検索する欄と、資金経路上の支出元を絞る欄を分けています/);
  assert.match(reviewSearchSource, /資金経路で絞る（例：NEDO・中小機構）/);
  assert.match(reviewSearchSource, /\["NEDO", "IPA", "中小機構", "JOGMEC", "JETRO"\]/);
  assert.match(reviewSearchSource, /\{name\}を経由/);
  assert.match(reviewSearchSource, /NEDOや中小機構などが資金経路の途中にある案件/);
  assert.match(reviewSearchSource, /レビューシートCSVの経路情報/);
  assert.match(reviewSearchSource, /複数経路のため直接上流のみ表示/);
  assert.doesNotMatch(reviewSearchSource, /旧キャッシュから復元した経路|旧キャッシュから復元した一経路|旧公式CSVキャッシュから復元|旧キャッシュのためCSV行番号不明|公開経路上の位置/);
});

test("links a home program title to its exact review card instead of only the review page", () => {
  assert.match(homeProgramSearchSource, /className="program-detail-link"/);
  assert.match(homeProgramSearchSource, /reviewProgramHref\(getPublicBaseUrl\(\), row\.id\)/);
  assert.match(reviewProgramLinkSource, /searchParams\.set\(REVIEW_PROGRAM_PARAMETER, programId\)/);
  assert.match(reviewProgramLinkSource, /url\.hash = reviewProgramAnchorId\(programId\)/);
  assert.match(reviewSearchSource, /row\.id !== targetProgramId/);
  assert.match(reviewSearchSource, /id=\{reviewProgramAnchorId\(row\.id\)\}/);
  assert.match(reviewSearchSource, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(reviewSearchSource, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(reviewSearchSource, /aria-current=\{targetProgramId === row\.id \? "location"/);
});
