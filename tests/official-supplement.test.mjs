import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  assertOfficialGbizAbsence,
  programsLookSameForGapAudit,
} from "../scripts/official-gbiz-gap-audit.mjs";

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

test("公式補足は13機関を公開する", async () => {
  const index = await readJson("data/official-supplement-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.minFiscalYear, 2021);
  assert.deepEqual(index.sources.map((source) => source.id), ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"]);
  assert.equal(index.recordCount, index.records.length);
  assert.ok(index.records.length > 0);
  assert.ok(index.records.some((row) => row.sourceId === "meti" && row.fiscalYear === 2021), "経産省本省の2021年度レコードが必要です");
  for (const id of ["anre", "smea", "jpo", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"]) {
    assert.ok(index.records.some((row) => row.sourceId === id), `${id}: 確認済み公式補足が必要です`);
  }

  const allowed = new Set(["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"]);
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

test("GビズINFO欠落を収録条件にする公式補足は宣言ソースの全レコードを検証する", async () => {
  const result = await assertOfficialGbizAbsence();
  assert.deepEqual(result.sourceIds, ["rieti"]);
  assert.equal(result.declaredRecordCount, result.verifiedRecordCount);
  assert.ok(result.verifiedRecordCount >= 1);

  const rieti = await readJson("data/official-supplement-rieti.json");
  assert.equal(rieti.gbizAbsenceRequired, true);
  assert.match(rieti.coverageNote, /全レコードで機械検証/);
  assert.doesNotMatch(rieti.coverageNote, /2024年10月|1行を補足/);
});

test("GビズINFO欠落監査の案件名比較は年度表記差と限定的な追記を吸収する", () => {
  assert.equal(
    programsLookSameForGapAudit(
      "2024年度「海外直接投資における雇用調整に関する調査」",
      "海外直接投資における雇用調整に関する調査",
    ),
    true,
  );
  assert.equal(
    programsLookSameForGapAudit(
      "令和6年度 海外直接投資における雇用調整に関する調査",
      "海外直接投資における雇用調整に関する調査（追加分析を含む）",
    ),
    true,
  );
  assert.equal(programsLookSameForGapAudit("情報システム運用", "情報システム調査"), false);
});

test("既知のNEDO・中小機構・JOGMEC・JETRO・産総研・INPIT・NITE・IPA・RIETI公式補足が保持される", async () => {
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

  const aist = index.records.find((row) => row.sourceId === "aist" && row.corporateNumber === "9010501010505");
  assert.ok(aist);
  assert.equal(aist.amount, 28_282_100);
  assert.equal(aist.category, "contract_result");
  assert.equal(aist.amountStage, "契約金額（税込額）");
  assert.equal(aist.date, "2026-07-29");
  assert.match(aist.sourceUrl, /aist\.go\.jp\/aist_j\/procure\/supplyinfo\/pub\/detail\/RNN24EJU$/);

  const inpit = index.records.find((row) => row.sourceId === "inpit" && row.corporateNumber === "1030001125866");
  assert.ok(inpit);
  assert.equal(inpit.amount, 1_634_160);
  assert.equal(inpit.category, "contract_result");
  assert.equal(inpit.amountStage, "契約金額（調達予定総額）");
  assert.equal(inpit.date, "2025-04-03");
  assert.match(inpit.sourceUrl, /inpit\.go\.jp\/kobo\/contract_info\/r07\/r07kb000001\.pdf$/);

  const nite = index.records.find((row) => row.sourceId === "nite" && row.corporateNumber === "9010401018458");
  assert.ok(nite);
  assert.equal(nite.amount, 15_994_000);
  assert.equal(nite.category, "contract_result");
  assert.equal(nite.amountStage, "契約金額");
  assert.equal(nite.date, "2025-08-01");
  assert.match(nite.sourceUrl, /nite\.go\.jp\/data\/000159026\.pdf$/);

  const ipa = index.records.find((row) => row.sourceId === "ipa" && row.corporateNumber === "7010001088960");
  assert.ok(ipa);
  assert.equal(ipa.amount, 44_000_000);
  assert.equal(ipa.category, "contract_result");
  assert.equal(ipa.amountStage, "契約金額");
  assert.equal(ipa.date, "2023-10-03");
  assert.equal(ipa.program, "Society5.0を実現するためのスキル標準の改訂等業務");
  assert.match(ipa.sourceUrl, /ipa\.go\.jp\/archive\/choutatsu\/zuikei\/.+\/keiyaku202310\.pdf$/);

  const rieti = index.records.find((row) => row.sourceId === "rieti" && row.corporateNumber === "7010401018377");
  assert.ok(rieti);
  assert.equal(rieti.amount, 6_516_571);
  assert.equal(rieti.category, "contract_result");
  assert.equal(rieti.amountStage, "契約金額");
  assert.equal(rieti.date, "2024-10-08");
  assert.equal(rieti.program, "2024年度「海外直接投資における雇用調整に関する調査」");
  assert.match(rieti.sourceUrl, /rieti\.go\.jp\/jp\/about\/competitive_bid\/pdf\/2410\.pdf$/);
});

test("Pages公開JSは公式補足UIだけを持ち、データは別ファイルにする", async () => {
  const assets = await readdir("dist-pages/assets");
  const javascript = await Promise.all(
    assets.filter((name) => name.endsWith(".js")).map((name) => readFile(`dist-pages/assets/${name}`, "utf8")),
  );
  const bundle = javascript.join("\n");
  assert.ok(bundle.includes("公式補足"));
  assert.ok(bundle.includes("2021年度以降を基本対象"));
  assert.ok(bundle.includes("入札結果"));
  for (const name of ["京都フュージョニアリング株式会社", "PwCコンサルティング合同会社", "イー・アンド・イーソリューションズ株式会社", "株式会社NTTデータ・アイ", "日本電計株式会社", "株式会社テストイベント企画", "株式会社DTS", "デロイトトーマツコンサルティング合同会社", "株式会社帝国データバンク"]) {
    assert.ok(!bundle.includes(name), `${name}: 明細はJS bundleへ埋め込まない`);
  }
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
  assert.ok(published.records.some((row) => row.sourceId === "aist" && row.organization === "日本電計株式会社"));
  assert.ok(published.records.some((row) => row.sourceId === "inpit" && row.amountStage === "契約金額（調達予定総額）"));
  assert.ok(published.records.some((row) => row.sourceId === "nite" && row.organization === "株式会社DTS"));
  assert.ok(published.records.some((row) => row.sourceId === "ipa" && row.organization === "デロイトトーマツコンサルティング合同会社"));
  assert.ok(published.records.some((row) => row.sourceId === "rieti" && row.organization === "株式会社帝国データバンク"));
});
