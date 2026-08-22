import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterCompanyRecords,
  groupCompanyRecords,
  summarizeCompanyIdentityCoverage,
} from "../scripts/company-search.mjs";

function row({ id, organization, organizations, corporateNumber, sourceAgency = "経済産業省" }) {
  return {
    id,
    organization,
    organizations,
    corporateNumber,
    sourceAgency,
    stage: "contracted",
    fiscalYear: 2026,
    amount: 100,
    program: "共同受注テスト",
  };
}

const rows = [
  row({
    id: "hitachi-current",
    organization: "株式会社日立製作所",
    organizations: ["株式会社日立製作所"],
    corporateNumber: "7010001008844",
  }),
  row({
    id: "hitachi-history",
    organization: "日立製作所旧名称株式会社",
    organizations: ["日立製作所旧名称株式会社"],
    corporateNumber: "7010001008844",
  }),
  row({
    id: "hitachi-jecc-joint",
    organization: "株式会社日立製作所 株式会社ＪＥＣＣ",
    organizations: ["株式会社日立製作所", "株式会社ＪＥＣＣ"],
    corporateNumber: "",
  }),
  row({
    id: "unrelated-numberless",
    organization: "番号なし別法人",
    organizations: ["番号なし別法人"],
    corporateNumber: "",
  }),
];

test("filterCompanyRecords keeps matching corporate-numberless rows while retaining all rows for an identified corporation", () => {
  const results = filterCompanyRecords(rows, { query: "日立製作所" });
  assert.deepEqual(
    results.map((item) => item.id).sort(),
    ["hitachi-current", "hitachi-history", "hitachi-jecc-joint"],
  );
});

test("a corporate-numberless joint recipient is reachable by the other participant name", () => {
  assert.deepEqual(
    filterCompanyRecords(rows, { query: "ＪＥＣＣ" }).map((item) => item.id),
    ["hitachi-jecc-joint"],
  );
});

test("corporate-numberless matching does not turn unrelated blank corporate numbers into one group", () => {
  assert.deepEqual(
    filterCompanyRecords(rows, { query: "番号なし別法人" }).map((item) => item.id),
    ["unrelated-numberless"],
  );
  assert.deepEqual(filterCompanyRecords(rows, { query: "存在しない法人" }), []);

  const numberless = rows.filter((item) => !item.corporateNumber);
  const groups = groupCompanyRecords(numberless);
  assert.equal(groups.size, 2);
  assert.deepEqual(
    [...groups.values()].flat().map((item) => item.id).sort(),
    ["hitachi-jecc-joint", "unrelated-numberless"],
  );
});

test("same-name numberless rows remain split but are never counted as verified corporations", () => {
  const numberless = ["n1", "n2", "n3"].map((id) => row({
    id,
    organization: "番号なし株式会社",
    organizations: ["番号なし株式会社"],
    corporateNumber: "",
  }));

  const groups = groupCompanyRecords(numberless);
  assert.equal(groups.size, 3, "same name is insufficient evidence to merge numberless rows");
  assert.deepEqual(summarizeCompanyIdentityCoverage(numberless), {
    verifiedCorporationCount: 0,
    numberlessRecordCount: 3,
  });
});

test("numberless matching is intentionally an evidence-layer capability, not a Gbiz schema relaxation", async () => {
  const [page, worker, enhancedWorker, evidence] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/funding-search-enhanced.worker.js", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/company-evidence-ui.ts", import.meta.url), "utf8"),
  ]);

  for (const gbizRuntime of [page, worker, enhancedWorker]) {
    assert.match(gbizRuntime, /\^\\d\{13\}\$/);
  }
  assert.match(evidence, /entityHasExactCompanyIdentity\(row, company\.name\)/);
  assert.match(evidence, /共同受注・連名の各当事者を含む/);
});
