import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(path, "utf8");
}

async function json(path) {
  return JSON.parse(await text(path));
}

test("expanded official company index covers verified METI bodies while excluding Okinawa", async () => {
  const index = await json("public/data/official-company-index.json");
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.recordCount, index.records.length);
  assert.equal(index.sourceCount, index.sources.length);
  assert.ok(index.recordCount > 10_000, "expanded company index should use the committed official corpus, not only three seed sources");

  const sourceIds = new Set(index.sources.map((source) => source.id));
  for (const required of [
    "meti",
    "anre",
    "smea",
    "jpo",
    "hokkaido",
    "tohoku",
    "kanto",
    "chubu",
    "kansai",
    "chugoku",
    "shikoku",
    "kyushu",
    "nedo",
    "smrj",
  ]) {
    assert.ok(sourceIds.has(required), `missing expanded official source: ${required}`);
  }
  assert.equal(sourceIds.has("okinawa"), false);
  assert.deepEqual(index.excludedExecutors, ["okinawa"]);
  assert.match(index.scopeNote, /見つからないことは支出がないことを意味しない/);
  assert.match(index.scopeNote, /相互に合算しない/);

  for (const source of index.sources) {
    assert.ok(source.recordCount > 0, `${source.id}: source must contribute at least one row`);
    assert.match(source.coverageNote, /全|網羅|収録/, `${source.id}: source coverage limitation must be explicit`);
  }

  const nedo = index.records.find((row) => row.sourceId === "nedo" && row.corporateNumber === "6130001065395");
  assert.ok(nedo, "known NEDO company record must remain searchable");
  const smrj = index.records.find((row) => row.sourceId === "smrj" && row.corporateNumber === "1010401023102");
  assert.ok(smrj, "known SMRJ company record must remain searchable");
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

test("company evidence UI shows only disclosed review routes and does not aggregate route money", async () => {
  const source = await text("pages-site/company-evidence-ui.ts");
  assert.match(source, /DISCLOSED FUNDING ROUTES/);
  assert.match(source, /支出経路に明示された経路だけを表示/);
  assert.match(source, /経路ごとの金額は合算しません/);
  assert.match(source, /entry\.route/);
  assert.doesNotMatch(source, /routeAmount|amountByRoute|routeTotal/);
});

test("expanded official UI is keyed by corporate number and keeps negative inference explicit", async () => {
  const source = await text("pages-site/company-evidence-ui.ts");
  assert.match(source, /row\.corporateNumber === company\.corporateNumber/);
  assert.match(source, /公表資料に法人番号がない行だけ、法人名の完全一致で補います/);
  assert.match(source, /公的資金の受領や契約がないことを意味しません/);
  assert.match(source, /GビズINFOや行政事業レビューと合算しません/);
  assert.match(source, /現在の収録機関を見る/);
});
