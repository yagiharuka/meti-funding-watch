import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterCompanyEntities } from "../scripts/company-search.mjs";

async function text(path) {
  return readFile(path, "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

test("official company index uses central bodies only with a FY2017 target floor", async () => {
  const index = await json("public/data/official-company-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.minFiscalYear, 2017);
  assert.equal(index.recordCount, index.records.length);
  assert.equal(index.sourceCount, index.sources.length);
  assert.ok(index.recordCount > 10_000, "central company index should use the committed official corpus, not only seed sources");

  const sourceIds = new Set(index.sources.map((source) => source.id));
  assert.deepEqual([...sourceIds], ["meti", "anre", "smea", "jpo", "nedo", "smrj", "jogmec", "jetro", "aist", "inpit", "nite", "ipa", "rieti"]);
  for (const excluded of ["hokkaido", "tohoku", "kanto", "chubu", "kansai", "chugoku", "shikoku", "kyushu", "okinawa"]) {
    assert.equal(sourceIds.has(excluded), false, `${excluded} must not be in the company official search`);
    assert.ok(index.excludedExecutors.includes(excluded), `${excluded} must be explicitly excluded`);
    assert.equal(index.records.some((row) => row.sourceId === excluded), false, `${excluded} rows must not be published in the company index`);
  }
  assert.match(index.scopeNote, /2017年度以降を対象方針/);
  assert.match(index.scopeNote, /JOGMEC/);
  assert.match(index.scopeNote, /JETRO/);
  assert.match(index.scopeNote, /産業技術総合研究所/);
  assert.match(index.scopeNote, /INPIT/);
  assert.match(index.scopeNote, /NITE/);
  assert.match(index.scopeNote, /IPA/);
  assert.match(index.scopeNote, /RIETI/);
  assert.match(index.scopeNote, /地方経済産業局・沖縄総合事務局は企業検索の対象外/);
  assert.match(index.scopeNote, /見つからないことは支出がないことを意味しない/);
  assert.match(index.scopeNote, /相互に合算しない/);

  for (const source of index.sources) {
    assert.ok(source.recordCount > 0, `${source.id}: source must contribute at least one row`);
    assert.ok(Array.isArray(source.fiscalYears), `${source.id}: actual years must be explicit`);
    assert.match(source.coverageNote, /全|網羅|収録|対象方針|確認済み/, `${source.id}: source coverage limitation must be explicit`);
  }

  const nedo = index.records.find((row) => row.sourceId === "nedo" && row.corporateNumber === "6130001065395");
  assert.ok(nedo, "known NEDO company record must remain searchable");
  const smrj = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");
  assert.ok(smrj, "known SMRJ company record must remain searchable");
  const jogmec = index.records.find((row) => row.sourceId === "jogmec" && row.corporateNumber === "4010001104241");
  assert.ok(jogmec, "known JOGMEC bid-result record must remain searchable");
  assert.equal(jogmec.category, "bid_result");
  assert.equal(jogmec.amountStage, "落札金額（税抜）");
  assert.equal(jogmec.amount, 22_682_889);
  const jetro = index.records.find((row) => row.sourceId === "jetro" && row.corporateNumber === "2011101056358");
  assert.ok(jetro, "known JETRO bid-result record must remain searchable");
  assert.equal(jetro.category, "bid_result");
  assert.equal(jetro.amountStage, "落札金額（税抜）");
  assert.equal(jetro.amount, 1_199_000_000);
  const aist = index.records.find((row) => row.sourceId === "aist" && row.corporateNumber === "9010501010505");
  assert.ok(aist, "known AIST contract result must remain searchable");
  assert.equal(aist.category, "contract_result");
  assert.equal(aist.amountStage, "契約金額（税込額）");
  assert.equal(aist.amount, 28_282_100);
  const inpit = index.records.find((row) => row.sourceId === "inpit" && row.corporateNumber === "1030001125866");
  assert.ok(inpit, "known INPIT planned-total contract result must remain searchable");
  assert.equal(inpit.category, "contract_result");
  assert.equal(inpit.amountStage, "契約金額（調達予定総額）");
  assert.equal(inpit.amount, 1_634_160);
  const nite = index.records.find((row) => row.sourceId === "nite" && row.corporateNumber === "9010401018458");
  assert.ok(nite, "known NITE contract result must remain searchable");
  assert.equal(nite.category, "contract_result");
  assert.equal(nite.amountStage, "契約金額");
  assert.equal(nite.amount, 15_994_000);
  const ipa = index.records.find((row) => row.sourceId === "ipa" && row.corporateNumber === "7010001088960");
  assert.ok(ipa, "known IPA official-only contract result must remain searchable");
  assert.equal(ipa.category, "contract_result");
  assert.equal(ipa.amountStage, "契約金額");
  assert.equal(ipa.amount, 44_000_000);
  assert.equal(ipa.program, "Society5.0を実現するためのスキル標準の改訂等業務");
  const rieti = index.records.find((row) => row.sourceId === "rieti" && row.corporateNumber === "7010401018377");
  assert.ok(rieti, "known RIETI official-only contract result must remain searchable");
  assert.equal(rieti.category, "contract_result");
  assert.equal(rieti.amountStage, "契約金額");
  assert.equal(rieti.amount, 6_516_571);
  assert.equal(rieti.program, "2024年度「海外直接投資における雇用調整に関する調査」");

  const jointRows = index.records.filter((row) => Array.isArray(row.organizations) && row.organizations.length > 1);
  assert.ok(jointRows.length > 0, "joint-recipient rows from the official corpus must survive index generation");
  const sample = jointRows[0];
  for (const participant of sample.organizations) {
    assert.deepEqual(
      filterCompanyEntities([sample], participant).map((row) => row.id),
      [sample.id],
      `${participant}: joint official row must be reachable by the participant name`,
    );
  }
});

test("company evidence UI requires corporation selection for ambiguous names", async () => {
  const source = await text("pages-site/company-evidence-ui.ts");
  const style = await text("pages-site/company-evidence-ui.css");
  const entry = await text("pages-site/main.tsx");

  assert.match(source, /法人を選んでください/);
  assert.match(source, /法人を選ぶと、その法人番号だけで3系列を確認します/);
  assert.match(source, /if \(!exact && organizations\.length > 1\)/);
  assert.match(source, /button\.dataset\.corp = organization\.corporateNumber/);
  assert.match(style, /company-selection-required/);
  assert.match(entry, /company-evidence-ui/);
});

test("company evidence UI keeps route aggregation blocked and folds the explanatory prose", async () => {
  const [source, guide] = await Promise.all([
    text("pages-site/company-evidence-ui.ts"),
    text("app/DataReadingGuide.tsx"),
  ]);
  assert.match(source, /DISCLOSED FUNDING ROUTES/);
  assert.match(source, /href="#data-reading-guide">↓ 読み方/);
  assert.match(source, /entry\.route/);
  assert.doesNotMatch(source, /routeAmount|amountByRoute|routeTotal/);
  assert.doesNotMatch(source, /支出経路に明示された経路だけを表示し、経路ごとの金額は合算しません/);
  assert.match(guide, /行政事業レビューに明示された経路だけを表示します/);
});

test("expanded official UI keeps local allocation and negative-inference warnings while folding cross-series explanation", async () => {
  const [source, guide] = await Promise.all([
    text("pages-site/company-evidence-ui.ts"),
    text("app/DataReadingGuide.tsx"),
  ]);
  assert.match(source, /row\.corporateNumber === company\.corporateNumber/);
  assert.match(source, /entityHasExactCompanyIdentity\(row, company\.name\)/);
  assert.match(source, /共同受注・連名の各当事者を含む/);
  assert.match(source, /共同受注・連名の行は公表行全体の金額で、各社への配分額ではありません/);
  assert.match(source, /row\.organizations\.map\(escapeHtml\)/);
  assert.match(source, /公的資金の受領や契約がないことを意味しません/);
  assert.match(source, /href="#data-reading-guide">↓ 読み方/);
  assert.doesNotMatch(source, /金額は交付決定額・契約額など公表時点が異なるため、GビズINFOや行政事業レビューと合算しません/);
  assert.match(source, /category === "bid_result"/);
  assert.match(source, /return "入札結果"/);
  assert.match(source, /row\.amountStage/);
  assert.match(guide, /交付決定額・契約額・落札金額・レビュー掲載の支出先額/);
  assert.match(guide, /契約額・契約金額は契約時点の公表値で、実支払額とは同一視しません/);
  assert.match(guide, /調達予定総額を契約金額として掲載する場合があります/);
  assert.match(guide, /入札結果の落札金額も契約金額・実支払額とは同一視しません/);
  assert.match(guide, /相互に合算しません/);
  assert.match(source, /現在の収録機関を見る/);
});


test("Toyota NEDO implementation rows stay searchable without inventing a company amount", async () => {
  const index = await json("public/data/official-company-index.json");
  const rows = index.records.filter((row) => row.sourceId === "nedo" && row.corporateNumber === "1180301018771");
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.organization === "トヨタ自動車株式会社"));
  assert.ok(rows.every((row) => row.category === "implementation_decision"));
  assert.ok(rows.every((row) => row.amount === null));
  assert.ok(rows.some((row) => row.program === "電気自動車用革新型蓄電池開発"));
  assert.ok(rows.some((row) => row.theme.includes("海外輸入水素")));
  assert.ok(rows.some((row) => row.theme.includes("工場脱炭素化")));

  const source = await text("pages-site/company-evidence-ui.ts");
  assert.match(source, /implementation_decision/);
  assert.match(source, /実施予定先/);
  assert.match(source, /個社額の記載なし/);
  assert.match(source, /row\.amount !== null/);
});
