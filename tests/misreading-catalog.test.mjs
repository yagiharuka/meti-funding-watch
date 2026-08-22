import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function catalogRows(source) {
  return source
    .split("\n")
    .filter((line) => /^\| M-\d{3} \|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

test("misreading catalog is the explicit audit entrypoint", async () => {
  const [catalog, template] = await Promise.all([
    text("../docs/MISREADING_CATALOG.md"),
    text("../.github/pull_request_template.md"),
  ]);

  assert.match(catalog, /コードを直す前にまずこの表へ行を追加または更新/);
  assert.match(catalog, /このカタログの網羅性を批判してください/);
  for (const dimension of [
    "検索・名寄せ",
    "0件・欠落",
    "金額・集計",
    "時点・年度",
    "受取主体・資金経路",
    "系列間比較",
    "出典・鮮度",
    "UI失敗時",
  ]) assert.match(catalog, new RegExp(dimension));

  assert.match(template, /実装より先に `docs\/MISREADING_CATALOG\.md` を確認した/);
  assert.match(template, /docs\/MISREADING_CATALOG\.md/);
  assert.match(template, /網羅性を批判してください/);
});

test("catalog keeps unresolved risks visibly unresolved", async () => {
  const rows = catalogRows(await text("../docs/MISREADING_CATALOG.md"));
  assert.ok(rows.length >= 14, "initial catalog must cover the known audit findings");

  const ids = rows.map((row) => row[0]);
  assert.equal(new Set(ids).size, ids.length, "catalog IDs must be unique");

  const byId = new Map(rows.map((row) => [row[0], row]));
  for (const id of ["M-001", "M-008"]) {
    const row = byId.get(id);
    assert.ok(row, `${id} must exist`);
    assert.equal(row[4], "—", `${id} must not pretend to have a mitigation`);
    assert.equal(row[5], "—", `${id} must not pretend to have an implementation location`);
    assert.equal(row[6], "—", `${id} must not pretend to have a test`);
    assert.equal(row[7], "OPEN");
  }

  for (const id of ["M-003", "M-004", "M-005", "M-006", "M-009", "M-010", "M-011"]) {
    const row = byId.get(id);
    assert.ok(row, `${id} must exist`);
    assert.equal(row[7], "MITIGATED");
    assert.notEqual(row[4], "—");
    assert.notEqual(row[5], "—");
    assert.notEqual(row[6], "—");
  }
});
