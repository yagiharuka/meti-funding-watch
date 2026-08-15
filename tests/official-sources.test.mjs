import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = JSON.parse(
  await readFile(new URL("../data/official-source-registry.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const searchSource = await readFile(new URL("../app/official/OfficialSearch.tsx", import.meta.url), "utf8");
const viewTabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const updaterSource = await readFile(new URL("../scripts/update-official-data.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));

test("registers all 13 direct executors and both official source categories", () => {
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.executors.length, 13);
  assert.equal(new Set(registry.executors.map((item) => item.id)).size, 13);
  assert.equal(registry.collectionStatus.registeredEndpoints, 26);
  assert.equal(registry.collectionStatus.fullyReconciledCells, 0);
  assert.equal("searchableSeriesCells" in registry.collectionStatus, false);
  assert.equal("searchableRecords" in registry.collectionStatus, false);
  assert.equal("searchableExecutors" in registry.collectionStatus, false);
  assert.equal(registry.collectionStatus.status, "partial_detail");

  const expected = [
    "meti", "anre", "smea", "jpo", "hokkaido", "tohoku", "kanto",
    "chubu", "kansai", "chugoku", "shikoku", "kyushu", "okinawa",
  ];
  assert.deepEqual(registry.executors.map((item) => item.id), expected);
  for (const executor of registry.executors) {
    assert.ok(executor.name);
    for (const field of ["contracts", "grantDecisions"]) {
      const url = new URL(executor[field]);
      assert.equal(url.protocol, "https:");
      assert.ok(
        url.hostname === "www.meti.go.jp"
        || url.hostname.endsWith(".meti.go.jp")
        || url.hostname === "www.jpo.go.jp"
        || url.hostname === "www.ogb.go.jp",
        `${executor.id}/${field}: unexpected official host ${url.hostname}`,
      );
    }
  }
});

test("keeps contract, grant-decision, Gbiz, and payment meanings separate", () => {
  assert.equal(registry.series.contracts.amountStage, "契約額");
  assert.equal(registry.series.grantDecisions.amountStage, "交付決定額");
  assert.match(registry.series.contracts.notIncluded, /実支払/);
  assert.match(registry.series.grantDecisions.notIncluded, /実支払/);
  assert.match(pageSource, /GビズINFOの掲載値とも合算しません/);
  assert.match(pageSource, /リンクだけの資料は収録済みと数えていません/);
  assert.match(pageSource, /取得・形式検証できず未収録の登録資料/);
  assert.match(pageSource, /部分収録：登録資料/);
  assert.match(pageSource, /検索に使用する資料/);
  assert.match(pageSource, /今回取得・検証/);
  assert.match(pageSource, /前回検証済み明細を継続/);
  assert.match(pageSource, /未取得候補/);
  assert.match(pageSource, /fallbackSourceDocumentCount/);
  assert.match(pageSource, /ライブ取得に失敗し、前回公開明細との完全一致を検証したWARP保存資料を使用/);
  assert.match(pageSource, /ライブ取得失敗後に検証済みWARP保存資料を使用/);
  assert.match(pageSource, /取得バイト・SHA-256・明細数と、前回公開した全明細の内容・識別子が一致した場合だけ使用/);
  assert.match(pageSource, /fallbackSourceCount !== fallbackSources\.length/);
  assert.match(pageSource, /carryForwardSourceDocumentCount/);
  assert.match(pageSource, /carryForwardSourceCount !== carryForwardSources\.length/);
  assert.match(pageSource, /source\.fallbackUsed && source\.carryForwardUsed/);
  assert.match(pageSource, /資料取得失敗後に前回検証済み明細を継続使用/);
  assert.match(pageSource, /前回公開manifestと明細ファイルのハッシュ・行数、資料ID・原本URL・資料定義・資料別明細数を再検証/);
  assert.match(pageSource, /WARP保存資料がHTTP 403/);
  assert.match(pageSource, /新しい内容を取得済みとは扱いません/);
  assert.match(pageSource, /最終正常取得/);
  assert.match(pageSource, /function fallbackFailureLabel/);
  assert.match(pageSource, /ライブURLが0バイト応答/);
  assert.doesNotMatch(pageSource, /sourceFailureLabel\(source\.primaryFailureReasonCode/);
  assert.match(pageSource, /全年度・全区分を完全照合済み/);
  assert.match(pageSource, /missingYears\.join\("・"\)/);
  assert.match(pageSource, /新年度・新URL・新機関は自動発見せず/);
  assert.match(pageSource, /明細収録の分母ではありません/);
  assert.match(pageSource, /years\.join\("・"\)/);
  assert.match(pageSource, /収録年度は機関・系列ごとに異なり、全体では/);
  assert.match(pageSource, /契約.*detail\.contractResults\.records.*未収録/s);
  assert.match(pageSource, /交付決定.*detail\.grantDecisions\.records.*未収録/s);
  assert.match(pageSource, /detail\.fiscalYears\.join\("・"\)/);
  assert.doesNotMatch(pageSource, /years\[0\].*years\[years\.length - 1\]/s);
  assert.match(updaterSource, /years\.join\("・"\).*年度/);
  assert.match(pageSource, /失敗した新規候補を0件資料とは扱わず/);
  assert.match(pageSource, /前回公開済み資料の再検証に失敗した場合は、公式明細全体の更新を停止/);
  assert.match(pageSource, /明細未収録/);
  assert.match(pageSource, /再委託先、間接補助先、基金・所管法人からの下流支出/);
  assert.doesNotMatch(pageSource, /実支払額です|最終受益者です|全件収録済み/);
  assert.match(searchSource, /公式資料の明細検索/);
  assert.match(searchSource, /交付先・契約相手、法人番号、事業名で検索/);
  assert.match(searchSource, /13執行機関・全年度・全公表区分の完全収録ではなく/);
  assert.match(searchSource, /公式HTML・XLSX・文字PDF/);
  assert.match(searchSource, /備考：/);
  assert.match(searchSource, /掲載値は法人別に配賦できません/);
  assert.match(searchSource, /row\.notes/);
  assert.equal(manifest.recordCount, Object.values(manifest.coverage.executors).reduce(
    (sum, executor) => sum + executor.contractResults.records + executor.grantDecisions.records,
    0,
  ));
  const fallbackSources = (manifest.sourceDocuments ?? []).filter((source) => source.fallbackUsed);
  assert.equal(manifest.coverage.fallbackSourceDocumentCount ?? fallbackSources.length, fallbackSources.length);
  const carryForwardSources = (manifest.sourceDocuments ?? []).filter((source) => source.carryForwardUsed);
  assert.equal(manifest.coverage.carryForwardSourceDocumentCount ?? carryForwardSources.length, carryForwardSources.length);
  if (manifest.coverage.fiscalYears) {
    assert.ok(manifest.coverage.fiscalYears.length > 1);
    assert.match(pageSource, /manifest\.coverage|coverage\.fiscalYears/);
  }
  assert.doesNotMatch(searchSource, /合計額|総支払額|実支払額です/);
});

test("adds the official catalog and review series as separate visible tabs without restoring Mirasapo", () => {
  assert.match(viewTabsSource, /契約結果・交付決定/);
  assert.match(viewTabsSource, /経産省・各機関の公式資料/);
  assert.match(viewTabsSource, /行政事業レビュー/);
  assert.match(viewTabsSource, /事業・予算執行・支出先/);
  assert.doesNotMatch(viewTabsSource, /補助金採択者情報（中小企業庁のみ）|href=.*adoptions\//);
  assert.match(pageSource, /公式契約結果・補助金交付決定/);
  assert.match(pageSource, /4系列の違い/);
  assert.match(pageSource, /機関×年度×系列の検索収録/);
});
