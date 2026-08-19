import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/g, "株式会社")
    .replace(/\(有\)|㈲/g, "有限会社")
    .replace(/[\s　]+/g, " ")
    .toLocaleLowerCase("ja-JP")
    .trim();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("公式補足は経産省本省・NEDO・中小機構の3機関だけを公開する", async () => {
  const index = await readJson("data/official-supplement-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.minFiscalYear, 2021);
  assert.deepEqual(index.sources.map((source) => source.id), ["meti", "nedo", "smrj"]);
  assert.equal(index.recordCount, index.records.length);
  assert.ok(index.records.length > 0);
  assert.ok(index.records.some((row) => row.sourceId === "meti" && row.fiscalYear === 2021), "経産省本省の2021年度レコードが必要です");

  const allowed = new Set(["meti", "nedo", "smrj"]);
  for (const row of index.records) {
    assert.ok(allowed.has(row.sourceId), `unexpected source: ${row.sourceId}`);
    assert.ok(Number.isInteger(row.fiscalYear) && row.fiscalYear >= 2021, `${row.id}: fiscal year`);
    assert.ok(Number.isSafeInteger(row.amount), `${row.id}: amount`);
    assert.ok(row.organization, `${row.id}: organization`);
    assert.match(row.sourceUrl, /^https:\/\//, `${row.id}: source URL`);
    assert.equal(
      row.searchText,
      normalize([row.organization, row.corporateNumber].filter(Boolean).join(" ")),
      `${row.id}: company search must not include program or source name`,
    );
  }

  for (const source of index.sources) {
    const count = index.records.filter((row) => row.sourceId === source.id).length;
    assert.equal(source.recordCount, count, `${source.id}: source count`);
    assert.ok(count > 0, `${source.id}: expected at least one verified record`);
    assert.ok(source.coverageNote.includes("網羅") || source.coverageNote.includes("全"), `${source.id}: coverage limitation must be explicit`);
  }
});

test("既知のNEDO・中小機構公式補足が保持される", async () => {
  const index = await readJson("data/official-supplement-index.json");
  const kyoto = index.records.find((row) => row.sourceId === "nedo" && row.corporateNumber === "6130001065395");
  assert.ok(kyoto);
  assert.equal(kyoto.amount, 499_000_000);
  assert.equal(kyoto.amountStage, "交付決定額");

  const pwc = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");
  assert.ok(pwc);
  assert.equal(pwc.amount, 220_000_000);
  assert.equal(pwc.amountStage, "契約金額");
});

test("Pages公開JSに3機関の公式補足UIとデータがバンドルされる", async () => {
  const assets = await readdir("dist-pages/assets");
  const javascript = await Promise.all(
    assets.filter((name) => name.endsWith(".js")).map((name) => readFile(`dist-pages/assets/${name}`, "utf8")),
  );
  const bundle = javascript.join("\n");
  assert.ok(bundle.includes("公式補足（経産省本省・NEDO・中小機構）"));
  assert.ok(bundle.includes("2021年度以降を基本対象"));
  assert.ok(bundle.includes("京都フュージョニアリング株式会社"));
  assert.ok(bundle.includes("PwCコンサルティング合同会社"));
});
