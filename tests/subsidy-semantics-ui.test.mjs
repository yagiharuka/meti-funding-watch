import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Pages UI suppresses cross-row subsidy totals and explains the data semantics", async () => {
  const [source, entrypoint] = await Promise.all([
    readFile(new URL("../pages-site/subsidy-semantics-ui.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/main.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(source, /交付決定・確定等が別行/);
  assert.match(source, /執行団体・事務局等への交付原資/);
  assert.match(source, /掲載法人自身の収益・最終受益額を示すものではありません/);
  assert.match(source, /合計しません/);
  assert.match(source, /個別の掲載額は明細で確認/);
  assert.match(source, /認定日が空欄/);
  assert.match(source, /年度別件数は資金額・採択件数の推移を示しません/);
  assert.match(source, /csvEligibleSubsidyCount/);
  assert.match(source, /unclassifiedDateCount/);
  assert.match(source, /stage === "contracted"/);
  assert.match(source, /\.stage-badge\.subsidy_published/);
  assert.match(source, /認定日・受注日の年度/);
  assert.match(source, /事業別を見る/);
  assert.match(entrypoint, /subsidy-semantics-ui\.css/);
  assert.match(entrypoint, /subsidy-semantics-ui/);
});

test("subsidy semantics guardrail leaves detail-row amounts available", async () => {
  const source = await readFile(new URL("../pages-site/subsidy-semantics-ui.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /company-search-detail-table[^\n]*replaceCell/);
  assert.doesNotMatch(source, /company-search-detail-table[^\n]*textContent\s*=\s*"合計しません"/);
});
