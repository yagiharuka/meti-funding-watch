import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("subsidy guardrail contracts are anchored to the real render sources", async () => {
  const [app, company, guide, guard, css] = await Promise.all([
    read("../app/page.tsx"),
    read("../pages-site/company-search-ui.ts"),
    read("../app/DataReadingGuide.tsx"),
    read("../pages-site/subsidy-semantics-ui.ts"),
    read("../pages-site/subsidy-semantics-ui.css"),
  ]);

  // app/page.tsx is still the React-owned summary that the small compatibility guard patches.
  assert.match(app, /aria-label="企業検索結果サマリー"/);
  assert.match(app, /<th>情報種別<\/th><th>掲載行<\/th><th>掲載値合計<\/th>/);
  assert.match(app, /stage-badge \$\{item\.stage\}/);
  assert.match(app, /<th>直近5年度<\/th>/);
  assert.match(app, /掲載行の多い活動名称・件名/);

  // Company cards display same-corporation subsidy published amounts while keeping cross-corporation aggregation blocked.
  assert.doesNotMatch(company, /合計しません/);
  assert.doesNotMatch(company, /個別の掲載額は明細で確認/);
  assert.match(company, /認定日・受注日の年度/);
  assert.match(company, /補助金（掲載行／重複候補除外後）/);
  assert.match(company, /subsidy_published\.amountIncludedCount/);
  assert.match(company, /重複掲載とみなして除外/);
  assert.match(company, /事業別を見る/);
  assert.match(company, /href="#data-reading-guide">↓ 読み方/);
  assert.doesNotMatch(company, /subsidySemanticsNote|subsidy-semantics-note/);
  assert.doesNotMatch(company, /金額の大きい事業を見る/);

  // Explanatory semantics live in the one folded guide below the cross-series results.
  assert.match(guide, /id="data-reading-guide"/);
  assert.match(guide, /このデータの読み方/);
  assert.match(guide, /同一または近似する事業名かつ掲載額差が±0\.1%以内/);
  assert.match(guide, /明細には元の全掲載行を残します/);
  assert.match(guide, /掲載法人自身の収益・最終受益額を示すものではありません/);
  assert.match(guide, /別レビューシート年度に再掲/);
  assert.match(guide, /相互に合算しません/);
  assert.match(guide, /経路が表示されないことは、実際に資金経路が存在しないことを意味しません/);

  // The remaining React compatibility layer fails closed and isolates the conditional year warning.
  assert.match(guard, /runGuarded\("summary", patchReactSummary\)/);
  assert.match(guard, /runGuarded\("year-warning", renderYearWarning\)/);
  assert.doesNotMatch(guard, /renderSemanticsNote|SUBSIDY_NOTE|runGuarded\("note"/);
  assert.doesNotMatch(guard, /patchCompanyExperience/);
  assert.doesNotMatch(guard, /replaceCell|合計しません|個別の掲載額は明細で確認|row\.children\.length !== 3/);
  assert.match(guard, /setText\(headers\[2\], "掲載値合計"\)/);
  assert.match(guard, /subsidy-semantics-ready/);
  assert.match(css, /\[aria-label="企業検索結果サマリー"\] tbody tr \{\s*visibility: hidden;/s);
  assert.match(css, /\.subsidy-semantics-ready tbody tr \{\s*visibility: visible;/s);
  assert.doesNotMatch(css, /subsidy-semantics-note|:has\(/);
});

test("a broken React-summary contract cannot suppress the conditional year warning", async () => {
  let source = await read("../pages-site/subsidy-semantics-ui.ts");
  source = source.replace(
    'import fundingSummary from "@/data/funding-summary.json";',
    "const fundingSummary = globalThis.__fundingSummary;",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;

  const listeners = new Map();
  const frames = [];
  const children = [];
  const errors = [];

  const mount = {
    querySelector(selector) {
      if (selector.includes("subsidy-year-warning")) {
        return children.find((child) => child.className.includes("subsidy-year-warning")) ?? null;
      }
      return null;
    },
    prepend(child) {
      child.parentElement = mount;
      children.unshift(child);
    },
  };

  const document = {
    documentElement: {},
    querySelector(selector) {
      if (selector === '[aria-label="企業検索結果サマリー"]') {
        throw new Error("simulated render contract break");
      }
      return null;
    },
    getElementById(id) {
      return id === "company-search-mount" ? mount : null;
    },
    createElement() {
      return {
        className: "",
        textContent: "",
        parentElement: null,
        remove() {
          const index = children.indexOf(this);
          if (index >= 0) children.splice(index, 1);
        },
      };
    },
  };

  const context = {
    __fundingSummary: {
      sources: [{ id: "gbiz", csvEligibleSubsidyCount: 51_375 }],
      coverage: { gbiz: { unclassifiedDateCount: 39_665 } },
    },
    URLSearchParams,
    document,
    window: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
    MutationObserver: class MutationObserver { observe() {} },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    console: {
      error(...args) { errors.push(args); },
    },
  };

  vm.runInNewContext(javascript, context, { filename: "subsidy-semantics-ui.js" });
  while (frames.length) frames.shift()();

  assert.ok(errors.length >= 1, "broken summary contract should be surfaced to console.error");

  const listener = listeners.get("meti-funding-search-result");
  assert.ok(listener);
  listener({ detail: { parameters: new URLSearchParams({ q: "テスト", year: "2024", stage: "all" }).toString() } });
  while (frames.length) frames.shift()();

  const warning = children.find((child) => child.className.includes("subsidy-year-warning"));
  assert.ok(warning, "year warning must survive a summary-patch failure");
  assert.match(warning.textContent, /51,375行/);
  assert.match(warning.textContent, /39,665行/);
  assert.match(warning.textContent, /77\.2%/);
});
