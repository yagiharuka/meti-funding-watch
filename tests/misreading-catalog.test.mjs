import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { validateCatalogPassage } from "../scripts/check-misreading-catalog-pr.mjs";

const AUDIT_DIMENSIONS = [
  "検索・名寄せ",
  "0件・欠落",
  "金額・集計",
  "時点・年度",
  "受取主体・資金経路",
  "系列間比較",
  "出典・鮮度",
  "UI失敗時",
];

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function catalogRows(source) {
  return source
    .split("\n")
    .filter((line) => /^\| M-\d{3} \|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

function referencedPaths(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

async function assertPathsExist(id, column, paths) {
  assert.ok(paths.length > 0, `${id}: ${column} must contain at least one repository path`);
  for (const path of paths) {
    assert.match(path, /^(?:app|data|pages-site|scripts|tests)\//, `${id}: ${column} must use a repository-relative path`);
    await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), `${id}: ${column} path does not exist: ${path}`);
  }
}

test("misreading catalog is the explicit audit entrypoint", async () => {
  const [catalog, template] = await Promise.all([
    text("../docs/MISREADING_CATALOG.md"),
    text("../.github/pull_request_template.md"),
  ]);

  assert.match(catalog, /コードを直す前にまずこの表へ行を追加または更新/);
  assert.match(catalog, /このカタログの網羅性を批判してください/);
  assert.match(catalog, /カタログ差分がない場合.*該当なし：<理由>/);
  for (const dimension of AUDIT_DIMENSIONS) assert.match(catalog, new RegExp(dimension));

  assert.match(template, /実装より先に `docs\/MISREADING_CATALOG\.md` を確認した/);
  assert.match(template, /docs\/MISREADING_CATALOG\.md/);
  assert.match(template, /該当なし：<理由>/);
  assert.match(template, /網羅性を批判してください/);
});

test("every audit dimension has at least one concrete catalog row", async () => {
  const rows = catalogRows(await text("../docs/MISREADING_CATALOG.md"));
  assert.ok(rows.length >= 22, "catalog must cover the known audit findings and newly exposed gaps");
  const rowDimensions = new Set(rows.map((row) => row[1]));
  for (const dimension of AUDIT_DIMENSIONS) {
    assert.ok(rowDimensions.has(dimension), `${dimension}: audit dimension must have at least one catalog row`);
  }
  for (const row of rows) {
    assert.ok(AUDIT_DIMENSIONS.includes(row[1]), `${row[0]}: unknown audit dimension ${row[1]}`);
  }
});

test("every catalog row enforces its state contract against real repository paths", async () => {
  const rows = catalogRows(await text("../docs/MISREADING_CATALOG.md"));
  const ids = rows.map((row) => row[0]);
  assert.equal(new Set(ids).size, ids.length, "catalog IDs must be unique");

  for (const row of rows) {
    const [id, , , , , mitigation, location, coverage, state] = row;
    assert.ok(["OPEN", "MITIGATED", "INHERENT"].includes(state), `${id}: unknown state ${state}`);
    if (state === "OPEN") {
      assert.equal(mitigation, "—", `${id}: OPEN must not pretend to have a mitigation`);
      assert.equal(location, "—", `${id}: OPEN must not pretend to have an implementation location`);
      assert.equal(coverage, "—", `${id}: OPEN must not pretend to have a test`);
      continue;
    }
    assert.notEqual(mitigation, "—", `${id}: ${state} must describe the current mitigation or source constraint`);
    await assertPathsExist(id, "所在", referencedPaths(location));
    if (state === "MITIGATED") await assertPathsExist(id, "テスト", referencedPaths(coverage));
    else if (coverage !== "—") await assertPathsExist(id, "テスト", referencedPaths(coverage));
  }
});

test("PR catalog gate requires an explicit no-impact reason when the catalog is unchanged", () => {
  const blank = validateCatalogPassage({
    body: "## 誤読カタログ\n\n### このPRが触るカタログID\n\n<!-- 該当なしの場合は理由を書く -->\n\n## レビュー依頼",
    changedFiles: ["app/page.tsx"],
  });
  assert.equal(blank.ok, false);

  const noReason = validateCatalogPassage({
    body: "### このPRが触るカタログID\n\n該当なし：\n\n## レビュー依頼",
    changedFiles: ["app/page.tsx"],
  });
  assert.equal(noReason.ok, false);

  const explained = validateCatalogPassage({
    body: "### このPRが触るカタログID\n\n該当なし：表示余白だけの変更で、データの意味と導線は変えない。\n\n## レビュー依頼",
    changedFiles: ["app/globals.css"],
  });
  assert.equal(explained.ok, true);
  assert.equal(explained.reason, "explicit-no-impact");

  const catalogUpdated = validateCatalogPassage({
    body: "",
    changedFiles: ["docs/MISREADING_CATALOG.md", "app/review/ReviewSearch.tsx"],
  });
  assert.equal(catalogUpdated.ok, true);
  assert.equal(catalogUpdated.reason, "catalog-updated");
});
