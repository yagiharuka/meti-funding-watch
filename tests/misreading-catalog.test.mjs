import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("misreading catalog is the explicit audit entrypoint", async () => {
  const [catalog, template] = await Promise.all([
    text("../docs/MISREADING_CATALOG.md"),
    text("../.github/pull_request_template.md"),
  ]);

  assert.match(catalog, /コードを直す前にまずこの表へ行を追加または更新/);
  assert.match(catalog, /このカタログの網羅性を批判してください/);
  for (const dimension of AUDIT_DIMENSIONS) assert.match(catalog, new RegExp(dimension));

  assert.match(template, /実装より先に `docs\/MISREADING_CATALOG\.md` を確認した/);
  assert.match(template, /docs\/MISREADING_CATALOG\.md/);
  assert.match(template, /網羅性を批判してください/);
});

test("every audit dimension has at least one concrete catalog row", async () => {
  const rows = catalogRows(await text("../docs/MISREADING_CATALOG.md"));
  assert.ok(rows.length >= 21, "catalog must cover the known audit findings and newly exposed gaps");
  const rowDimensions = new Set(rows.map((row) => row[1]));
  for (const dimension of AUDIT_DIMENSIONS) {
    assert.ok(rowDimensions.has(dimension), `${dimension}: audit dimension must have at least one catalog row`);
  }
  for (const row of rows) {
    assert.ok(AUDIT_DIMENSIONS.includes(row[1]), `${row[0]}: unknown audit dimension ${row[1]}`);
  }
});

test("catalog keeps unresolved risks visibly unresolved and records mitigations", async () => {
  const rows = catalogRows(await text("../docs/MISREADING_CATALOG.md"));
  const ids = rows.map((row) => row[0]);
  assert.equal(new Set(ids).size, ids.length, "catalog IDs must be unique");

  const byId = new Map(rows.map((row) => [row[0], row]));
  for (const id of ["M-008", "M-020", "M-021"]) {
    const open = byId.get(id);
    assert.ok(open, `${id} must exist`);
    assert.equal(open[5], "—", `${id} must not pretend to have a mitigation`);
    assert.equal(open[6], "—", `${id} must not pretend to have an implementation location`);
    assert.equal(open[7], "—", `${id} must not pretend to have a test`);
    assert.equal(open[8], "OPEN");
  }

  for (const id of ["M-001", "M-003", "M-004", "M-005", "M-006", "M-009", "M-010", "M-011", "M-015", "M-016", "M-017", "M-018", "M-019"]) {
    const row = byId.get(id);
    assert.ok(row, `${id} must exist`);
    assert.equal(row[8], "MITIGATED");
    assert.notEqual(row[5], "—");
    assert.notEqual(row[6], "—");
    assert.notEqual(row[7], "—");
  }
});
