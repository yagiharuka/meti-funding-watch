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

test("公式補足は本省・エネ庁・中企庁・特許庁・NEDO・中小機構・JOGMEC・JETROの8機関を公開する", async () => {
  const index = await readJson("data/official-supplement-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.minFiscalYear, 2021);
  assert.deepEqual(index.sources.map((source) => source.id), ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro"]);
  assert.equal(index.recordCount, index.records.length);
  assert.ok(index.records.length > 0);
  assert.ok(index.records.some((row) => row.sourceId === "meti" && row.fiscalYear === 2021), "経産省本省の2021年度レコードが必要です");
  assert.ok(index.records.some((row) => row.sourceId === "anre"), "資源エネルギー庁の公式資料レコードが必要です");
  assert.ok(index.records.some((row) => row.sourceId === "smea"), "中小企業庁の公式資料レコードが必要です");
  assert.ok(index.records.some((row) => row.sourceId === "jpo"), "特許庁の公式資料レコードが必要です");
  assert.ok(index.records.some((row) => row.sourceId === "jogmec"), "JOGMECの確認済み入札結果が必要です");
  assert.ok(index.records.some((row) => row.sourceId === "jetro"), "JETROの確認済み入札結果が必要です");

  const allowed = new Set(["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro"]);
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

test("既知のNEDO・中小機構・JOGMEC・JETRO公式補足が保持される", async () => {
  const index = await readJson("data/official-supplement-index.json");
  const kyoto = index.records.find((row) => row.sourceId === "nedo" && row.corporateNumber === "6130001065395");
  assert.ok(kyoto);
  assert.equal(kyoto.amount, 499_000_000);
  assert.equal(kyoto.amountStage, "交付決定額");

  const pwc = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");
  assert.ok(pwc);
  assert.equal(pwc.amount, 220_000_000);
  assert.equal(pwc.amountStage, "契約金額");

  const jogmec = index.records.find((row) => row.sourceId === "jogmec" && row.corporateNumber === "4010001104241");
  assert.ok(jogmec);
  assert.equal(jogmec.amount, 22_682_889);
  assert.equal(jogmec.category, "bid_result");
  assert.equal(jogmec.amountStage, "落札金額（税抜）");
  assert.equal(jogmec.date, "2026-05-15");
  assert.match(jogmec.sourceUrl, /jogmec\.go\.jp\/content\/300801182\.pdf$/);

  const jetro = index.records.find((row) => row.sourceId === "jetro" && row.corporateNumber === "2011101056358");
  assert.ok(jetro);
  assert.equal(jetro.amount, 1_199_000_000);
  assert.equal(jetro.category, "bid_result");
  assert.equal(jetro.amountStage, "落札金額（税抜）");
  assert.equal(jetro.date, "2026-03-27");
  assert.equal(jetro.fiscalYear, 2025);
  assert.match(jetro.sourceUrl, /jetro\.go\.jp\/procurement\/bid\/fia\/9fa37fee0bb63a6f\.html$/);
});

test("Pages公開JSは公式補足UIだけを持ち、データはタブ選択時用の別ファイルにする", async () => {
  const assets = await readdir("dist-pages/assets");
  const javascript = await Promise.all(
    assets.filter((name) => name.endsWith(".js")).map((name) => readFile(`dist-pages/assets/${name}`, "utf8")),
  );
  const bundle = javascript.join("\n");
  assert.ok(bundle.includes("公式補足（本省・エネ庁・中企庁・特許庁・NEDO・中小機構・JOGMEC・JETRO）"));
  assert.ok(bundle.includes("2021年度以降を基本対象"));
  assert.ok(bundle.includes("入札結果"));
  assert.ok(!bundle.includes("京都フュージョニアリング株式会社"));
  assert.ok(!bundle.includes("PwCコンサルティング合同会社"));
  assert.ok(!bundle.includes("イー・アンド・イーソリューションズ株式会社"));
  assert.ok(!bundle.includes("株式会社NTTデータ・アイ"));
  const published = await readJson("dist-pages/data/official-supplement-index.json");
  assert.ok(published.records.some((row) => row.organization === "京都フュージョニアリング株式会社"));
  assert.ok(published.records.some((row) => row.organization === "PwCコンサルティング合同会社"));
  assert.ok(published.records.some((row) => row.organization === "イー・アンド・イーソリューションズ株式会社" && row.amountStage === "落札金額（税抜）"));
  assert.ok(published.records.some((row) => row.organization === "株式会社NTTデータ・アイ" && row.amountStage === "落札金額（税抜）"));
  assert.ok(published.records.some((row) => row.sourceId === "anre"));
  assert.ok(published.records.some((row) => row.sourceId === "smea"));
  assert.ok(published.records.some((row) => row.sourceId === "jpo"));
  assert.ok(published.records.some((row) => row.sourceId === "jogmec"));
  assert.ok(published.records.some((row) => row.sourceId === "jetro"));
});
