import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rows = JSON.parse(await readFile(new URL("../data/official/records-2022.json", import.meta.url), "utf8"));
const bySourceKey = new Map(rows.map((row) => [row.sourceKey, row]));
const provenance = {
  sourceDocumentUrl: "https://www.chubu.meti.go.jp/a41kaikei/kouhyou/data/hojyokin/r4fy_4-9.pdf",
  sourceSheet: "PDF 1/7",
  humanReviewedDate: "2026-08-15",
};

const golden = [
  {
    sourceKey: "chubu-2022-grant-decisions-h1:no-1",
    organization: "一般財団法人金属系材料研究開発センター",
    corporateNumber: "5010405009696",
    amount: 25045158,
    date: "2022-04-01",
  },
  {
    sourceKey: "chubu-2022-grant-decisions-h1:no-2",
    organization: "公益財団法人石川県産業創出支援機構",
    corporateNumber: "1220005000195",
    amount: 40270665,
    date: "2022-04-01",
  },
  {
    sourceKey: "chubu-2022-grant-decisions-h1:no-3",
    organization: "公益財団法人石川県産業創出支援機構",
    corporateNumber: "1220005000195",
    amount: 45000000,
    date: "2022-04-01",
  },
  {
    sourceKey: "chubu-2022-grant-decisions-h1:no-4",
    organization: "公益財団法人富山県新世紀産業機構",
    corporateNumber: "6230005000132",
    amount: 30753082,
    date: "2022-04-01",
  },
  {
    sourceKey: "chubu-2022-grant-decisions-h1:no-5",
    organization: "株式会社加藤製作所",
    corporateNumber: "7180001047727",
    amount: 8488666,
    date: "2022-04-01",
  },
];

test("keeps human-reviewed Chubu FY2022 golden values stable", () => {
  for (const expected of golden) {
    const actual = bySourceKey.get(expected.sourceKey);
    assert.ok(actual, expected.sourceKey);
    assert.equal(actual.organization, expected.organization, `${expected.sourceKey}: organization`);
    assert.equal(actual.corporateNumber, expected.corporateNumber, `${expected.sourceKey}: corporate number`);
    assert.equal(actual.amount, expected.amount, `${expected.sourceKey}: amount`);
    assert.equal(actual.date, expected.date, `${expected.sourceKey}: date`);
    assert.equal(actual.category, "grant_decision", `${expected.sourceKey}: category`);
    assert.equal(actual.datasetId, "chubu-2022-grant-decisions-h1", `${expected.sourceKey}: dataset`);
    assert.equal(actual.sourceDocumentUrl, provenance.sourceDocumentUrl, `${expected.sourceKey}: source document`);
    assert.equal(actual.sourceSheet, provenance.sourceSheet, `${expected.sourceKey}: source page`);
    assert.equal(actual.sourceRowNumber, Number(expected.sourceKey.match(/no-(\d+)$/)?.[1]), `${expected.sourceKey}: source row`);
  }
  assert.match(provenance.humanReviewedDate, /^\d{4}-\d{2}-\d{2}$/);
});
